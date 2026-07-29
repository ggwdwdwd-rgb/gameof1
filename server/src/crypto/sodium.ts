import { createRequire } from "node:module";
import type _sodium from "libsodium-wrappers";

// У ESM-сборки libsodium-wrappers сломан относительный импорт ("./libsodium.mjs"
// не существует в пакете) — известная проблема пакета при чистом ESM-резолве в
// Node. Обходим через createRequire: CJS-сборка резолвит "libsodium" штатно
// через node_modules и работает без проблем.
const require = createRequire(import.meta.url);
const sodiumImpl: typeof _sodium = require("libsodium-wrappers");

let readyPromise: Promise<typeof _sodium> | undefined;

// sodium нельзя использовать до resolve этого промиса (WASM грузится асинхронно).
// Вызывать один раз при старте сервера.
export function getSodium(): Promise<typeof _sodium> {
  readyPromise ??= sodiumImpl.ready.then(() => sodiumImpl);
  return readyPromise;
}
