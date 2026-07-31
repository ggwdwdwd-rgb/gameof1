import { getDb } from "./database";
import {
  MARK_CHAT_READ,
  SELECT_CHAT_UNREAD,
  SELECT_LAST_MESSAGES,
  SELECT_UNREAD_COUNTS,
  UPDATE_STATUS_MONOTONIC,
} from "./sql";

export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export interface LocalMessage {
  id: string;
  clientMsgId: string;
  chatId: string;
  fromUserId: string;
  contentType: string;
  plaintext: string | null;
  replyTo: string | null;
  status: MessageStatus;
  createdAt: number;
  deletedAt: number | null;
}

interface MessageRow {
  id: string;
  client_msg_id: string;
  chat_id: string;
  from_user_id: string;
  content_type: string;
  plaintext: string | null;
  reply_to: string | null;
  status: string;
  created_at: number;
  deleted_at: number | null;
}

function fromRow(row: MessageRow): LocalMessage {
  return {
    id: row.id,
    clientMsgId: row.client_msg_id,
    chatId: row.chat_id,
    fromUserId: row.from_user_id,
    contentType: row.content_type,
    plaintext: row.plaintext,
    replyTo: row.reply_to,
    status: row.status as MessageStatus,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

export async function insertMessage(message: LocalMessage): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO messages
       (id, client_msg_id, chat_id, from_user_id, content_type, plaintext, reply_to, status, created_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.clientMsgId,
      message.chatId,
      message.fromUserId,
      message.contentType,
      message.plaintext,
      message.replyTo,
      message.status,
      message.createdAt,
      message.deletedAt,
    ],
  );
}

/** Порядок «взросления» статуса: назад он не откатывается. */
const STATUS_RANK: Record<MessageStatus, number> = { failed: 0, pending: 1, sent: 2, delivered: 3, read: 4 };

/** true, если статус действительно изменился (см. UPDATE_STATUS_MONOTONIC). */
export async function updateMessageStatus(clientMsgId: string, status: MessageStatus): Promise<boolean> {
  const db = await getDb();
  const result = await db.runAsync(UPDATE_STATUS_MONOTONIC, [status, clientMsgId, STATUS_RANK[status]]);
  return result.changes > 0;
}

export async function listMessagesForChat(chatId: string, limit = 200): Promise<LocalMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MessageRow>(
    "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT ?",
    [chatId, limit],
  );
  return rows.map(fromRow);
}

export async function getLastMessageForChat(chatId: string): Promise<LocalMessage | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<MessageRow>(
    "SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [chatId],
  );
  return row ? fromRow(row) : null;
}

/**
 * Помечает входящие в чате прочитанными и возвращает id тех, что реально
 * изменились — их и надо подтвердить серверу.
 *
 * Раньше экран чата на каждое обновление проходил по всем сообщениям и звал
 * markRead для каждого «доставленного». Локальный статус при этом не менялся,
 * поэтому квитанции «прочитано» уходили заново при каждом событии — и каждая
 * из них вызывала у собеседника новое событие, то есть новое обновление.
 * Отсюда и были подлагивания.
 */
export async function markChatRead(chatId: string, myUserId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(SELECT_CHAT_UNREAD, [chatId, myUserId]);
  if (rows.length === 0) return [];
  await db.runAsync(MARK_CHAT_READ, [chatId, myUserId]);
  return rows.map((row) => row.id);
}

/** Последнее сообщение сразу по всем чатам — одним запросом вместо запроса на чат. */
export async function listLastMessages(): Promise<Map<string, LocalMessage>> {
  const db = await getDb();
  const rows = await db.getAllAsync<MessageRow>(SELECT_LAST_MESSAGES);
  return new Map(rows.map((row) => [row.chat_id, fromRow(row)]));
}

/** Счётчики непрочитанного сразу по всем чатам — тоже одним запросом. */
export async function listUnreadCounts(myUserId: string): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ chat_id: string; n: number }>(SELECT_UNREAD_COUNTS, [myUserId]);
  return new Map(rows.map((row) => [row.chat_id, row.n]));
}

export async function messageExists(clientMsgId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ client_msg_id: string }>(
    "SELECT client_msg_id FROM messages WHERE client_msg_id = ?",
    [clientMsgId],
  );
  return row !== null;
}

export async function markMessageDeleted(msgId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE messages SET deleted_at = ?, plaintext = NULL WHERE id = ?", [Date.now(), msgId]);
}
