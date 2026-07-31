import * as SQLite from "expo-sqlite";
import { REQUIRED_COLUMNS, SCHEMA } from "./sql";

let dbPromise: Promise<SQLite.SQLiteDatabase> | undefined;

/**
 * Досоздаёт столбцы, появившиеся в новых версиях приложения.
 *
 * SQLite не умеет ADD COLUMN IF NOT EXISTS, поэтому сначала спрашиваем состав
 * таблицы. Без этого шага у всех, кто обновился (а не поставил с нуля), базы
 * остаются без новых столбцов — и приложение падает на первом же запросе.
 */
async function addMissingColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const { table, column, definition } of REQUIRED_COLUMNS) {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    if (columns.some((c) => c.name === column)) continue;
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync("family-messenger.db").then(async (db) => {
    await db.execAsync(SCHEMA);
    await addMissingColumns(db);
    return db;
  });
  return dbPromise;
}
