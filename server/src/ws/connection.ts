import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { FastifyBaseLogger } from "fastify";
import { randomNonceB64 } from "../crypto/verify.js";
import { handleAuthResponse } from "./handlers/auth.js";
import { handleInviteRedeem } from "./handlers/invite.js";
import { broadcastToAllExcept, registerConnection, send, unregisterConnection } from "./registry.js";
import { isEnvelope, type AuthResponsePayload, type Envelope, type InviteRedeemPayload } from "./types.js";

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
      if (parsed.type === "ping") {
        send(socket, envelope("pong", {}));
        return;
      }

      // Этап 1: полноценной маршрутизации сообщений ещё нет (msg.send/history.fetch и т.д. —
      // Этап 3-4). Пока просто эхо — подтверждает, что транспорт и аутентификация работают.
      send(socket, envelope(`${parsed.type}.echo`, parsed.payload));
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
