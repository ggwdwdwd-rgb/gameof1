import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { createCrypto } from "@family-messenger/crypto";
import { getCrypto } from "../crypto/sodium";
import { listContacts, upsertContact, type Contact } from "../db/contacts";
import {
  insertMessage,
  listMessagesForChat,
  markChatRead,
  markMessageDeleted,
  messageExists,
  updateMessageStatus,
  type LocalMessage,
} from "../db/messages";
import { listPendingAcks, queueAck, removePendingAck } from "../db/pendingAcks";
import { getSetting, setSetting } from "../db/settings";
import { getLastSyncedTs, setLastSyncedTs } from "../db/syncState";
import { describeForNotification, dismissChat, showIncoming } from "../notify/notifications";
import { decryptDeliveredMessage, encryptForChat } from "../chat/encryption";
import { dmChatId } from "../chat/chatId";
import { saveIncomingEnvelope, type LocalMediaMeta } from "../chat/media";
import { WsClient, type ConnectionFailure, type ConnectionState } from "../net/wsClient";
import type { InviteCreatedPayload, MsgDeliverPayload, RosterMemberPayload } from "../net/protocol";
import { saveIdentity } from "../storage/identity";
import type { DeviceIdentity } from "../storage/identity";
import { Emitter } from "../util/emitter";
import { uuidv4 } from "../util/uuid";

type Crypto = ReturnType<typeof createCrypto>;

const MEDIA_CONTENT_TYPES = new Set(["image", "voice", "file"]);

/** Собеседник считается печатающим не дольше этого времени — страховка от «зависшего» индикатора. */
const TYPING_EXPIRY_MS = 6_000;

const NOTIFICATIONS_SETTING = "notifications_enabled";

/** Сколько ждём готовности соединения там, где без сервера операция невозможна (создание инвайта). */
const WAIT_READY_MS = 10_000;

interface ChatEvents extends Record<string, (...args: never[]) => void> {
  messageInserted: (chatId: string) => void;
  // chatId обязателен: без него каждый экран перечитывал свою переписку на
  // любое изменение статуса в любом чате.
  messageStatusChanged: (chatId: string, clientMsgId: string) => void;
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
  if (failure.kind === "fatal") return `Приложение не смогло запуститься: ${failure.detail}`;
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

/** Данные, которые меняются во время работы, — на них перерисовываются экраны. */
interface AppContextData {
  identity: DeviceIdentity;
  connectionState: ConnectionState;
  connectionFailure: ConnectionFailure | null;
  contacts: Contact[];
  chatEvents: Emitter<ChatEvents>;
  myFingerprint: string;
  /** Показывать ли уведомления о сообщениях, пришедших пока приложение свёрнуто. */
  notificationsEnabled: boolean;
  /** Имя, которым участника видят остальные (может измениться без перезапуска). */
  displayName: string;
}

/** Действия: их идентичность не меняется, поэтому эффекты экранов стабильны. */
interface AppActions {
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
  /** Помечает чат прочитанным и подтверждает серверу только реально изменившиеся сообщения. */
  markChatRead: (chatId: string) => Promise<void>;
  setTyping: (chatId: string, isTyping: boolean) => void;
  loadMessages: (chatId: string) => Promise<LocalMessage[]>;
  createInvite: () => Promise<CreateInviteResult>;
  reconnect: () => void;
  /** Смена своего имени: локально, на сервере и у остальных участников. */
  renameSelf: (displayName: string) => Promise<boolean>;
  /** Включение и выключение уведомлений о новых сообщениях. */
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
}

type AppContextValue = AppContextData & AppActions;

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
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [displayName, setDisplayName] = useState(identity.displayName);
  /** Свёрнуто приложение или нет: уведомление показываем только когда свёрнуто. */
  const appActiveRef = useRef(true);
  const notificationsRef = useRef(false);
  const cryptoRef = useRef<Crypto | null>(null);
  const wsRef = useRef<WsClient | null>(null);
  const contactsRef = useRef<Contact[]>([]);
  const chatEvents = useMemo(() => new Emitter<ChatEvents>(), []);

