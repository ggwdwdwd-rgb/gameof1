// Кто распоряжается составом участников.
//
// Право явное (users.is_admin), а не «первый зарегистрированный»: старое
// неявное правило ломалось при удалении своего же прежнего аккаунта — права
// молча уходили к другому человеку.
//
// Запуск на VPS:
//   docker compose exec server node dist/cli/set-admin.js                    # список
//   docker compose exec server node dist/cli/set-admin.js --user=<ID>        # назначить
//   docker compose exec server node dist/cli/set-admin.js --user=<ID> --sole # назначить и снять с остальных
//   docker compose exec server node dist/cli/set-admin.js --user=<ID> --revoke
// Локально: npm run set-admin -- --user=<ID>
import { runMigrations } from "../db/migrate.js";
import { adminCount, listUsers, setAdmin } from "../users.js";

runMigrations();

function argValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=").slice(1).join("=");
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function printUsers(): void {
  console.log("\nУчастники (по времени регистрации):\n");
  for (const user of listUsers()) {
    const mark = user.isAdmin ? "  ← ГЛАВНЫЙ (распоряжается составом)" : "";
    console.log(`  ${user.displayName}`);
    console.log(`    id: ${user.id}${mark}`);
    console.log(
      `    зарегистрирован ${new Date(user.createdAt).toLocaleString("ru-RU")}, устройств: ${user.devices}, сообщений: ${user.messages}`,
    );
  }
  console.log("");
}

const target = argValue("user");
const revoke = hasFlag("revoke");
const sole = hasFlag("sole");

if (!target) {
  printUsers();
  console.log("Назначить главным:");
  console.log("  node dist/cli/set-admin.js --user=<ID>");
  console.log("Назначить и снять право со всех остальных:");
  console.log("  node dist/cli/set-admin.js --user=<ID> --sole");
  console.log("Снять право:");
  console.log("  node dist/cli/set-admin.js --user=<ID> --revoke\n");
  process.exit(0);
}

const users = listUsers();
const user = users.find((u) => u.id === target);
if (!user) {
  printUsers();
  console.error(`Участника с id ${target} нет. Скопируй id из списка выше.`);
  process.exit(1);
}

if (revoke) {
  // Снимать право у последнего главного нельзя: система осталась бы без
  // управления, и вернуть его можно было бы только правкой базы руками.
  if (user.isAdmin && adminCount() <= 1) {
    console.error("\nЭто единственный главный. Сначала назначь другого, потом снимай право у этого.\n");
    process.exit(1);
  }
  setAdmin(user.id, false);
  console.log(`\nПраво снято: ${user.displayName}`);
} else {
  setAdmin(user.id, true);
  if (sole) {
    for (const other of users) {
      if (other.id !== user.id && other.isAdmin) setAdmin(other.id, false);
    }
    console.log(`\nГлавный теперь только один: ${user.displayName}`);
  } else {
    console.log(`\nГлавный: ${user.displayName}`);
  }
}

printUsers();
console.log("Приложение узнает об изменении при следующем подключении —");
console.log("достаточно свернуть и открыть Cry заново.\n");
