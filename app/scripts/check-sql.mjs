// Прогон запросов локальной базы на настоящем SQLite.
//
// expo-sqlite в Node не запустить, но SQL там обычный. Запросы и схема берутся
// из src/db/sql.ts — то есть проверяется тот же текст, который выполняется на
// устройстве. better-sqlite3 берём из сервера, чтобы не тянуть его в клиент.
//
// Запуск из папки app:  node --experimental-strip-types scripts/check-sql.mjs
// либо через tsx:       npx tsx scripts/check-sql.mjs
import { createRequire } from "node:module";
import {
  MARK_CHAT_READ,
  REQUIRED_COLUMNS,
  SCHEMA,
  SELECT_CHAT_MESSAGES,
  SELECT_CHAT_UNREAD,
  SELECT_LAST_MESSAGES,
  SELECT_UNREAD_COUNTS,
  UPDATE_CONTACT_REVOKED,
  UPDATE_STATUS_MONOTONIC,
} from "../src/db/sql.ts";

const require_ = createRequire(import.meta.url);
const Database = require_("../../server/node_modules/better-sqlite3");

let failed = 0;
function check(name, ok, extra = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

function freshDb() {
  const db = new Database(":memory:");
  // PRAGMA journal_mode = WAL в памяти не применяется — это нормально.
  db.exec(SCHEMA);
  return db;
}

const db = freshDb();
check("схема применяется без ошибок", true);

const ME = "me";
const CHAT_A = "dm:a:me";
const CHAT_B = "dm:b:me";

const insert = db.prepare(
  `INSERT INTO messages (id, client_msg_id, chat_id, from_user_id, content_type, plaintext, reply_to, status, created_at, deleted_at)
   VALUES (?, ?, ?, ?, 'text', ?, NULL, ?, ?, ?)`,
);
function add(id, chat, from, status, ts, deletedAt = null) {
  insert.run(id, id, chat, from, `текст ${id}`, status, ts, deletedAt);
}
function statusOf(id) {
  return db.prepare("SELECT status FROM messages WHERE id = ?").get(id).status;
}

// ── Статус двигается только вперёд ─────────────────────────────────────────
const STATUS_RANK = { failed: 0, pending: 1, sent: 2, delivered: 3, read: 4 };
const updateStatus = db.prepare(UPDATE_STATUS_MONOTONIC);
function setStatus(id, status) {
  return updateStatus.run(status, id, STATUS_RANK[status]).changes > 0;
}

add("m1", CHAT_A, ME, "pending", 1000);
check("pending → sent проходит", setStatus("m1", "sent") && statusOf("m1") === "sent");
check("sent → read проходит", setStatus("m1", "read") && statusOf("m1") === "read");
check("read → delivered не откатывается", setStatus("m1", "delivered") === false && statusOf("m1") === "read");
check("read → read не считается изменением", setStatus("m1", "read") === false);

// ── Отметка чата прочитанным ───────────────────────────────────────────────
add("in1", CHAT_A, "a", "delivered", 2000);
add("in2", CHAT_A, "a", "delivered", 2100);
add("in3", CHAT_A, "a", "delivered", 2200, 2300); // удалённое
add("in4", CHAT_B, "b", "delivered", 2400); // другой чат
add("out1", CHAT_A, ME, "sent", 2500); // своё

const toAck = db.prepare(SELECT_CHAT_UNREAD).all(CHAT_A, ME).map((r) => r.id);
db.prepare(MARK_CHAT_READ).run(CHAT_A, ME);
check("к подтверждению — только входящие этого чата", toAck.join(",") === "in1,in2", toAck.join(","));
check("удалённое не помечается прочитанным", statusOf("in3") === "delivered");
check("чужой чат не затронут", statusOf("in4") === "delivered");
check("своё сообщение не затронуто", statusOf("out1") === "sent");
check("повторный вызов ничего не находит", db.prepare(SELECT_CHAT_UNREAD).all(CHAT_A, ME).length === 0);

// ── Счётчики непрочитанного по всем чатам ──────────────────────────────────
add("in5", CHAT_B, "b", "delivered", 2600);
const counts = new Map(db.prepare(SELECT_UNREAD_COUNTS).all(ME).map((r) => [r.chat_id, r.n]));
check("в прочитанном чате непрочитанных нет", (counts.get(CHAT_A) ?? 0) === 0);
check("во втором чате два непрочитанных", counts.get(CHAT_B) === 2, String(counts.get(CHAT_B)));

// ── Последнее сообщение по всем чатам ──────────────────────────────────────
const lastStmt = db.prepare(SELECT_LAST_MESSAGES);
const last = new Map(lastStmt.all().map((r) => [r.chat_id, r]));
check("по одному последнему сообщению на чат", last.size === 2, String(last.size));
check("в первом чате последнее — out1", last.get(CHAT_A)?.id === "out1", last.get(CHAT_A)?.id);
check("во втором чате последнее — in5", last.get(CHAT_B)?.id === "in5", last.get(CHAT_B)?.id);

add("in6", CHAT_B, "b", "delivered", 2700, 2750);
check("удалённое не попадает в превью", lastStmt.all().find((r) => r.chat_id === CHAT_B)?.id === "in5");

// ── Очередь неотправленных квитанций ───────────────────────────────────────
const queueAck = db.prepare(
  `INSERT INTO pending_acks (msg_id, chat_id, status) VALUES (?, ?, ?)
   ON CONFLICT(msg_id) DO UPDATE SET status = excluded.status, chat_id = excluded.chat_id`,
);
queueAck.run("in1", CHAT_A, "delivered");
queueAck.run("in1", CHAT_A, "read"); // та же квитанция «повзрослела»
queueAck.run("in2", CHAT_A, "read");
const pending = db.prepare("SELECT msg_id, status FROM pending_acks ORDER BY msg_id").all();
check("очередь квитанций не дублирует сообщения", pending.length === 2, String(pending.length));
check("повторная запись обновляет статус", pending[0].status === "read", pending[0].status);
db.prepare("DELETE FROM pending_acks WHERE msg_id = ?").run("in1");
check("отправленная квитанция убирается из очереди", db.prepare("SELECT COUNT(*) AS n FROM pending_acks").get().n === 1);

// ── Экран чата показывает последние сообщения, а не первые ─────────────────
// Ровно этой проверки не хватало. В запросе стояло `ORDER BY created_at ASC
// LIMIT ?`, то есть выбирались самые СТАРЫЕ сообщения. Пока переписка была
// короче лимита, всё выглядело правильно; стоило ей подрасти — окно заняли
// старые сообщения, и новые перестали появляться в чате навсегда. Со стороны:
// «сообщения не идут», хотя они и в базе, и у собеседника.
const paging = freshDb();
const pagingInsert = paging.prepare(
  `INSERT INTO messages (id, client_msg_id, chat_id, from_user_id, content_type, plaintext, reply_to, status, created_at, deleted_at)
   VALUES (?, ?, ?, ?, 'text', ?, NULL, 'sent', ?, NULL)`,
);
const LONG_CHAT = "dm:a:me";
// 250 сообщений в чате при лимите 200 — как у живой переписки.
for (let i = 1; i <= 250; i += 1) {
  pagingInsert.run(`p${i}`, `p${i}`, LONG_CHAT, ME, `текст ${i}`, 1000 + i);
}
// Плюс чужой чат: запрос не должен его захватывать.
pagingInsert.run("other", "other", "dm:b:me", ME, "чужое", 9_999_999);

const page = paging.prepare(SELECT_CHAT_MESSAGES).all(LONG_CHAT, 200);
check("возвращается ровно лимит сообщений", page.length === 200, String(page.length));
check("самое новое сообщение попало в выборку", page.at(-1)?.id === "p250", String(page.at(-1)?.id));
check("окно взято с конца переписки, а не с начала", page[0]?.id === "p51", String(page[0]?.id));
check(
  "порядок по возрастанию времени (список рисуется снизу вверх)",
  page.every((row, i) => i === 0 || row.created_at >= page[i - 1].created_at),
);
check("чужой чат не попадает", page.every((row) => row.chat_id === LONG_CHAT));

// Свежая вставка обязана находиться сразу — это и проверяет самопроверка в
// приложении шагом «Локальная база пишется».
pagingInsert.run("probe", "probe", LONG_CHAT, ME, "самопроверка", Date.now());
check(
  "только что вставленное сообщение сразу видно",
  paging.prepare(SELECT_CHAT_MESSAGES).all(LONG_CHAT, 200).some((row) => row.id === "probe"),
);

// Короткая переписка не должна пострадать от вложенного запроса.
const shortChat = freshDb();
const shortInsert = shortChat.prepare(
  `INSERT INTO messages (id, client_msg_id, chat_id, from_user_id, content_type, plaintext, reply_to, status, created_at, deleted_at)
   VALUES (?, ?, ?, ?, 'text', ?, NULL, 'sent', ?, NULL)`,
);
for (let i = 1; i <= 3; i += 1) shortInsert.run(`s${i}`, `s${i}`, LONG_CHAT, ME, `текст ${i}`, 1000 + i);
const shortPage = shortChat.prepare(SELECT_CHAT_MESSAGES).all(LONG_CHAT, 200);
check(
  "короткая переписка отдаётся целиком и по порядку",
  shortPage.map((row) => row.id).join(",") === "s1,s2,s3",
  shortPage.map((row) => row.id).join(","),
);

// ── Обновление старой базы ─────────────────────────────────────────────────
// Именно этого теста и не хватало: столбец local_name я добавил в CREATE TABLE
// IF NOT EXISTS, а у всех, кто обновился, таблица уже была — и приложение
// падало с «no such column: local_name». Здесь воссоздаём базу прошлой версии
// и проверяем, что миграция её дотягивает.
const legacy = new Database(":memory:");
legacy.exec(`
CREATE TABLE contacts (
  user_id               TEXT PRIMARY KEY,
  device_id             TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  identity_public_key   TEXT NOT NULL,
  encryption_public_key TEXT NOT NULL,
  fingerprint           TEXT NOT NULL,
  is_revoked            INTEGER NOT NULL DEFAULT 0
);`);
legacy.prepare(
  "INSERT INTO contacts VALUES ('u1','d1','Аня','ipk','epk','FFFF',0)",
).run();

function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}
check("в старой базе столбца local_name нет", !columnsOf(legacy, "contacts").includes("local_name"));

