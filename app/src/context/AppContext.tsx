import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { createCrypto } from "@family-messenger/crypto";
import { getCrypto } from "../crypto/sodium";
import { listContacts, upsertContact, type Contact } from "../db/contacts";
import {
  insertMessage,
  listMessagesForChat,
  markMessageDeleted,
  messageExists,
  updateMessageStatus,
  type LocalMessage,
} from "../db/messages";
import { getLastSyncedTs, setLastSyncedTs } from "../db/syncState";
import { decryptDeliveredMessage, encryptForChat } from "../chat/encryption";
import { dmChatId } from "../chat/chatId";
import { saveIncomingEnvelope, type LocalMediaMeta } from "../chat/media";
import { WsClient, type ConnectionFailure, type ConnectionState } from "../net/wsClient";
import type { InviteCreatedPayload, MsgDeliverPayload, RosterMemberPayload } from "../net/protocol";
import type { DeviceIdentity } from "../storage/identity";
import { Emitter } from "../util/emitter";
import { uuidv4 } from "../util/uuid";

type Crypto = ReturnType<typeof createCrypto>;

const MEDIA_CONTENT_TYPES = new Set(["image", "voice", "file"]);

/** Собеседник считается печатающим не дольше этого времени — страховка от «зависшего» индикатора. */
const TYPING_EXPIRY_MS = 6_000;

/** Сколько ждём готовности соединения там, где без сервера операция невозможна (создание инвайта). */
const WAIT_READY_MS = 10_000;

interface ChatEvents extends Record<string, (...args: never[]) => void> {
  messageInserted: (chatId: string) => void;
  messageStatusChanged: (clientMsgId: string) => void;
  typingChanged: (chatId: string, fromUserId: string, isTyping: boolean) => void;
}

export type SendResult = { ok: true } | { ok: false; reason: "NO_CONTACT" | "NOT_READY" | "CRYPTO_FAILED" };

export type CreateInviteResult =
  | { ok: true; invite: InviteCreatedPayload }
  /** detail — конкретная причина отказа соединения, если она известна. */
  | { ok: false; reason: "OFFLINE" | "TIMEOUT" | "SERVER_OUTDATED"; detail?: string };

/** Человекочитаемая причина отказа + что делать. Пустая строка = проблема не в аутентификации. */
export function describeFailure(failure: ConnectionFailure | null): string {
  if (!failure) return "";
  if (failure.kind === "network") return `Сервер недоступен (${failure.detail}).`;
  switch (failure.code) {
    case "UNKNOWN_DEVICE":
      return "Сервер не знает это устройство. Обычно это значит, что база сервера была пересоздана — нужен новый код приглашения и повторная регистрация в приложении.";
    case "REVOKED":
      return "Доступ этого устройства отозван на сервере.";
    case "BAD_SIGNATURE":
      return "Сервер не принял подпись устройства — ключи повреждены, нужна повторная регистрация по новому коду.";
    default:
      return `Сервер отказал в аутентификации (${failure.code}).`;
  }
}

interface AppContextValue {
  identity: DeviceIdentity;
  connectionState: ConnectionState;
  connectionFailure: ConnectionFailure | null;
  contacts: Contact[];
  chatEvents: Emitter<ChatEvents>;
  myFingerprint: string;
  sendText: (chatId: string, text: string, replyTo?: string | null) => Promise<SendResult>;
  sendMedia: (
    chatId: string,
    contentType: "image" | "voice" | "file",
    envelopeJson: string,
    localMeta: LocalMediaMeta,
    replyTo?: string | null,
  ) => Promise<SendResult>;
  sendLocation: (chatId: string, lat: number, lng: number, replyTo?: string | null) => Promise<SendResult>;
  deleteMessage: (msgId: string, chatId: string) => Promise<void>;
  markRead: (msgId: string, chatId: string) => void;
  setTyping: (chatId: string, isTyping: boolean) => void;
  loadMessages: (chatId: string) => Promise<LocalMessage[]>;
  createInvite: () => Promise<CreateInviteResult>;
  reconnect: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp() вызван вне AppProvider");
  return ctx;
}

function contactFromRoster(crypto: Crypto, member: RosterMemberPayload): Contact {
  return {
    userId: member.userId,
    deviceId: member.deviceId,
    displayName: member.displayName,
    identityPublicKey: member.identityPublicKey,
    encryptionPublicKey: member.encryptionPublicKey,
    fingerprint: crypto.computeFingerprint(member.identityPublicKey),
    isRevoked: false,
  };
}

