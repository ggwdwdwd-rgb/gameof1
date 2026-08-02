import sodium from "react-native-libsodium";
import { createCrypto, type SodiumLike } from "@family-messenger/crypto";

/**
 * Функции sodium, без которых приложение работать не может.
 *
 * react-native-libsodium реализует лишь часть API libsodium-wrappers, и это уже
 * дважды ломало приложение: сначала отсутствующий `crypto_box_beforenm`, потом
 * `from_string`, которого в нативной сборке нет вовсе. Здесь их нет и быть не
 * должно — UTF-8 считает сам @family-messenger/crypto. Соответствие этого
 * списка настоящим экспортам модуля проверяется тестом в packages/crypto.
 */
const REQUIRED_FUNCTIONS = [
  "crypto_sign_keypair",
  "crypto_sign_detached",
  "crypto_sign_verify_detached",
  "crypto_box_keypair",
  "crypto_box_easy",
  "crypto_box_open_easy",
  "crypto_generichash",
  // Argon2id — хэш PIN-кода блокировки. Проверяем при старте, а не при вводе
  // кода: «сохранил PIN и не смог войти» — это запертое приложение без выхода.
  "crypto_pwhash",
  "randombytes_buf",
  "to_base64",
  "from_base64",
] as const;

function assertSodiumComplete(instance: Record<string, unknown>): void {
  const missing = REQUIRED_FUNCTIONS.filter((name) => typeof instance[name] !== "function");
  if (missing.length > 0) {
    throw new Error(`В сборке libsodium отсутствуют функции: ${missing.join(", ")}`);
  }
  if (typeof instance.crypto_box_NONCEBYTES !== "number") {
    throw new Error("В сборке libsodium отсутствует константа crypto_box_NONCEBYTES");
  }
}

let readyPromise: Promise<ReturnType<typeof createCrypto>> | undefined;

/**
 * react-native-libsodium специально сделан API-совместимым с libsodium-wrappers
 * (используется в @family-messenger/crypto и в тестах пакета), поэтому один и
 * тот же createCrypto() работает без адаптера — нужно только один раз
 * дождаться sodium.ready перед первым использованием.
 */
export function getCrypto(): Promise<ReturnType<typeof createCrypto>> {
  readyPromise ??= sodium.ready.then(() => {
    assertSodiumComplete(sodium as unknown as Record<string, unknown>);
    return createCrypto(sodium as unknown as SodiumLike);
  });
  return readyPromise;
}