  useEffect(() => {
    let cancelled = false;
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

    // catch обязателен: без него исключение здесь (например, из проверки сборки
    // libsodium) уходило в unhandled rejection, ws.connect() не вызывался
    // никогда, и приложение просто оставалось «без соединения» без объяснений.
    void (async () => {
      const crypto = await getCrypto();
      if (cancelled) return;
      cryptoRef.current = crypto;
      setMyFingerprint(crypto.computeFingerprint(identity.identityPublicKey));

      const storedNotifications = (await getSetting(NOTIFICATIONS_SETTING)) === "1";
      notificationsRef.current = storedNotifications;
      if (!cancelled) setNotificationsEnabled(storedNotifications);

      const storedContacts = await listContacts();
      if (cancelled) return;
      contactsRef.current = storedContacts;
      setContacts(storedContacts);

      const ws = new WsClient(identity.serverUrl, {
        kind: "device",
        deviceId: identity.deviceId,
        identitySecretKey: identity.identitySecretKey,
      });
      wsRef.current = ws;

      ws.events.on("state", (state) => {
        setConnectionState(state);
        if (state !== "connected") return;
        setConnectionFailure(null);
        // Квитанции, не ушедшие из-за отсутствия связи, досылаем один раз при
        // подключении. Повторять их постоянно нельзя — именно это раньше и
        // создавало поток лишних пакетов.
        void (async () => {
          for (const ack of await listPendingAcks()) {
            if (ws.ackMessage(ack.msgId, ack.chatId, ack.status)) await removePendingAck(ack.msgId);
          }
        })();
      });
      ws.events.on("failure", setConnectionFailure);

      async function upsertAndTrack(member: RosterMemberPayload): Promise<Contact> {
        const contact = contactFromRoster(crypto, member);
        await upsertContact(contact);
        // Ссылку обновляем синхронно, не дожидаясь перерисовки: сразу после
        // roster идёт запрос истории, и её расшифровка использует именно этот
        // список. Через setContacts он появился бы позже — и сообщения легли бы
        // в базу нерасшифрованными навсегда.
        contactsRef.current = [...contactsRef.current.filter((c) => c.userId !== contact.userId), contact];
        setContacts(contactsRef.current);
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

      ws.events.on("memberUpdated", (payload) => {
        if (payload.userId === identity.userId) {
          setDisplayName(payload.displayName);
          return;
        }
        const existing = contactsRef.current.find((c) => c.userId === payload.userId);
        if (!existing) return;
        void upsertAndTrack({
          userId: existing.userId,
          deviceId: existing.deviceId,
          displayName: payload.displayName,
          identityPublicKey: existing.identityPublicKey,
          encryptionPublicKey: existing.encryptionPublicKey,
          joinedAt: 0,
        });
      });

      ws.events.on("msgDeliver", (payload) => {
        void handleIncomingMessage(crypto, ws, identity, payload, chatEvents, {
          contacts: contactsRef.current,
          // Уведомление показываем только для чужих сообщений и только когда
          // приложение свёрнуто: внутри чата оно и так видно.
          notify:
            notificationsRef.current && !appActiveRef.current && payload.fromUserId !== identity.userId
              ? (contentType, plaintext) => {
                  const sender = contactsRef.current.find((c) => c.userId === payload.fromUserId);
                  void showIncoming({
                    chatId: payload.chatId,
                    title: sender?.displayName ?? "Новое сообщение",
                    body: describeForNotification(contentType, plaintext),
                  });
                }
              : undefined,
        });
      });

      ws.events.on("msgAccepted", (payload) => {
        void updateMessageStatus(payload.clientMsgId, "sent").then((changed) => {
          // Статус двигается только вперёд, и если ничего не изменилось —
          // перерисовывать экраны не нужно.
          if (changed) chatEvents.emit("messageStatusChanged", payload.chatId, payload.clientMsgId);
        });
      });

      ws.events.on("ackRelay", (payload) => {
        // msgId у нас всегда равен clientMsgId (сервер не меняет id).
        void updateMessageStatus(payload.msgId, payload.status).then((changed) => {
          if (changed) chatEvents.emit("messageStatusChanged", payload.chatId, payload.msgId);
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
          let inserted = 0;
          for (const message of payload.messages) {
            maxTs = Math.max(maxTs, message.ts);
            // silent: страница истории — это до 200 сообщений, и событие на
            // каждое означало 200 полных перечитываний переписки подряд.
            // Сообщаем один раз, когда страница разобрана.
            if (await handleIncomingMessage(crypto, ws, identity, message, chatEvents, {
              skipAck: true,
              silent: true,
              contacts: contactsRef.current,
            })) {
              inserted += 1;
            }
          }
          if (inserted > 0) chatEvents.emit("messageInserted", payload.chatId);
          if (maxTs > 0) await setLastSyncedTs(payload.chatId, maxTs);
        })();
      });

      ws.connect();
    })().catch((error: unknown) => {
      if (cancelled) return;
      const detail = error instanceof Error ? error.message : String(error);
      setConnectionFailure({ kind: "fatal", detail });
    });

    // Android рвёт сокеты у свёрнутых приложений, событие close при этом может
    // не прийти. Поэтому при каждом возврате в приложение проверяем связь и,
    // если её нет, переподключаемся сразу, не дожидаясь backoff-таймера.
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      appActiveRef.current = nextState === "active";
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

  const actions = useMemo<AppActions>(() => {
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
      async markChatRead(chatId) {
        // Уведомления этого чата больше не нужны — пользователь его открыл.
        void dismissChat(chatId);

        const changed = await markChatRead(chatId, identity.userId);
        if (changed.length === 0) return;

        // Локально помечаем всегда, чтобы счётчик непрочитанного гас сразу при
        // открытии чата. Квитанции, которые не ушли (нет связи), кладём в
        // очередь и досылаем при подключении — иначе у собеседника сообщение
        // навсегда осталось бы «доставлено» вместо «прочитано».
        const ws = wsRef.current;
        for (const msgId of changed) {
          if (!ws?.ackMessage(msgId, chatId, "read")) {
            await queueAck({ msgId, chatId, status: "read" });
          }
        }
        chatEvents.emit("messageStatusChanged", chatId, changed[0]!);
      },
      setTyping(chatId, isTyping) {
        wsRef.current?.sendTyping(chatId, isTyping);
      },
      loadMessages: (chatId) => listMessagesForChat(chatId),
      reconnect() {
        wsRef.current?.forceReconnect();
      },
      async renameSelf(nextName) {
        const trimmed = nextName.trim();
        if (trimmed.length === 0 || trimmed.length > 40) return false;

        const ws = wsRef.current;
        // Имя видят остальные, поэтому без связи менять его нельзя: иначе у
        // разных людей будут разные имена одного человека.
        if (!ws || !(await ws.waitUntilReady(WAIT_READY_MS)) || !ws.updateProfile(trimmed)) return false;

        // Локально сохраняем сразу: подтверждение придёт пакетом member.updated,
        // но ждать его на экране незачем.
        // В хранилище — чтобы имя сохранилось после перезапуска; в состояние —
        // чтобы экраны увидели его сразу. Сам объект identity не мутируем.
        await saveIdentity({ ...identity, displayName: trimmed });
        setDisplayName(trimmed);
        return true;
      },
      async setNotificationsEnabled(enabled) {
        notificationsRef.current = enabled;
        setNotificationsEnabled(enabled);
        await setSetting(NOTIFICATIONS_SETTING, enabled ? "1" : "0");
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
    // Только стабильные зависимости: identity не меняется за жизнь провайдера,
    // chatEvents создан через useMemo без зависимостей, остальное — рефы.
  }, [identity, chatEvents]);

  const value = useMemo<AppContextValue>(
    () => ({
      identity,
      connectionState,
      connectionFailure,
      contacts,
      chatEvents,
      myFingerprint,
      notificationsEnabled,
      displayName,
      ...actions,
    }),
    [
      identity,
      connectionState,
      connectionFailure,
      contacts,
      chatEvents,
      myFingerprint,
      notificationsEnabled,
      displayName,
      actions,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** true, если сообщение действительно добавлено (а не было уже известно). */
async function handleIncomingMessage(
  crypto: Crypto,
  ws: WsClient,
  identity: DeviceIdentity,
  payload: MsgDeliverPayload,
  chatEvents: Emitter<ChatEvents>,
  options: {
    skipAck?: boolean;
    silent?: boolean;
    contacts?: Contact[];
    notify?: (contentType: string, plaintext: string | null) => void;
  } = {},
): Promise<boolean> {
  if (await messageExists(payload.msgId)) return false;

  // Контакты берём из памяти: обращение к sqlite на каждое входящее сообщение
  // заметно тормозило разбор истории.
  const contactsList = options.contacts ?? (await listContacts());
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
  if (!options.silent) chatEvents.emit("messageInserted", payload.chatId);
  options.notify?.(payload.contentType, plaintext);

  if (!options.skipAck && payload.fromUserId !== identity.userId) {
    if (!ws.ackMessage(payload.msgId, payload.chatId, "delivered")) {
      await queueAck({ msgId: payload.msgId, chatId: payload.chatId, status: "delivered" });
    }
  }
  return true;
}
