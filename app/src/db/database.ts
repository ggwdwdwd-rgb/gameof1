import * as SQLite from "expo-sqlite";

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS contacts (
  user_id               TEXT PRIMARY KEY,
  device_id             TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  identity_public_key   TEXT NOT NULL,
  encryption_public_key TEXT NOT NULL,
  fingerprint           TEXT NOT NULL,
  is_revoked            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  client_msg_id  TEXT NOT NULL UNIQUE,
  chat_id        TEXT NOT NULL,
  from_user_id   TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  plaintext      TEXT,
  reply_to       TEXT,
  status         TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  deleted_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS outbox (
  client_msg_id  TEXT PRIMARY KEY,
  payload_json   TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  chat_id       TEXT PRIMARY KEY,
  last_synced_ts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let dbPromise: Promise<SQLite.SQLiteDatabase> | undefined;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync("family-messenger.db").then(async (db) => {
    await db.execAsync(SCHEMA);
    return db;
  });
  return dbPromise;
}
