// Проверка разрешений Android в собранной конфигурации.
//
// Зачем отдельный скрипт: разрешения попадают в APK не из app.json напрямую, а
// после работы всех config-плагинов, и один плагин может отменить то, что
// добавил другой. Именно так и вышло: у expo-image-picker стояло
// "cameraPermission": false, "microphonePermission": false — я имел в виду «для
// выбора фото камера не нужна», а плагин на это выдаёт
// <uses-permission android:name="..." tools:node="remove" />, то есть вычищает
// разрешение из манифеста целиком, поверх expo-audio и expo-camera. В итоге в
// APK не было ни RECORD_AUDIO, ни CAMERA: голосовые не записывались, а
// системный диалог доступа даже не появлялся — Android просто отказывает,
// потому что разрешение не объявлено.
//
// Проверять это глазами бесполезно: ошибка видна только в итоговом манифесте.
//
// Запуск из папки app:  npm run check:android
import { execFileSync } from "node:child_process";

/** Без этих разрешений соответствующая функция в APK не работает вообще. */
const REQUIRED = [
  { permission: "android.permission.RECORD_AUDIO", why: "запись голосовых" },
  { permission: "android.permission.CAMERA", why: "сканирование QR-кода инвайта" },
  { permission: "android.permission.POST_NOTIFICATIONS", why: "уведомления о сообщениях" },
  { permission: "android.permission.INTERNET", why: "соединение с сервером" },
  // Без этой пары служба переднего плана не запустится: с Android 14 тип
  // службы обязателен, а specialUse требует своего разрешения. Ошибка тут
  // означает, что уведомления снова приходят только при открытом приложении.
  { permission: "android.permission.FOREGROUND_SERVICE", why: "работа в фоне" },
  { permission: "android.permission.FOREGROUND_SERVICE_SPECIAL_USE", why: "тип службы переднего плана" },
  { permission: "android.permission.USE_BIOMETRIC", why: "разблокировка отпечатком или лицом" },
];

let failed = 0;
function check(name, ok, extra = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

// Текстовый вывод, а не --json: в JSON содержимое манифеста не попадает, а
// именно там видно tools:node="remove".
const raw = execFileSync("npx", ["expo", "config", "--type", "introspect"], {
  encoding: "utf-8",
  stdio: ["ignore", "pipe", "ignore"],
  env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
});

// Цветовые последовательности убираем обязательно: expo раскрашивает вывод даже
// в конвейер, и regex по кавычкам без этого молча не находил ничего — проверка
// проходила на заведомо сломанной конфигурации.
const text = raw.replace(/\[[0-9;]*m/g, "");

const blocked = [...text.matchAll(/'android:name':\s*'([^']+)',\s*\n\s*'tools:node':\s*'remove'/g)].map((m) => m[1]);
check(
  "ни одно разрешение не помечено на удаление",
  blocked.length === 0,
  blocked.length > 0 ? blocked.join(", ") : "",
);

for (const { permission, why } of REQUIRED) {
  check(`${permission} объявлено (${why})`, text.includes(`'${permission}'`));
}

console.log(failed === 0 ? "\nРазрешения Android в порядке" : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
