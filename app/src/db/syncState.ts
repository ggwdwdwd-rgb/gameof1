import { getDb } from "./database";

/** Момент последнего полученного сообщения в чате — точка отсчёта для history.fetch после реконнекта. */
export async function getLastSyncedTs(chatId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ last_synced_ts: number }>(
    "SELECT last_synced_ts FROM sync_state WHERE chat_id = ?",
    [chatId],
  );
  return row?.last_synced_ts ?? 0;
}

export async function setLastSyncedTs(chatId: string, ts: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_state (chat_id, last_synced_ts) VALUES (?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET last_synced_ts = MAX(last_synced_ts, excluded.last_synced_ts)`,
    [chatId, ts],
  );
}
