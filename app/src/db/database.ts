import * as SQLite from "expo-sqlite";
import { SCHEMA } from "./sql";

let dbPromise: Promise<SQLite.SQLiteDatabase> | undefined;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync("family-messenger.db").then(async (db) => {
    await db.execAsync(SCHEMA);
    return db;
  });
  return dbPromise;
}
