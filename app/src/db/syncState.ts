import { getDb } from "./database";
import { UPSERT_SYNC_STATE } from "./sql";

/**
 * Курсор синхронизации чата: время последнего полученного сообщения И его id.
 *
 * Одного времени не хватало. Сообщения, отправленные пачкой, попадают в одну
 * миллисекунду, и если такая группа разрывалась границей страницы истории,
 * условие «строго новее времени» теряло остаток — молча, без единой ошибки. Пара
 * (время, id) задаёт строгий порядок, в котором пропустить нечего.
 */
export interface SyncCursor {
  ts: number;
  /** null — синхронизации ещё не было либо база от прежней версии. */
  id: string | null;
}

export async function getSyncCursor(chatId: string): Promise<SyncCursor> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ last_synced_ts: number; last_synced_id: string | null }>(
    "SELECT last_synced_ts, last_synced_id FROM sync_state WHERE chat_id = ?",
    [chatId],
  );
  return { ts: row?.last_synced_ts ?? 0, id: row?.last_synced_id ?? null };
}

/**
 * Курсор двигаем только вперёд.
 *
 * Страницы истории приходят по порядку, но события могут наложиться (пришло
 * живое сообщение, пока разбиралась страница). MAX по времени защищает от
 * откатов назад: откатившийся курсор означал бы повторную загрузку того, что уже
 * разобрано.
 */
export async function setSyncCursor(chatId: string, ts: number, id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(UPSERT_SYNC_STATE, [chatId, ts, id]);
}
