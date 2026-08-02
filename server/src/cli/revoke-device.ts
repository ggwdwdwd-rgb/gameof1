// Отзыв доступа устройства: телефон потерян или украден.
//
// Зачем отдельно от удаления участника: удаление уносит переписку у всех и
// превращает человека в нового при возвращении. Отзыв закрывает доступ одному
// телефону, переписку и человека оставляет на месте и снимается обратно.
//
// Чего отзыв не даёт: если ключи с телефона пропали (переустановка, сброс), то
// и после снятия отзыва этим устройством уже не войти — ключи хранятся только
// на нём. Тогда человек регистрируется новым кодом, то есть становится новым
// участником.
//
// Запуск на VPS:
//   docker compose exec server node dist/cli/revoke-device.js                    # список
//   docker compose exec server node dist/cli/revoke-device.js --device=ID        # отозвать
//   docker compose exec server node dist/cli/revoke-device.js --device=ID --undo # вернуть
// Локально: npm run revoke-device -- --device=ID
//
// id пишется без угловых скобок: bash понял бы «<» как перенаправление файла.
//
// Отозванное устройство сразу теряет соединение, но узнают об этом остальные
// только при своём следующем подключении: рассылка идёт из работающего
// процесса, а эта команда правит базу снаружи. Клиенты сверяются с roster при
// каждом подключении — достаточно свернуть и открыть Cry.
import { runMigrations } from "../db/migrate.js";
import { activeDeviceCount, findDevice, listDevices, setDeviceRevoked } from "../devices.js";

runMigrations();

function argValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=").slice(1).join("=");
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function printDevices(): void {
  console.log("\nУстройства (по времени регистрации):\n");
  for (const device of listDevices()) {
    const mark = device.revokedAt === null ? "" : `  ← ОТОЗВАНО ${new Date(device.revokedAt).toLocaleString("ru-RU")}`;
    console.log(`  ${device.displayName}${mark}`);
    console.log(`    device: ${device.id}`);
    console.log(`    user:   ${device.userId}`);
    console.log(`    зарегистрировано ${new Date(device.createdAt).toLocaleString("ru-RU")}`);
  }
  console.log("");
}

const target = argValue("device");
const undo = hasFlag("undo");

if (!target) {
  printDevices();
  console.log("Отозвать доступ (id устройства без угловых скобок):");
  console.log("  node dist/cli/revoke-device.js --device=ID");
  console.log("Вернуть доступ:");
  console.log("  node dist/cli/revoke-device.js --device=ID --undo\n");
  process.exit(0);
}

const device = findDevice(target);
if (!device) {
  printDevices();
  console.error(`Устройства с id ${target} нет. Скопируй id из списка выше (строка device:).`);
  process.exit(1);
}

const alreadyRevoked = device.revokedAt !== null;
if (undo === alreadyRevoked) {
  // Отзыв последнего активного устройства участника отрезает человека от
  // переписки целиком. Это законное действие (телефон украли), но оно должно
  // быть осознанным, поэтому предупреждаем явно.
  if (!undo && activeDeviceCount(device.userId) <= 1) {
    console.log("");
    console.log(`Внимание: это последнее активное устройство ${device.displayName} — он останется без доступа.`);
  }
  setDeviceRevoked(device.id, !undo);
  console.log("");
  console.log(undo ? `Доступ возвращён: ${device.displayName} (${device.id})` : `Доступ отозван: ${device.displayName} (${device.id})`);
  if (!undo) {
    console.log("Устройство больше не пройдёт аутентификацию, сообщения ему не доставляются.");
    console.log("Переписка у остальных участников остаётся на месте.");
  }
} else {
  console.log("");
  console.log(alreadyRevoked ? "Доступ этого устройства уже отозван." : "Доступ этого устройства и так активен.");
}

printDevices();
console.log("Остальные узнают об изменении при следующем подключении —");
console.log("достаточно свернуть и открыть Cry заново.\n");
