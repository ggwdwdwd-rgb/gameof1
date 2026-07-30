import { decodeBase64 } from "./base64";
import type { SodiumLike } from "./sodium";
import type { Base64, EncryptedPayload } from "./types";

/**
 * Парное шифрование сообщения (NaCl box: X25519 + XSalsa20-Poly1305),
 * см. ARCHITECTURE.md §2.2. Общий секрет выводится внутри самого
 * crypto_box_easy, поэтому отдельная функция вывода ключа не нужна — и это
 * важно: `crypto_box_beforenm` отсутствует в react-native-libsodium.
 *
 * Nonce — новый случайный на каждое сообщение (24 байта), AEAD-тег внутри box
 * даёт аутентификацию: получатель заметит подмену шифротекста.
 */
export function boxEncrypt(
  sodium: SodiumLike,
  plaintext: string,
  theirPublicKeyB64: Base64,
  mySecretKeyB64: Base64,
): EncryptedPayload {
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(
    sodium.from_string(plaintext),
    nonce,
    decodeBase64(sodium, theirPublicKeyB64),
    decodeBase64(sodium, mySecretKeyB64),
  );
  return { ciphertext: sodium.to_base64(ciphertext), nonce: sodium.to_base64(nonce) };
}

/** Бросает исключение, если тег не сошёлся (подмена/повреждение/не тот ключ). */
export function boxOpen(
  sodium: SodiumLike,
  payload: EncryptedPayload,
  theirPublicKeyB64: Base64,
  mySecretKeyB64: Base64,
): string {
  const plaintext = sodium.crypto_box_open_easy(
    decodeBase64(sodium, payload.ciphertext),
    decodeBase64(sodium, payload.nonce),
    decodeBase64(sodium, theirPublicKeyB64),
    decodeBase64(sodium, mySecretKeyB64),
  );
  return sodium.to_string(plaintext);
}
