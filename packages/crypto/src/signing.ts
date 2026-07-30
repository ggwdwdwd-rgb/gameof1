import type { SodiumLike } from "./sodium";
import type { Base64 } from "./types";

/** Подписывает произвольный байт-массив (в т.ч. auth-nonce от сервера) identity-приватным ключом. */
export function signDetached(sodium: SodiumLike, messageB64: Base64, secretKeyB64: Base64): Base64 {
  const signature = sodium.crypto_sign_detached(sodium.from_base64(messageB64), sodium.from_base64(secretKeyB64));
  return sodium.to_base64(signature);
}

export function verifyDetached(
  sodium: SodiumLike,
  signatureB64: Base64,
  messageB64: Base64,
  publicKeyB64: Base64,
): boolean {
  try {
    return sodium.crypto_sign_verify_detached(
      sodium.from_base64(signatureB64),
      sodium.from_base64(messageB64),
      sodium.from_base64(publicKeyB64),
    );
  } catch {
    // некорректный base64/длина ключа — считаем подпись невалидной, не бросаем исключение
    return false;
  }
}
