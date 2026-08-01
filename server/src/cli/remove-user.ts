// Удаление участника целиком: сам участник, его устройства, сообщения и коды.
//
// Нужно после тестов и переустановок клиента: приложение при переустановке
// заводит новые ключи, то есть регистрируется как новый человек, а прежний
// остаётся в списке навсегда — писать ему бессмысленно, ключей от него уже ни у
// кого нет.
//
// Запуск на VPS:
//   docker compose exec server node dist/cli/remove-user.js              # список
//   docker compose exec server node dist/cli/remove-user.js --user=<ID>  # удалить
// Локально: npm run remove-user -- --user=<ID>
//
// Клиенты подчищают свои списки сами: roster с сервера — единственный источник
// правды, и участник, которого в нём нет, удаляется из локальной базы вместе с
// перепиской (см. AppContext, обработчик roster).
import { runMigrations } from "../db/migrate.js";
import { db } from "../db/index.js";

runMigrations();

interface UserRow {
  id: string;
  display_name: string;
  created_at: number;
  devices: number;
  messages: number;
}

function listUsers(): UserRow[] {
  return db
    .prepare(
      `SELECT u.id, u.display_name, u.created_at,
              (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id)   AS devices,
              (SELECT COUNT(*) FROM messages m WHERE m.from_user_id = u.id) AS messages
       FROM users u ORDER BY u.created_at ASC`,
    )
    .all() as UserRow[];
}

function argValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=").slice(1).join("=");
}

const users = listUsers();

function printUsers(): void {
  console.log("\nУчастники (по времени регистрации):\n");
  users.forEach((user, index) => {
    const first = index === 0 ? "  ← самый первый" : "";
    console.log(`  ${index + 1}. ${user.display_name}`);
    console.log(`     id: ${user.id}${first}`);
    console.log(
      `     зарегистрирован ${new Date(user.created_at).toLocaleString("ru-RU")}, устройств: ${user.devices}, сообщений: ${user.messages}`,
    );
  });
  console.log("");
}

const target = argValue("user");

if (!target) {
  printUsers();
  console.log("Чтобы удалить, повтори команду с id:");
  console.log("  node dist/cli/remove-user.js --user=<ID>\n");
  process.exit(0);
}

const user = users.find((u) => u.id === target);
if (!user) {
  printUsers();
  console.error(`Участника с id ${target} нет. Скопируй id из списка выше.`);
  process.exit(1);
}

/**
 * Удаляем одной транзакцией и в порядке зависимостей: foreign_keys = ON, и
 * ссылки на удаляемого участника иначе не дадут довести дело до конца, оставив
 * базу в половинчатом состоянии.
 */
const removed = db.transaction((userId: string) => {
  const receipts = db
    .prepare("DELETE FROM message_receipts WHERE user_id = ? OR msg_id IN (SELECT id FROM messages WHERE from_user_id = ?)")
    .run(userId, userId).changes;
  const messages = db.prepare("DELETE FROM messages WHERE from_user_id = ?").run(userId).changes;
  const keys = db.prepare("DELETE FROM group_key_versions WHERE created_by = ?").run(userId).changes;
  // Коды одноразовые, хранить их историю смысла нет.
  const invites = db.prepare("DELETE FROM invites WHERE created_by = ? OR used_by = ?").run(userId, userId).changes;
  const devices = db.prepare("DELETE FROM devices WHERE user_id = ?").run(userId).changes;
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  return { receipts, messages, keys, invites, devices };
});

const stats = removed(user.id);

console.log("");
console.log(`Удалён участник: ${user.display_name} (${user.id})`);
console.log(`  устройств: ${stats.devices}`);
console.log(`  сообщений: ${stats.messages}`);
console.log(`  квитанций: ${stats.receipts}`);
console.log(`  кодов приглашений: ${stats.invites}`);
if (stats.keys > 0) console.log(`  версий групповых ключей: ${stats.keys}`);
console.log("");
console.log("Остальным участникам чат с ним исчезнет сам — при следующем подключении");
console.log("приложение сверяет свой список с roster и убирает лишних.");
console.log("");
