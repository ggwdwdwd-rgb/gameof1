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

console.log("Участники и устройства");
for (const row of db
  .prepare(
    `SELECT u.display_name AS name, d.id AS device_id, d.revoked_at, d.created_at
     FROM devices d JOIN users u ON u.id = d.user_id
     ORDER BY d.created_at ASC`,
  )
  .all() as { name: string; device_id: string; revoked_at: number | null; created_at: number }[]) {
  const state = row.revoked_at === null ? "активно" : "отозвано";
  console.log(`  ${row.name} — устройство ${row.device_id} (${state}, добавлено ${new Date(row.created_at).toLocaleString("ru-RU")})`);
}

console.log("\nСчётчики");
for (const table of ["users", "devices", "messages", "message_receipts", "invites"]) {
  console.log(`  ${table}: ${count(table)}`);
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
