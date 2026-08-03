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
  -- @тег участника: по нему его нашли. NULL — аккаунт без тега (заведён по
  -- одноразовому коду, до появления аккаунтов).
  username              TEXT,
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
  last_synced_ts INTEGER NOT NULL DEFAULT 0,
  -- id последнего разобранного сообщения: вторая половина курсора. Только по
  -- времени сообщения из одной миллисекунды терялись на границе страницы.
  last_synced_id TEXT
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
  { table: "sync_state", column: "last_synced_id", definition: "TEXT" },
  { table: "contacts", column: "username", definition: "TEXT" },
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

/**
 * Сообщения чата для показа на экране: последние `limit`, снизу вверх.
 *
 * Вложенный запрос обязателен. Раньше здесь было просто
 * `ORDER BY created_at ASC LIMIT ?` — то есть выбирались САМЫЕ СТАРЫЕ 200
 * сообщений. Пока переписка была короче двухсот, разницы не было; как только
 * она подросла, окно навсегда заняли старые сообщения, и новые — и свои, и
 * входящие — перестали появляться в чате вовсе. Снаружи это выглядело как
 * «сообщения не идут»: они писались в базу, доходили до собеседника, но на
 * экране не показывались.
 *
 * Поэтому сначала берём хвост (DESC + LIMIT), а потом разворачиваем обратно —
 * список рисуется по возрастанию времени.
 */
export const SELECT_CHAT_MESSAGES = `
SELECT * FROM (
  SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?
) ORDER BY created_at ASC`;

/**
 * Курсор синхронизации: время и id последнего разобранного сообщения.
 *
 * Время двигается только вперёд (MAX): страницы истории и живые сообщения могут
 * наложиться, а откатившийся курсор означал бы повторную загрузку уже
 * разобранного. id пишем вместе со временем — иначе пара разъехалась бы.
 */
export const UPSERT_SYNC_STATE = `
INSERT INTO sync_state (chat_id, last_synced_ts, last_synced_id) VALUES (?, ?, ?)
ON CONFLICT(chat_id) DO UPDATE SET
  last_synced_ts = MAX(last_synced_ts, excluded.last_synced_ts),
  last_synced_id = CASE WHEN excluded.last_synced_ts >= last_synced_ts THEN excluded.last_synced_id ELSE last_synced_id END`;

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
