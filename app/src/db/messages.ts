import { getDb } from "./database";

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

export async function updateMessageStatus(clientMsgId: string, status: MessageStatus): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE messages SET status = ? WHERE client_msg_id = ?", [status, clientMsgId]);
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
