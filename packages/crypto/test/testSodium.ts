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
