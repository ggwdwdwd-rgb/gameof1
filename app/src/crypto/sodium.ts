import sodium from "react-native-libsodium";
import { createCrypto, type SodiumLike } from "@family-messenger/crypto";

/**
 * Функции sodium, без которых приложение работать не может. Проверяем их
 * наличие на старте осознанно: react-native-libsodium реализует лишь часть
 * API libsodium-wrappers, и раньше отсутствующий crypto_box_beforenm приводил
 * к тому, что отправка сообщений молча падала с исключением внутри обработчика.
 * Теперь такая ситуация обнаруживается сразу и с понятным текстом.
 */
const REQUIRED_FUNCTIONS = [
  "crypto_sign_keypair",
  "crypto_sign_detached",
  "crypto_sign_verify_detached",
  "crypto_box_keypair",
  "crypto_box_easy",
  "crypto_box_open_easy",
  "crypto_generichash",
  "randombytes_buf",
  "to_base64",
  "from_base64",
  "from_string",
  "to_string",
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
