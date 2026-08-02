import { createRequire } from "node:module";
import type _sodium from "libsodium-wrappers";

// Та же ESM-обходка, что и в server/src/crypto/sodium.ts — у ESM-сборки
// libsodium-wrappers сломан внутренний относительный импорт ("./libsodium.mjs").
// Полный тип libsodium-wrappers — структурный супертип SodiumLike из пакета,
// поэтому его можно передавать напрямую в createCrypto().
const sodium: typeof _sodium = createRequire(import.meta.url)("libsodium-wrappers");

export async function getTestSodium(): Promise<typeof _sodium> {
  await sodium.ready;
  return sodium;
}

/**
 * Тот же libsodium, но сборка sumo — только для тестов PIN-кода.
 *
 * Обычная сборка libsodium-wrappers не содержит crypto_pwhash (Argon2id): это
 * не наш выбор, а её состав. На устройстве функция есть — нативный модуль
 * react-native-libsodium ставит её всегда, и в свою web-версию он подключает
 * ровно эту sumo-сборку. Поэтому тесты PIN считают хэши на ней, а остальные
 * остаются на обычной: сервер пользуется именно обычной, и незачем скрывать,
 * чего в ней нет.
 */
const sumo: typeof _sodium = createRequire(import.meta.url)("libsodium-wrappers-sumo");

export async function getSumoSodium(): Promise<typeof _sodium> {
  await sumo.ready;
  return sumo;
}
