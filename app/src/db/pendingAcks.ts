import { getDb } from "./database";

export interface PendingAck {
  msgId: string;
  chatId: string;
  status: "delivered" | "read";
}

/**
 * Квитанции, которые не удалось отправить из-за отсутствия связи.
 *
 * Нужны, чтобы «прочитано» не терялось: локально сообщение помечается
 * прочитанным сразу (иначе счётчик непрочитанного не гаснет при открытии чата),
 * а собеседнику подтверждение уходит при первой же возможности. Повторять все
 * квитанции при каждом переподключении нельзя — именно это раньше и создавало
 * поток лишних пакетов, поэтому здесь лежат только неотправленные.
 */
export async function queueAck(ack: PendingAck): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO pending_acks (msg_id, chat_id, status) VALUES (?, ?, ?)
     ON CONFLICT(msg_id) DO UPDATE SET status = excluded.status, chat_id = excluded.chat_id`,
    [ack.msgId, ack.chatId, ack.status],
  );
}

export async function listPendingAcks(): Promise<PendingAck[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ msg_id: string; chat_id: string; status: string }>(
    "SELECT msg_id, chat_id, status FROM pending_acks",
  );
  return rows.map((row) => ({
    msgId: row.msg_id,
    chatId: row.chat_id,
    status: row.status === "read" ? "read" : "delivered",
  }));
}

export async function removePendingAck(msgId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM pending_acks WHERE msg_id = ?", [msgId]);
}