// Тот же порядок, что в приложении: схема, затем досоздание столбцов.
legacy.exec(SCHEMA);
check("CREATE TABLE IF NOT EXISTS сам столбец не добавляет", !columnsOf(legacy, "contacts").includes("local_name"));

for (const { table, column, definition } of REQUIRED_COLUMNS) {
  if (columnsOf(legacy, table).includes(column)) continue;
  legacy.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
check("миграция добавляет local_name", columnsOf(legacy, "contacts").includes("local_name"));
check(
  "данные старой базы не потеряны",
  legacy.prepare("SELECT display_name, local_name FROM contacts WHERE user_id = 'u1'").get().display_name === "Аня",
);
check(
  "у старых контактов local_name пустой",
  legacy.prepare("SELECT local_name FROM contacts WHERE user_id = 'u1'").get().local_name === null,
);

// Повторный запуск не должен ломаться на уже добавленном столбце.
let secondRunFailed = false;
try {
  for (const { table, column, definition } of REQUIRED_COLUMNS) {
    if (columnsOf(legacy, table).includes(column)) continue;
    legacy.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
} catch {
  secondRunFailed = true;
}
check("повторный запуск миграции безопасен", !secondRunFailed);

// В базе, созданной с нуля, столбец есть сразу — миграции делать нечего.
check("в новой базе local_name есть сразу", columnsOf(freshDb(), "contacts").includes("local_name"));

// ── Отзыв доступа устройства ───────────────────────────────────────────────
// Отзыв не должен ничего терять: ни своё название контакта, ни открытые ключи.
// Без ключей прежние сообщения этого человека перестали бы расшифровываться, а
// снятие отзыва не вернуло бы переписку.
const revoke = legacy.prepare(UPDATE_CONTACT_REVOKED);
legacy.prepare("UPDATE contacts SET local_name = 'Аня с работы' WHERE user_id = 'u1'").run();
check("отзыв меняет ровно одну запись", revoke.run(1, "u1").changes === 1);
const revokedRow = legacy.prepare("SELECT * FROM contacts WHERE user_id = 'u1'").get();
check("признак отзыва записан", revokedRow.is_revoked === 1);
check("своё название контакта сохранилось", revokedRow.local_name === "Аня с работы");
check(
  "открытые ключи сохранились",
  revokedRow.identity_public_key === "ipk" && revokedRow.encryption_public_key === "epk",
);
revoke.run(0, "u1");
check("отзыв снимается", legacy.prepare("SELECT is_revoked FROM contacts WHERE user_id = 'u1'").get().is_revoked === 0);
check("отзыв неизвестного контакта ничего не меняет", revoke.run(1, "нет-такого").changes === 0);

// ── Пустая база ────────────────────────────────────────────────────────────
const empty = freshDb();
check("на пустой базе последние сообщения — пусто", empty.prepare(SELECT_LAST_MESSAGES).all().length === 0);
check("на пустой базе счётчики — пусто", empty.prepare(SELECT_UNREAD_COUNTS).all(ME).length === 0);

console.log(failed === 0 ? "\nВсе проверки SQL пройдены" : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
