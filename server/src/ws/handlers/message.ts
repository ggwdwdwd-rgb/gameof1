import { db } from "../../db/index.js";
import { env } from "../../env.js";
import { isParticipant, recipientUserIds } from "./chat.js";
import type { HistoryFetchPayload, MsgAckPayload, MsgDeletePayload, MsgSendPayload } from "../types.js";

export interface DeliverableMessage {
  msgId: string;
  chatId: string;
  fromUserId: string;
  fromDeviceId: string;
  contentType: string;
  ciphertext: string;
  nonce: string;
  replyTo: string | null;
  ts: number;
  ttlExpiresAt: number;
  keyVersion: number | null;
}

interface MessageRow {
  id: string;
  chat_id: string;
  from_user_id: string;
  from_device_id: string;
  content_type: string;
  ciphertext: Buffer;
  nonce: Buffer;
  reply_to: string | null;
  created_at: number;
  ttl_expires_at: number;
  key_version: number | null;
}

function rowToDeliverable(row: MessageRow): DeliverableMessage {
  return {
    msgId: row.id,
    chatId: row.chat_id,
    fromUserId: row.from_user_id,
    fromDeviceId: row.from_device_id,
    contentType: row.content_type,
    // Именно base64url (без «=»): libsodium на клиенте по умолчанию читает
    // вариант URLSAFE_NO_PADDING и на обычном base64 бросает исключение —
    // из-за этого сообщения из history.fetch не расшифровывались.
    ciphertext: row.ciphertext.toString("base64url"),
    nonce: row.nonce.toString("base64url"),
    replyTo: row.reply_to,
    ts: row.created_at,
    ttlExpiresAt: row.ttl_expires_at,
    keyVersion: row.key_version,
  };
}

export type MsgSendResult =
  | { ok: true; message: DeliverableMessage; recipients: string[] }
  | { ok: false; code: "NOT_PARTICIPANT" | "DUPLICATE" };

export function handleMsgSend(fromUserId: string, fromDeviceId: string, payload: MsgSendPayload): MsgSendResult {
  if (!isParticipant(payload.chatId, fromUserId)) return { ok: false, code: "NOT_PARTICIPANT" };

  const existing = db.prepare("SELECT id FROM messages WHERE id = ?").get(payload.clientMsgId);
  if (existing) return { ok: false, code: "DUPLICATE" };

  const now = Date.now();
  const ttlMs = (payload.ttlSec ?? env.messageTtlDays * 86400) * 1000;
  const keyVersion = payload.keyVersion ?? null;

  db.prepare(
    `INSERT INTO messages
       (id, client_msg_id, chat_id, from_user_id, from_device_id, content_type, ciphertext, nonce, reply_to, key_version, created_at, ttl_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    payload.clientMsgId,
    payload.clientMsgId,
    payload.chatId,
    fromUserId,
    fromDeviceId,
    payload.contentType,
    Buffer.from(payload.ciphertext, "base64"),
    Buffer.from(payload.nonce, "base64"),
    payload.replyTo,
    keyVersion,
    now,
    now + ttlMs,
  );

  return {
    ok: true,
    recipients: recipientUserIds(payload.chatId, fromUserId),
    message: {
      msgId: payload.clientMsgId,
      chatId: payload.chatId,
      fromUserId,
      fromDeviceId,
      contentType: payload.contentType,
      ciphertext: payload.ciphertext,
      nonce: payload.nonce,
      replyTo: payload.replyTo,
      ts: now,
      ttlExpiresAt: now + ttlMs,
      keyVersion,
    },
  };
}

export interface MsgAckResult {
  fromUserId: string;
  fromDeviceId: string;
}

export function handleMsgAck(ackerUserId: string, payload: MsgAckPayload): MsgAckResult | null {
  const message = db
    .prepare("SELECT from_user_id, from_device_id FROM messages WHERE id = ?")
    .get(payload.msgId) as { from_user_id: string; from_device_id: string } | undefined;
  if (!message) return null;

  db.prepare(
    `INSERT INTO message_receipts (msg_id, user_id, status, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(msg_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
  ).run(payload.msgId, ackerUserId, payload.status, Date.now());

  return { fromUserId: message.from_user_id, fromDeviceId: message.from_device_id };
}

export type MsgDeleteResult =
  | { ok: true; chatId: string }
  | { ok: false; code: "NOT_FOUND" | "NOT_OWNER" };

/** Удалить у всех может только автор сообщения (см. ARCHITECTURE.md — "удаление у всех"). */
export function handleMsgDelete(fromUserId: string, payload: MsgDeletePayload): MsgDeleteResult {
  const message = db
    .prepare("SELECT chat_id, from_user_id FROM messages WHERE id = ?")
    .get(payload.msgId) as { chat_id: string; from_user_id: string } | undefined;
  if (!message) return { ok: false, code: "NOT_FOUND" };
  if (message.from_user_id !== fromUserId) return { ok: false, code: "NOT_OWNER" };

  db.prepare("UPDATE messages SET deleted_at = ? WHERE id = ?").run(Date.now(), payload.msgId);
  return { ok: true, chatId: message.chat_id };
}

export function handleHistoryFetch(userId: string, payload: HistoryFetchPayload): DeliverableMessage[] | null {
  if (!isParticipant(payload.chatId, userId)) return null;

  const limit = Math.min(payload.limit ?? 100, 500);
  const rows = db
    .prepare(
      `SELECT id, chat_id, from_user_id, from_device_id, content_type, ciphertext, nonce, reply_to, key_version, created_at, ttl_expires_at
       FROM messages
       WHERE chat_id = ? AND created_at > ? AND deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(payload.chatId, payload.sinceTs, limit) as MessageRow[];

  return rows.map(rowToDeliverable);
}
