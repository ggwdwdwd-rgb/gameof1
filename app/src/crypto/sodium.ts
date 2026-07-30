import sodium from "react-native-libsodium";
import { createCrypto, type SodiumLike } from "@family-messenger/crypto";

let readyPromise: Promise<ReturnType<typeof createCrypto>> | undefined;

/**
 * react-native-libsodium специально сделан API-совместимым с libsodium-wrappers
 * (используется в @family-messenger/crypto и в тестах пакета), поэтому один и
 * тот же createCrypto() работает без адаптера — нужно только один раз
 * дождаться sodium.ready перед первым использованием.
 */
export function getCrypto(): Promise<ReturnType<typeof createCrypto>> {
  readyPromise ??= sodium.ready.then(() => createCrypto(sodium as unknown as SodiumLike));
  return readyPromise;
}
