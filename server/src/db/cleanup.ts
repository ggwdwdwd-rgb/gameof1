import { db } from "./index.js";
import { GROUP_CHAT_ID, recipientUserIds } from "../ws/handlers/chat.js";

interface PendingRow {
  id: string;
  chat_id: string;
  from_user_id: string;
}

/**
 * Раз в час (см. ARCHITECTURE.md §5): убираем то, что сервер по дизайну не
 * должен хранить долго — удалённые, просроченные по TTL, либо уже доставленные
 * всем текущим получателям сообщения.
 */
export function cleanupMessages(): number {
  const now = Date.now();

  const deletedOrExpired = db
    .prepare("DELETE FROM messages WHERE deleted_at IS NOT NULL OR ttl_expires_at < ?")
    .run(now).changes;

  const pending = db
    .prepare("SELECT id, chat_id, from_user_id FROM messages")
    .all() as PendingRow[];

  let deliveredCleanup = 0;
  for (const row of pending) {
    const recipients = row.chat_id === GROUP_CHAT_ID || row.chat_id.startsWith("dm:")
      ? recipientUserIds(row.chat_id, row.from_user_id)
      : [];
    if (recipients.length === 0) continue;

    const receipts = db
      .prepare(`SELECT user_id FROM message_receipts WHERE msg_id = ? AND status IN ('delivered', 'read')`)
      .all(row.id) as { user_id: string }[];
    const receivedBy = new Set(receipts.map((r) => r.user_id));

    if (recipients.every((userId) => receivedBy.has(userId))) {
      db.prepare("DELETE FROM messages WHERE id = ?").run(row.id);
      db.prepare("DELETE FROM message_receipts WHERE msg_id = ?").run(row.id);
      deliveredCleanup++;
    }
  }

  return deletedOrExpired + deliveredCleanup;
}
