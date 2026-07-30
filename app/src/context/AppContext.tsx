import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { WsClient, type ConnectionState } from "../net/wsClient";
import type { InviteCreatedPayload, MsgDeliverPayload, RosterMemberPayload } from "../net/protocol";
import type { DeviceIdentity } from "../storage/identity";
import { Emitter } from "../util/emitter";
import { uuidv4 } from "../util/uuid";

type Crypto = ReturnType<typeof createCrypto>;

const MEDIA_CONTENT_TYPES = new Set(["image", "voice", "file"]);

/** Собеседник считается печатающим не дольше этого времени — страховка от «зависшего» индикатора. */
const TYPING_EXPIRY_MS = 6_000;

interface ChatEvents extends Record<string, (...args: never[]) => void> {
  messageInserted: (chatId: string) => void;
  messageStatusChanged: (clientMsgId: string) => void;
  typingChanged: (chatId: string, fromUserId: string, isTyping: boolean) => void;
}

export type SendResult = { ok: true } | { ok: false; reason: "NO_CONTACT" | "NOT_READY" };

interface AppContextValue {
  identity: DeviceIdentity;
  connectionState: ConnectionState;
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
  createInvite: () => Promise<InviteCreatedPayload | null>;
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

      ws.events.on("state", setConnectionState);

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

    return () => {
      cancelled = true;
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
      return { ok: true };
    }

    return {
      identity,
      connectionState,
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
      createInvite() {
        const ws = wsRef.current;
        if (!ws) return Promise.resolve(null);
        return new Promise<InviteCreatedPayload | null>((resolve) => {
          const timeout = setTimeout(() => {
            unsubscribe();
            resolve(null);
          }, 12_000);
          const unsubscribe = ws.events.on("inviteCreated", (payload) => {
            clearTimeout(timeout);
            unsubscribe();
            resolve(payload);
          });
          ws.requestInvite();
        });
      },
    };
  }, [identity, connectionState, contacts, chatEvents, myFingerprint]);

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
