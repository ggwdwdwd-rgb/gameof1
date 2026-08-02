// Ловит ошибку, из-за которой приложение падает при запуске целиком.
//
// Пакет с нативной частью (expo-*, react-native-*, локальные модули из
// modules/) при обычном импорте требует нативный модуль СРАЗУ, на загрузке
// JS-модуля. Если нативной части в установленном APK нет, импорт бросает
// исключение — и приложение умирает до того, как отрисуется хоть что-то и до
// того, как установится соединение. Со стороны это выглядит как «сообщения не
// идут», и по симптому причину не найти.
//
// А сборка отстаёт от JS-бандла постоянно: dev-client APK собран раньше, у людей
// на телефонах предыдущий релиз. Поэтому правило: нативный модуль, которого ещё
// не было в разосланном APK, подключается через requireOptionalNativeModule и
// при отсутствии просто отключает свою функцию.
//
// Как поддерживать: разослал новый APK с этим модулем — перенеси пакет в
// SHIPPED. Это осознанный шаг, и он означает «старые сборки больше не
// поддерживаем».
//
// Запуск из папки app: npm run check:imports
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const APP_DIR = new URL("..", import.meta.url).pathname;

/**
 * Пакеты с нативной частью, которая точно есть в разосланных сборках.
 * Их можно импортировать обычным образом.
 */
const SHIPPED = new Set([
  "expo",
  "expo-audio",
  "expo-camera",
  "expo-clipboard",
  "expo-document-picker",
  "expo-file-system",
  "expo-image-manipulator",
  "expo-image-picker",
  "expo-location",
  "expo-media-library",
  "expo-modules-core",
  "expo-notifications",
  "expo-secure-store",
  "expo-sharing",
  "expo-sqlite",
  "expo-status-bar",
  "react-native",
  "react-native-libsodium",
  "react-native-safe-area-context",
  "react-native-svg",
]);

let failed = 0;
function fail(message) {
  failed += 1;
  console.log(`FAIL ${message}`);
}

/** Пакеты из dependencies, у которых есть нативная часть. */
function nativePackages() {
  const pkg = JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf-8"));
  const found = new Set();
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (existsSync(join(APP_DIR, "node_modules", name, "expo-module.config.json"))) found.add(name);
  }
  return found;
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const native = nativePackages();
const files = [join(APP_DIR, "App.tsx"), ...sourceFiles(join(APP_DIR, "src"))];

// import ... from "пакет"  — только сам пакет, без подпутей: подпуть тоже
// исполняет index пакета, поэтому правило то же.
const IMPORT_RE = /^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm;

const risky = [...native].filter((name) => !SHIPPED.has(name));
console.log(`Нативных пакетов в зависимостях: ${native.size}, из них требуют осторожности: ${risky.length}`);
if (risky.length > 0) console.log(`  ${risky.join(", ")}`);

for (const file of files) {
  const source = readFileSync(file, "utf-8");
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1];
    const pkg = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    if (!native.has(pkg) || SHIPPED.has(pkg)) continue;
    fail(
      `${relative(APP_DIR, file)} импортирует ${pkg} напрямую. ` +
        `Нативной части может не быть в установленном APK, и тогда приложение упадёт при запуске. ` +
        `Возьми модуль через requireOptionalNativeModule (см. app/AGENTS.md) либо, если новый APK уже разослан, ` +
        `перенеси пакет в SHIPPED в этом скрипте.`,
    );
  }
}

// Страховка от того, что проверка однажды перестанет находить пакеты и начнёт
// молча всё пропускать.
if (native.size < 10) fail(`нативных пакетов найдено всего ${native.size} — разбор package.json сломался`);

if (failed === 0) console.log("\nОпасных импортов нативных модулей нет");
else console.log(`\nПроблем: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
