// Проверка прав «распоряжаться составом» на настоящем SQLite.
//
// Отдельно от e2e намеренно: здесь проверяется не протокол, а сама логика прав
// и миграция. Ошибка тут стоит дорого в обе стороны — либо любой участник может
// выкинуть любого, либо система остаётся без управления, и вернуть его можно
// только правкой базы руками.
//
// Запуск из папки server:  npm run test:users
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Своя база на прогон: env читается модулем db при импорте, поэтому путь
// подставляем до него.
const dir = mkdtempSync(join(tmpdir(), "cry-users-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.DOMAIN = "test.local";
process.env.ACME_EMAIL = "test@test.local";

const { runMigrations } = await import("../src/db/migrate.js");
const { db } = await import("../src/db/index.js");
const users = await import("../src/users.js");

let failed = 0;
function check(name, ok, extra = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

/**
 * Создаём участников ДО миграции 0003 — так же, как они лежали в базе у тех,
 * кто обновляется: без столбца is_admin вовсе. Это и есть проверка миграции.
 */
db.exec(`
CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE devices (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  identity_public_key TEXT NOT NULL, encryption_public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE invites (
  code TEXT PRIMARY KEY, created_by TEXT REFERENCES users(id), created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT REFERENCES users(id)
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, client_msg_id TEXT NOT NULL, chat_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL REFERENCES users(id), from_device_id TEXT NOT NULL REFERENCES devices(id),
  content_type TEXT NOT NULL, ciphertext BLOB NOT NULL, nonce BLOB NOT NULL, reply_to TEXT,
  key_version INTEGER, created_at INTEGER NOT NULL, ttl_expires_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE message_receipts (
  msg_id TEXT NOT NULL REFERENCES messages(id), user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (msg_id, user_id)
);
CREATE TABLE group_key_versions (
  chat_id TEXT NOT NULL, key_version INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, PRIMARY KEY (chat_id, key_version)
);
CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
INSERT INTO schema_migrations (name, applied_at) VALUES ('0001_init.sql', 0), ('0002_presence.sql', 0);
ALTER TABLE users ADD COLUMN last_seen_at INTEGER;
`);

const oldId = randomUUID();
const peerId = randomUUID();
const newId = randomUUID();
const insertUser = db.prepare("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)");
insertUser.run(oldId, "старый zy", 1000);
insertUser.run(peerId, "dramaqueen", 2000);
insertUser.run(newId, "новый zy", 3000);

// Устройство и сообщение старому участнику — чтобы проверить, что удаление
// уносит связанные записи, а не падает на foreign key.
db.prepare(
  `INSERT INTO devices (id, user_id, identity_public_key, encryption_public_key, created_at)
   VALUES (?, ?, 'ipk', 'epk', ?)`,
).run("dev-old", oldId, 1000);
db.prepare(
  `INSERT INTO messages (id, client_msg_id, chat_id, from_user_id, from_device_id, content_type,
                         ciphertext, nonce, created_at, ttl_expires_at)
   VALUES (?, ?, ?, ?, ?, 'text', x'00', x'00', ?, ?)`,
).run("m1", "m1", `dm:${oldId}:${peerId}`, oldId, "dev-old", 1000, 9_999_999_999_999);
db.prepare("INSERT INTO message_receipts (msg_id, user_id, status, updated_at) VALUES (?, ?, 'read', ?)").run(
  "m1",
  peerId,
  1000,
);

check("до миграции столбца is_admin нет", !db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "is_admin"));

// ── Миграция ────────────────────────────────────────────────────────────────
runMigrations();
check("миграция добавила is_admin", db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "is_admin"));
check("главным стал первый зарегистрированный", users.isAdmin(oldId), "поведение до миграции сохранено");
check("остальные не главные", !users.isAdmin(peerId) && !users.isAdmin(newId));
check("главный ровно один", users.adminCount() === 1, String(users.adminCount()));

// ── Передача права ──────────────────────────────────────────────────────────
users.setAdmin(newId, true);
check("право можно назначить второму", users.isAdmin(newId) && users.isAdmin(oldId));
check("теперь главных двое", users.adminCount() === 2, String(users.adminCount()));

users.setAdmin(oldId, false);
check("право можно снять", !users.isAdmin(oldId));
check("остался один главный", users.adminCount() === 1 && users.isAdmin(newId));

// ── Защита от системы без главного ──────────────────────────────────────────
check("удаление единственного главного запрещено", users.wouldLeaveNoAdmin(newId));
check("удаление не главного разрешено", !users.wouldLeaveNoAdmin(peerId));
check("удаление не главного со старыми правами разрешено", !users.wouldLeaveNoAdmin(oldId));

// ── Удаление участника уносит связанные записи ──────────────────────────────
const devicesBefore = users.deviceIdsOf(oldId);
check("устройства участника находятся", devicesBefore.length === 1, devicesBefore.join(","));

// Резервная копия тоже ссылается на users. Внешние ключи в базе включены, и без
// её удаления транзакция валится — это уже случалось с contacts, поэтому
// проверяем явно.
db.prepare("INSERT INTO backups (user_id, blob, size_bytes, updated_at) VALUES (?, ?, ?, ?)").run(
  oldId,
  '{"v":1,"salt":"x","nonce":"y","ciphertext":"z"}',
  46,
  4000,
);

const stats = users.removeUser(oldId);
check("удалено устройство", stats.devices === 1, String(stats.devices));
check("удалено сообщение", stats.messages === 1, String(stats.messages));
check("удалена квитанция", stats.receipts === 1, String(stats.receipts));
check("участника больше нет", !users.userExists(oldId));
check(
  "резервная копия удалена вместе с ним",
  db.prepare("SELECT COUNT(*) AS n FROM backups WHERE user_id = ?").get(oldId).n === 0,
);
check("остальные участники на месте", users.userExists(peerId) && users.userExists(newId));
check("главный не изменился", users.isAdmin(newId) && users.adminCount() === 1);

// ── Страховка при базе без главного ─────────────────────────────────────────
// Если признак не стоит ни у кого (например, базу правили руками), система
// не должна остаться без управления: работает прежнее правило.
db.prepare("UPDATE users SET is_admin = 0").run();
check("без главного правило возвращается к первому по времени", users.isAdmin(peerId), "peer зарегистрирован раньше");
check("второй по времени главным не становится", !users.isAdmin(newId));

// ── Новая пустая система ────────────────────────────────────────────────────
db.prepare("DELETE FROM messages").run();
// Связи контактов чистим первыми: таблица contacts появилась вместе с
// аккаунтами и ссылается на users, а внешние ключи в базе включены — без этого
// удаление участников падало с FOREIGN KEY constraint failed.
db.prepare("DELETE FROM contacts").run();
db.prepare("DELETE FROM backups").run();
db.prepare("DELETE FROM devices").run();
db.prepare("DELETE FROM users").run();
const freshId = randomUUID();
insertUser.run(freshId, "первый в новой системе", 5000);
users.grantAdminIfNobodyHasIt(freshId);
check("первый участник новой системы становится главным", users.isAdmin(freshId));

const secondId = randomUUID();
insertUser.run(secondId, "второй", 6000);
users.grantAdminIfNobodyHasIt(secondId);
check("второй участник главным не становится", !users.isAdmin(secondId));

db.close();
rmSync(dir, { recursive: true, force: true });

console.log(failed === 0 ? "\nПрава работают как задумано" : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
