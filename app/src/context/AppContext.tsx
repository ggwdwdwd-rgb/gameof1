import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createCrypto } from "@family-messenger/crypto";
import { getCrypto } from "../crypto/sodium";
import { getContact, listContacts, upsertContact, type Contact } from "../db/contacts";
import {
  insertMessage,
  listMessagesForChat,
  markMessageDeleted,
  messageExists,
  updateMessageStatus,
  type LocalMessage,
} from "../db/messages";
import { saveGroupKey } from "../db/groupKeys";
import { getLastSyncedTs, setLastSyncedTs } from "../db/syncState";
import { decryptDeliveredMessage, encryptForChat } from "../chat/encryption";
import { GROUP_CHAT_ID, dmChatId } from "../chat/chatId";
import { bootstrapGroupKeyIfFirstUser, distributeGroupKeyToContact, parseGroupKeyMessage } from "../chat/groupKeySync";
import { saveIncomingEnvelope, type LocalMediaMeta } from "../chat/media";
import { WsClient, type ConnectionState } from "../net/wsClient";
import type { MsgDeliverPayload, RosterMemberPayload } from "../net/protocol";
import type { DeviceIdentity } from "../storage/identity";
import { Emitter } from "../util/emitter";
import { uuidv4 } from "../util/uuid";

type Crypto = ReturnType<typeof createCrypto>;

const MEDIA_CONTENT_TYPES = new Set(["image", "voice", "file"]);

interface ChatEvents extends Record<string, (...args: never[]) => void> {
  messageInserted: (chatId: string) => void;
  messageStatusChanged: (clientMsgId: string) => void;
  typingChanged: (chatId: string, fromUserId: string, isTyping: boolean) => void;
}

interface AppContextValue {
  identity: DeviceIdentity;
  connectionState: ConnectionState;
  contacts: Contact[];
  chatEvents: Emitter<ChatEvents>;
  sendText: (chatId: string, text: string, replyTo?: string | null) => Promise<void>;
  sendMedia: (
    chatId: string,
    contentType: "image" | "voice" | "file",
    envelopeJson: string,
    localMeta: LocalMediaMeta,
    replyTo?: string | null,
  ) => Promise<void>;
  sendLocation: (chatId: string, lat: number, lng: number, replyTo?: string | null) => Promise<void>;
  deleteMessage: (msgId: string, chatId: string) => Promise<void>;
  markRead: (msgId: string, chatId: string) => void;
  setTyping: (chatId: string, isTyping: boolean) => void;
  loadMessages: (chatId: string) => Promise<LocalMessage[]>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp() вызван вне AppProvider");
  return ctx;
}

async function contactFromRoster(crypto: Crypto, member: RosterMemberPayload): Promise<Contact> {
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
  const cryptoRef = useRef<Crypto | null>(null);
  const wsRef = useRef<WsClient | null>(null);
  const contactsRef = useRef<Contact[]>([]);
  const chatEvents = useMemo(() => new Emitter<ChatEvents>(), []);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const crypto = await getCrypto();
      if (cancelled) return;
      cryptoRef.current = crypto;

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
        const contact = await contactFromRoster(crypto, member);
        await upsertContact(contact);
        setContacts((prev) => {
          const next = prev.filter((c) => c.userId !== contact.userId);
          next.push(contact);
          return next;
        });
        return contact;
      }

      ws.events.on("roster", (payload) => {
        void (async () => {
          const rosterIsEmpty = payload.members.length === 0;
          await bootstrapGroupKeyIfFirstUser(crypto, rosterIsEmpty);
          for (const member of payload.members) {
            const contact = await upsertAndTrack(member);
            void distributeGroupKeyToContact(crypto, ws, identity, contact);
          }
          // синхронизация истории по всем известным чатам после (пере)подключения
          const chatIds = [GROUP_CHAT_ID, ...payload.members.map((m) => dmChatId(identity.userId, m.userId))];
          for (const chatId of chatIds) {
            ws.fetchHistory(chatId, await getLastSyncedTs(chatId));
          }
        })();
      });

      ws.events.on("memberJoined", (member) => {
        void (async () => {
          const contact = await upsertAndTrack(member);
          await distributeGroupKeyToContact(crypto, ws, identity, contact);
        })();
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
        // msgId у нас всегда равен clientMsgId (см. ARCHITECTURE.md — сервер не меняет id)
        void updateMessageStatus(payload.msgId, payload.status).then(() => {
          chatEvents.emit("messageStatusChanged", payload.msgId);
        });
      });

      ws.events.on("typingRelay", (payload) => {
        chatEvents.emit("typingChanged", payload.chatId, payload.fromUserId, payload.isTyping);
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
    ): Promise<void> {
      const crypto = cryptoRef.current;
      const ws = wsRef.current;
      if (!crypto || !ws) return;

      const contactsByUserId = new Map(contactsRef.current.map((c) => [c.userId, c]));
      const encrypted = await encryptForChat(crypto, identity, chatId, wireContent, contactsByUserId);
      if (!encrypted) return; // нет ключа (ещё не пришёл group key/контакт неизвестен) — сообщение не уйдёт молча

      const clientMsgId = uuidv4();
      const createdAt = Date.now();

      await insertMessage({
        id: clientMsgId,
        clientMsgId,
        chatId,
        fromUserId: identity.userId,
        contentType,
        plaintext: localPlaintext,
        replyTo,
        status: "pending",
        createdAt,
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
        keyVersion: encrypted.keyVersion,
      });
    }

    return {
      identity,
      connectionState,
      contacts,
      chatEvents,
      async sendText(chatId, text, replyTo = null) {
        await sendEncrypted(chatId, "text", text, text, replyTo);
      },
      async sendMedia(chatId, contentType, envelopeJson, localMeta, replyTo = null) {
        await sendEncrypted(chatId, contentType, envelopeJson, JSON.stringify(localMeta), replyTo);
      },
      async sendLocation(chatId, lat, lng, replyTo = null) {
        const json = JSON.stringify({ lat, lng });
        await sendEncrypted(chatId, "location", json, json, replyTo);
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
      async loadMessages(chatId) {
        return listMessagesForChat(chatId);
      },
    };
  }, [identity, connectionState, contacts, chatEvents]);

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

  if (payload.contentType === "system_group_key") {
    const contact = await getContact(payload.fromUserId);
    if (!contact) return;
    const plaintext = await decryptDeliveredMessage(crypto, identity, payload, new Map([[contact.userId, contact]]));
    if (!plaintext) return;
    const groupKey = parseGroupKeyMessage(plaintext);
    if (groupKey) {
      await saveGroupKey(groupKey.chatId, groupKey.keyVersion, groupKey.key);
    }
    if (!options.skipAck) ws.ackMessage(payload.msgId, payload.chatId, "delivered");
    return;
  }

  const contactsList = await listContacts();
  const contactsByUserId = new Map(contactsList.map((c) => [c.userId, c]));
  const decrypted = await decryptDeliveredMessage(crypto, identity, payload, contactsByUserId);

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
