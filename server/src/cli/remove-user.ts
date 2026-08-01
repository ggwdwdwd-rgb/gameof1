// Удаление участника целиком: сам участник, его устройства, сообщения и коды.
//
// Нужно после тестов и переустановок клиента: приложение при переустановке
// заводит новые ключи, то есть регистрируется как новый человек, а прежний
// остаётся в списке навсегда — писать ему бессмысленно, ключей от него уже ни у
// кого нет.
//
// То же самое умеет само приложение (настройки → участник → удалить), но только
// для первого зарегистрированного. Эта команда — на случай, когда в приложение
// не зайти.
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
import { listUsers, removeUser } from "../users.js";

runMigrations();

function argValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=").slice(1).join("=");
}

const users = listUsers();

function printUsers(): void {
  console.log("\nУчастники (по времени регистрации):\n");
  users.forEach((user, index) => {
    const first = index === 0 ? "  ← самый первый (он же распоряжается составом)" : "";
    console.log(`  ${index + 1}. ${user.displayName}`);
    console.log(`     id: ${user.id}${first}`);
    console.log(
      `     зарегистрирован ${new Date(user.createdAt).toLocaleString("ru-RU")}, устройств: ${user.devices}, сообщений: ${user.messages}`,
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

const stats = removeUser(user.id);

console.log("");
console.log(`Удалён участник: ${user.displayName} (${user.id})`);
console.log(`  устройств: ${stats.devices}`);
console.log(`  сообщений: ${stats.messages}`);
console.log(`  квитанций: ${stats.receipts}`);
console.log(`  кодов приглашений: ${stats.invites}`);
if (stats.keys > 0) console.log(`  версий групповых ключей: ${stats.keys}`);
console.log("");
console.log("Остальным участникам чат с ним исчезнет сам — при следующем подключении");
console.log("приложение сверяет свой список с roster и убирает лишних.");
console.log("");