export function AppProvider({
  identity,
  children,
}: {
  identity: DeviceIdentity;
  children: React.ReactNode;
}): React.ReactElement {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [connectionFailure, setConnectionFailure] = useState<ConnectionFailure | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [myFingerprint, setMyFingerprint] = useState("");
  const cryptoRef = useRef<Crypto | null>(null);
  const wsRef = useRef<WsClient | null>(null);
  const contactsRef = useRef<Contact[]>([]);
  const chatEvents = useMemo(() => new Emitter<ChatEvents>(), []);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    let cancelled = false;
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

    void (async () => {
      const crypto = await getCrypto();
      if (cancelled) return;
      cryptoRef.current = crypto;
      setMyFingerprint(crypto.computeFingerprint(identity.identityPublicKey));

      const storedContacts = await listContacts();
      if (!cancelled) setContacts(storedContacts);

      const ws = new WsClient(identity.serverUrl, {
        kind: "device",
        deviceId: identity.deviceId,
        identitySecretKey: identity.identitySecretKey,
      });
      wsRef.current = ws;

      ws.events.on("state", (state) => {
        setConnectionState(state);
        if (state === "connected") setConnectionFailure(null);
      });
      ws.events.on("failure", setConnectionFailure);

      async function upsertAndTrack(member: RosterMemberPayload): Promise<Contact> {
        const contact = contactFromRoster(crypto, member);
        await upsertContact(contact);
        setContacts((prev) => [...prev.filter((c) => c.userId !== contact.userId), contact]);
        return contact;
      }

      ws.events.on("roster", (payload) => {
        void (async () => {
          for (const member of payload.members) {
            await upsertAndTrack(member);
          }
          // Синхронизация истории по всем личным чатам после (пере)подключения.
          for (const member of payload.members) {
            const chatId = dmChatId(identity.userId, member.userId);
            ws.fetchHistory(chatId, await getLastSyncedTs(chatId));
          }
        })();
      });

      ws.events.on("memberJoined", (member) => {
        void upsertAndTrack(member);
      });

      ws.events.on("msgDeliver", (payload) => {
        void handleIncomingMessage(crypto, ws, identity, payload, chatEvents);
      });

      ws.events.on("msgAccepted", (payload) => {
        void updateMessageStatus(payload.clientMsgId, "sent").then(() => {
          chatEvents.emit("messageStatusChanged", payload.clientMsgId);
        });
      });

      ws.events.on("ackRelay", (payload) => {
        // msgId у нас всегда равен clientMsgId (сервер не меняет id).
        void updateMessageStatus(payload.msgId, payload.status).then(() => {
          chatEvents.emit("messageStatusChanged", payload.msgId);
        });
      });

      ws.events.on("typingRelay", (payload) => {
        chatEvents.emit("typingChanged", payload.chatId, payload.fromUserId, payload.isTyping);

        // Собственный таймер сброса: если собеседник закрыл приложение, не
        // отправив "перестал печатать", индикатор иначе остался бы навсегда.
        const key = `${payload.chatId}:${payload.fromUserId}`;
        const existing = typingTimers.get(key);
        if (existing) clearTimeout(existing);
        if (payload.isTyping) {
          typingTimers.set(
            key,
            setTimeout(() => {
              typingTimers.delete(key);
              chatEvents.emit("typingChanged", payload.chatId, payload.fromUserId, false);
            }, TYPING_EXPIRY_MS),
          );
        } else {
          typingTimers.delete(key);
        }
      });

      ws.events.on("msgDeleted", (payload) => {
        void markMessageDeleted(payload.msgId).then(() => {
          chatEvents.emit("messageInserted", payload.chatId);
        });
      });

      ws.events.on("historyPage", (payload) => {
        void (async () => {
          let maxTs = 0;
          for (const message of payload.messages) {
            maxTs = Math.max(maxTs, message.ts);
            await handleIncomingMessage(crypto, ws, identity, message, chatEvents, { skipAck: true });
          }
          if (maxTs > 0) await setLastSyncedTs(payload.chatId, maxTs);
        })();
      });

      ws.connect();
    })();

    // Android рвёт сокеты у свёрнутых приложений, событие close при этом может
    // не прийти. Поэтому при каждом возврате в приложение проверяем связь и,
    // если её нет, переподключаемся сразу, не дожидаясь backoff-таймера.
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      const ws = wsRef.current;
      if (ws && !ws.isReady()) ws.forceReconnect();
    });

    return () => {
      cancelled = true;
      appStateSub.remove();
      for (const timer of typingTimers.values()) clearTimeout(timer);
      wsRef.current?.disconnect();
    };
    // identity стабилен на весь жизненный цикл AppProvider — переавторизация не нужна
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AppContextValue>(() => {
    /** Общая часть sendText/sendMedia/sendLocation: шифрование + локальная запись + отправка. */
    async function sendEncrypted(
      chatId: string,
      contentType: string,
      wireContent: string,
      localPlaintext: string,
      replyTo: string | null,
    ): Promise<SendResult> {
      const crypto = cryptoRef.current;
      const ws = wsRef.current;
      if (!crypto || !ws) return { ok: false, reason: "NOT_READY" };

      const contactsByUserId = new Map(contactsRef.current.map((c) => [c.userId, c]));
      const encrypted = encryptForChat(crypto, identity, chatId, wireContent, contactsByUserId);
      if ("error" in encrypted) return { ok: false, reason: encrypted.error };

      const clientMsgId = uuidv4();

      await insertMessage({
        id: clientMsgId,
        clientMsgId,
        chatId,
        fromUserId: identity.userId,
        contentType,
        plaintext: localPlaintext,
        replyTo,
        status: "pending",
        createdAt: Date.now(),
        deletedAt: null,
      });
      chatEvents.emit("messageInserted", chatId);

      await ws.sendMessage({
        clientMsgId,
        chatId,
        contentType,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        replyTo,
      });

      // Сообщение уже в outbox и уйдёт при подключении, но ждать до 30 секунд
      // backoff незачем: если связи нет — пробуем подключиться немедленно.
      if (!ws.isReady()) ws.forceReconnect();
      return { ok: true };
    }

    return {
      identity,
      connectionState,
      connectionFailure,
      contacts,
      chatEvents,
      myFingerprint,
      sendText: (chatId, text, replyTo = null) => sendEncrypted(chatId, "text", text, text, replyTo),
      sendMedia: (chatId, contentType, envelopeJson, localMeta, replyTo = null) =>
        sendEncrypted(chatId, contentType, envelopeJson, JSON.stringify(localMeta), replyTo),
      sendLocation: (chatId, lat, lng, replyTo = null) => {
        const json = JSON.stringify({ lat, lng });
        return sendEncrypted(chatId, "location", json, json, replyTo);
      },
      async deleteMessage(msgId, chatId) {
        await markMessageDeleted(msgId);
        chatEvents.emit("messageInserted", chatId);
        wsRef.current?.deleteMessage(msgId, chatId);
      },
      markRead(msgId, chatId) {
        wsRef.current?.ackMessage(msgId, chatId, "read");
      },
      setTyping(chatId, isTyping) {
        wsRef.current?.sendTyping(chatId, isTyping);
      },
      loadMessages: (chatId) => listMessagesForChat(chatId),
      reconnect() {
        wsRef.current?.forceReconnect();
      },
      async createInvite() {
        const ws = wsRef.current;
        if (!ws) return { ok: false, reason: "OFFLINE" };

        // Раньше здесь была мгновенная проверка isOpen(): если сокет умер в
        // фоне (обычное дело на Android), экран сразу писал «нет соединения».
        // Теперь сначала пробуем переподключиться и подождать авторизацию.
        if (!(await ws.waitUntilReady(WAIT_READY_MS))) {
          // Причину берём из клиента, а не из состояния React: она появляется
          // уже во время ожидания, и замыкание экрана её бы не увидело.
          return { ok: false, reason: "OFFLINE", detail: describeFailure(ws.failure) };
        }

        return new Promise<CreateInviteResult>((resolve) => {
          let settled = false;
          const finish = (result: CreateInviteResult): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            offCreated();
            offError();
            resolve(result);
          };

          const timeout = setTimeout(() => finish({ ok: false, reason: "TIMEOUT" }), 12_000);

          const offCreated = ws.events.on("inviteCreated", (payload) => finish({ ok: true, invite: payload }));

          // Старая версия сервера не знает пакет invite.create и отвечает
          // UNKNOWN_TYPE — без этой ветки экран ждал бы таймаут и не объяснил,
          // что именно нужно сделать (обновить сервер).
          const offError = ws.events.on("errorPacket", (payload) => {
            if (payload.code === "UNKNOWN_TYPE") finish({ ok: false, reason: "SERVER_OUTDATED" });
          });

          if (!ws.requestInvite()) finish({ ok: false, reason: "OFFLINE" });
        });
      },
    };
  }, [identity, connectionState, connectionFailure, contacts, chatEvents, myFingerprint]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

