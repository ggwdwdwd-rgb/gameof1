/**
 * Схема локальной базы и запросы, которые сложно проверить типами.
 *
 * Лежат отдельным файлом без импортов намеренно: expo-sqlite в Node не
 * запустить, а этот модуль читается проверочным скриптом
 * (app/scripts/check-sql.mjs) и прогоняется на настоящем SQLite. Так тест
 * проверяет тот же SQL, который выполняется на устройстве, а не его копию.
 */

export const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS contacts (
  user_id               TEXT PRIMARY KEY,
  device_id             TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  identity_public_key   TEXT NOT NULL,
  encryption_public_key TEXT NOT NULL,
  fingerprint           TEXT NOT NULL,
  is_revoked            INTEGER NOT NULL DEFAULT 0,
  -- Своё название контакта. Имя из roster задаёт сам человек, а подписать его
  -- по-своему («Мама», «Паша с работы») — дело каждого и наружу не уходит.
  local_name            TEXT
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
-- Индекс под подсчёт непрочитанного и отметку чата прочитанным.
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(status, from_user_id, chat_id);

CREATE TABLE IF NOT EXISTS outbox (
  client_msg_id  TEXT PRIMARY KEY,
  payload_json   TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

-- Квитанции, которые не удалось отправить (не было связи). Повторяются после
-- переподключения. Раньше их просто теряли, и у собеседника сообщение навсегда
-- оставалось «доставлено» вместо «прочитано».
CREATE TABLE IF NOT EXISTS pending_acks (
  msg_id   TEXT PRIMARY KEY,
  chat_id  TEXT NOT NULL,
  status   TEXT NOT NULL
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

/**
 * Столбцы, которые нужно добавить в уже существующие таблицы.
 *
 * CREATE TABLE IF NOT EXISTS на существующей таблице не делает ничего, поэтому
 * новый столбец в её описании появляется только у тех, кто ставит приложение с
 * нуля. Именно на этом я и ошибся с local_name: у всех, кто обновился, база
 * осталась без него, и приложение падало с «no such column: local_name».
 *
 * Имена таблиц и столбцов здесь — константы из кода, не пользовательский ввод.
 */
export const REQUIRED_COLUMNS: readonly { table: string; column: string; definition: string }[] = [
  { table: "contacts", column: "local_name", definition: "TEXT" },
];

/**
 * Статус двигается только вперёд: квитанции от сервера приходят не по порядку,
 * и без этого условия «прочитано» снова превращалось в «доставлено» — галочки
 * в чате мигали туда-обратно.
 */
export const UPDATE_STATUS_MONOTONIC = `
UPDATE messages SET status = ?
WHERE client_msg_id = ? AND (
  CASE status WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 WHEN 'sent' THEN 2
              WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 ELSE 0 END
) < ?`;

/**
 * Отметка «доступ устройства отозван» — и снятие её обратно.
 *
 * Именно UPDATE, а не удаление записи: переписка и открытые ключи участника
 * должны остаться (отзыв обратим, а его прежние сообщения расшифровываются
 * этими же ключами).
 */
export const UPDATE_CONTACT_REVOKED = "UPDATE contacts SET is_revoked = ? WHERE user_id = ?";

/** Непрочитанные входящие конкретного чата: их id нужны для квитанций. */
export const SELECT_CHAT_UNREAD = `
SELECT id FROM messages
WHERE chat_id = ? AND from_user_id != ? AND status = 'delivered' AND deleted_at IS NULL`;

export const MARK_CHAT_READ = `
UPDATE messages SET status = 'read'
WHERE chat_id = ? AND from_user_id != ? AND status = 'delivered' AND deleted_at IS NULL`;

/** Последнее сообщение сразу по всем чатам — одним запросом вместо запроса на чат. */
export const SELECT_LAST_MESSAGES = `
SELECT * FROM messages WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at DESC) AS rn
    FROM messages WHERE deleted_at IS NULL
  ) WHERE rn = 1
)`;

/** Счётчики непрочитанного сразу по всем чатам — тоже одним запросом. */
export const SELECT_UNREAD_COUNTS = `
SELECT chat_id, COUNT(*) AS n FROM messages
WHERE from_user_id != ? AND status = 'delivered' AND deleted_at IS NULL
GROUP BY chat_id`;
