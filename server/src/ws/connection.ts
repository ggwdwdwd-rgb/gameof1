import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { FastifyBaseLogger } from "fastify";
import { randomNonceB64 } from "../crypto/verify.js";
import { handleAuthResponse } from "./handlers/auth.js";
import { recipientDeviceIds } from "./handlers/chat.js";
import { handleInviteRedeem } from "./handlers/invite.js";
import { createInvite } from "../invites.js";
import { handleHistoryFetch, handleMsgAck, handleMsgDelete, handleMsgSend } from "./handlers/message.js";
import { getRosterExcluding } from "./handlers/roster.js";
import {
  broadcastToAllExcept,
  registerConnection,
  send,
  sendToDevice,
  unregisterConnection,
} from "./registry.js";
import {
  isEnvelope,
  type AuthResponsePayload,
  type Envelope,
  type HistoryFetchPayload,
  type InviteCreatePayload,
  type InviteRedeemPayload,
  type MsgAckPayload,
  type MsgDeletePayload,
  type MsgSendPayload,
  type TypingPayload,
} from "./types.js";

type ConnState =
  | { stage: "awaiting_auth"; nonce: string }
  | { stage: "authenticated"; userId: string; deviceId: string };

function envelope(type: string, payload: unknown): Envelope {
  return { v: 1, type, id: randomUUID(), ts: Date.now(), payload: payload as object };
}

export function handleConnection(socket: WebSocket, log: FastifyBaseLogger): void {
  let state: ConnState | null = null;

  void (async () => {
    const nonce = await randomNonceB64();
    state = { stage: "awaiting_auth", nonce };
    send(socket, envelope("auth.challenge", { nonce }));
  })();

  socket.on("message", (raw: Buffer) => {
    void (async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString("utf-8"));
      } catch {
        send(socket, envelope("error", { code: "BAD_JSON", message: "Не удалось разобрать пакет" }));
        return;
      }

      if (!isEnvelope(parsed)) {
        send(socket, envelope("error", { code: "BAD_ENVELOPE", message: "Неверный формат пакета" }));
        return;
      }

      if (!state) return; // защита от гонки, до инициализации состояния сообщения не приходят

      if (state.stage === "awaiting_auth") {
        if (parsed.type === "auth.response") {
          const payload = parsed.payload as AuthResponsePayload;
          const result = await handleAuthResponse(payload.deviceId, payload.signature, state.nonce);
          if (!result.ok) {
            send(socket, envelope("auth.error", result));
            return;
          }
          state = { stage: "authenticated", userId: result.userId, deviceId: result.deviceId };
          registerConnection(result.deviceId, result.userId, socket);
          send(socket, envelope("auth.ok", { userId: result.userId, deviceId: result.deviceId, serverTime: Date.now() }));
          send(socket, envelope("roster.snapshot", { members: getRosterExcluding(result.deviceId) }));
          log.info({ userId: result.userId, deviceId: result.deviceId }, "устройство аутентифицировано");
          return;
        }

        if (parsed.type === "invite.redeem") {
          const payload = parsed.payload as InviteRedeemPayload;
          const result = handleInviteRedeem(payload);
          if (!result.ok) {
            send(socket, envelope("invite.redeem.error", result));
            return;
          }
          state = { stage: "authenticated", userId: result.userId, deviceId: payload.deviceId };
          registerConnection(payload.deviceId, result.userId, socket);
          send(socket, envelope("invite.redeem.ok", { userId: result.userId }));
          send(socket, envelope("roster.snapshot", { members: getRosterExcluding(payload.deviceId) }));
          broadcastToAllExcept(
            payload.deviceId,
            envelope("member.joined", {
              userId: result.userId,
              deviceId: payload.deviceId,
              displayName: payload.displayName,
              identityPublicKey: payload.identityPublicKey,
              encryptionPublicKey: payload.encryptionPublicKey,
              joinedAt: Date.now(),
            }),
          );
          log.info({ userId: result.userId }, "новый участник зарегистрирован по инвайту");
          return;
        }

        send(socket, envelope("error", { code: "NOT_AUTHENTICATED", message: "Сначала auth.response или invite.redeem" }));
        return;
      }

      // authenticated
      const { userId, deviceId } = state;

      if (parsed.type === "ping") {
        send(socket, envelope("pong", {}));
        return;
      }

      if (parsed.type === "invite.create") {
        const { ttlHours } = parsed.payload as InviteCreatePayload;
        const invite = createInvite(userId, ttlHours);
        send(socket, envelope("invite.created", invite));
        log.info({ userId }, "выпущен инвайт-код");
        return;
      }

      if (parsed.type === "msg.send") {
        const payload = parsed.payload as MsgSendPayload;
        const result = handleMsgSend(userId, deviceId, payload);
        if (!result.ok) {
          send(socket, envelope("error", { code: result.code, message: "Сообщение не принято" }));
          return;
        }
        send(socket, envelope("msg.accepted", { clientMsgId: payload.clientMsgId, msgId: result.message.msgId }));
        for (const recipientDeviceId of recipientDeviceIds(payload.chatId, userId)) {
          sendToDevice(recipientDeviceId, envelope("msg.deliver", result.message));
        }
        return;
      }

      if (parsed.type === "msg.ack") {
        const payload = parsed.payload as MsgAckPayload;
        const result = handleMsgAck(userId, payload);
        if (result) {
          sendToDevice(
            result.fromDeviceId,
            envelope("msg.ackRelay", { msgId: payload.msgId, chatId: payload.chatId, byUserId: userId, status: payload.status, ts: Date.now() }),
          );
        }
        return;
      }

      if (parsed.type === "msg.delete") {
        const payload = parsed.payload as MsgDeletePayload;
        const result = handleMsgDelete(userId, payload);
        if (!result.ok) {
          send(socket, envelope("error", { code: result.code, message: "Сообщение не удалено" }));
          return;
        }
        for (const recipientDeviceId of recipientDeviceIds(result.chatId, userId)) {
          sendToDevice(recipientDeviceId, envelope("msg.deleted", { msgId: payload.msgId, chatId: result.chatId, byUserId: userId }));
        }
        send(socket, envelope("msg.deleted", { msgId: payload.msgId, chatId: result.chatId, byUserId: userId }));
        return;
      }

      if (parsed.type === "typing") {
        const payload = parsed.payload as TypingPayload;
        for (const recipientDeviceId of recipientDeviceIds(payload.chatId, userId)) {
          sendToDevice(recipientDeviceId, envelope("typing.relay", { chatId: payload.chatId, fromUserId: userId, isTyping: payload.isTyping }));
        }
        return;
      }

      if (parsed.type === "history.fetch") {
        const payload = parsed.payload as HistoryFetchPayload;
        const messages = handleHistoryFetch(userId, payload);
        if (messages === null) {
          send(socket, envelope("error", { code: "NOT_PARTICIPANT", message: "Нет доступа к этому чату" }));
          return;
        }
        send(socket, envelope("history.page", { chatId: payload.chatId, messages, nextCursor: null }));
        return;
      }

      send(socket, envelope("error", { code: "UNKNOWN_TYPE", message: `Неизвестный тип пакета: ${parsed.type}` }));
    })().catch((err: unknown) => {
      log.error({ err }, "ошибка обработки WS-пакета");
    });
  });

  socket.on("close", () => {
    if (state?.stage === "authenticated") {
      unregisterConnection(state.deviceId);
    }
  });
}