async function handleIncomingMessage(
  crypto: Crypto,
  ws: WsClient,
  identity: DeviceIdentity,
  payload: MsgDeliverPayload,
  chatEvents: Emitter<ChatEvents>,
  options: { skipAck?: boolean } = {},
): Promise<void> {
  if (await messageExists(payload.msgId)) return;

  const contactsList = await listContacts();
  const contactsByUserId = new Map(contactsList.map((c) => [c.userId, c]));
  const decrypted = decryptDeliveredMessage(crypto, identity, payload, contactsByUserId);

  // Для медиа конверт содержит сырые base64-данные — на диск пишем один раз,
  // в sqlite кладём только метаданные (см. src/chat/media.ts).
  const plaintext =
    decrypted && MEDIA_CONTENT_TYPES.has(payload.contentType)
      ? JSON.stringify(saveIncomingEnvelope(decrypted, payload.msgId))
      : decrypted;

  await insertMessage({
    id: payload.msgId,
    clientMsgId: payload.msgId,
    chatId: payload.chatId,
    fromUserId: payload.fromUserId,
    contentType: payload.contentType,
    plaintext,
    replyTo: payload.replyTo,
    status: payload.fromUserId === identity.userId ? "sent" : "delivered",
    createdAt: payload.ts,
    deletedAt: null,
  });
  chatEvents.emit("messageInserted", payload.chatId);

  if (!options.skipAck && payload.fromUserId !== identity.userId) {
    ws.ackMessage(payload.msgId, payload.chatId, "delivered");
  }
}
