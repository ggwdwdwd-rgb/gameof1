// Состояние сервера одной командой — что в базе и кто подключён.
// Запуск на VPS:  docker compose exec server node dist/cli/status.js
// Локально:       npm run status
import { runMigrations } from "../db/migrate.js";
import { db } from "../db/index.js";

runMigrations();

function count(table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

/** «1.4 МБ» — байты читать глазами неудобно. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

console.log("Участники и устройства");
for (const row of db
  .prepare(
    `SELECT u.display_name AS name, u.username, u.email, d.id AS device_id, d.revoked_at, d.created_at
     FROM devices d JOIN users u ON u.id = d.user_id
     ORDER BY d.created_at ASC`,
  )
  .all() as {
  name: string;
  username: string | null;
  email: string | null;
  device_id: string;
  revoked_at: number | null;
  created_at: number;
}[]) {
  const state = row.revoked_at === null ? "активно" : "отозвано";
  // @тег и почта — то, по чему человека находят и чем он входит; без них
  // непонятно, кому какой аккаунт принадлежит. Пароль, разумеется, не показываем
  // и показать не можем: в базе только хэш Argon2id.
  const account = [row.username === null ? null : `@${row.username}`, row.email].filter((x) => x !== null).join(", ");
  console.log(
    `  ${row.name}${account === "" ? " (по инвайту, без аккаунта)" : ` (${account})`} — устройство ${row.device_id} (${state}, добавлено ${new Date(row.created_at).toLocaleString("ru-RU")})`,
  );
}

console.log("\nСчётчики");
for (const table of ["users", "devices", "messages", "message_receipts", "invites", "contacts", "backups"]) {
  console.log(`  ${table}: ${count(table)}`);
}

// Место на диске — главный операционный вопрос: VPS маленький, а сообщения с
// медиа доходят до десятков мегабайт каждое. Отдельно показываем WAL: он растёт
// между контрольными точками, и это не «утечка».
console.log("\nМесто в базе");
const pageSize = (db.pragma("page_size", { simple: true }) as number) ?? 0;
const pageCount = (db.pragma("page_count", { simple: true }) as number) ?? 0;
console.log(`  файл базы: ${humanSize(pageSize * pageCount)}`);
const freePages = (db.pragma("freelist_count", { simple: true }) as number) ?? 0;
console.log(`  из них свободно после удалений: ${humanSize(pageSize * freePages)} (вернёт диску только VACUUM)`);

const blobs = db
  .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(ciphertext)), 0) AS bytes FROM messages")
  .get() as { n: number; bytes: number };
console.log(`  шифротекст сообщений: ${humanSize(blobs.bytes)} в ${blobs.n} шт.`);

const byType = db
  .prepare(
    `SELECT content_type, COUNT(*) AS n, COALESCE(SUM(LENGTH(ciphertext)), 0) AS bytes
     FROM messages GROUP BY content_type ORDER BY bytes DESC`,
  )
  .all() as { content_type: string; n: number; bytes: number }[];
for (const row of byType) {
  console.log(`    ${row.content_type}: ${humanSize(row.bytes)} в ${row.n} шт.`);
}

const backups = db
  .prepare(
    `SELECT u.display_name AS name, b.size_bytes, b.updated_at
     FROM backups b JOIN users u ON u.id = b.user_id
     ORDER BY b.size_bytes DESC`,
  )
  .all() as { name: string; size_bytes: number; updated_at: number }[];
if (backups.length === 0) {
  console.log("  резервные копии: ни одной");
} else {
  const total = backups.reduce((sum, row) => sum + row.size_bytes, 0);
  console.log(`  резервные копии: ${humanSize(total)} в ${backups.length} шт.`);
  for (const row of backups) {
    console.log(
      `    ${row.name}: ${humanSize(row.size_bytes)}, обновлена ${new Date(row.updated_at).toLocaleString("ru-RU")}`,
    );
  }
}

console.log("\nНеиспользованные коды приглашений");
const invites = db
  .prepare("SELECT code, expires_at FROM invites WHERE used_by IS NULL ORDER BY expires_at DESC")
  .all() as { code: string; expires_at: number }[];
if (invites.length === 0) {
  console.log("  нет");
} else {
  for (const invite of invites) {
    const state = invite.expires_at < Date.now() ? "просрочен" : "действует";
    console.log(`  ${invite.code} — ${state} до ${new Date(invite.expires_at).toLocaleString("ru-RU")}`);
  }
}

console.log("\nПоследние сообщения (только метаданные, без содержимого)");
const messages = db
  .prepare("SELECT id, chat_id, from_user_id, content_type, created_at FROM messages ORDER BY created_at DESC LIMIT 10")
  .all() as { id: string; chat_id: string; from_user_id: string; content_type: string; created_at: number }[];
if (messages.length === 0) {
  console.log("  нет — ни одно сообщение до сервера не дошло");
} else {
  for (const message of messages) {
    console.log(
      `  ${new Date(message.created_at).toLocaleString("ru-RU")} ${message.content_type} чат ${message.chat_id} от ${message.from_user_id}`,
    );
  }
}
