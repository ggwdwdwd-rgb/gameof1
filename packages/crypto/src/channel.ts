import type { SodiumLike } from "./sodium.js";
import type { Base64, EncryptedPayload } from "./types.js";

/**
 * Общий секрет для пары устройств (X25519 ECDH), см. ARCHITECTURE.md §2.2.
 * Симметричен: deriveSharedKey(A.secret, B.public) === deriveSharedKey(B.secret, A.public).
 */
export function deriveSharedKey(sodium: SodiumLike, mySecretKeyB64: Base64, theirPublicKeyB64: Base64): Base64 {
  const shared = sodium.crypto_box_beforenm(sodium.from_base64(theirPublicKeyB64), sodium.from_base64(mySecretKeyB64));
  return sodium.to_base64(shared);
}

/** Генерирует симметричный ключ группового чата (см. ARCHITECTURE.md §2.3). */
export function generateGroupKey(sodium: SodiumLike): Base64 {
  return sodium.to_base64(sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES));
}

/**
 * Шифрует текст XChaCha20-Poly1305 с новым случайным nonce на каждое сообщение.
 * keyB64 — либо парный shared key (1:1-чат), либо групповой ключ (см. ARCHITECTURE.md §2.3) —
 * с точки зрения AEAD это один и тот же 32-байтовый симметричный ключ.
 */
export function encryptWithKey(sodium: SodiumLike, plaintext: string, keyB64: Base64): EncryptedPayload {
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    sodium.from_string(plaintext),
    null,
    null,
    nonce,
    sodium.from_base64(keyB64),
  );
  return { ciphertext: sodium.to_base64(ciphertext), nonce: sodium.to_base64(nonce) };
}

/** Бросает исключение, если AEAD-тег не сошёлся (подмена/повреждение блоба). */
export function decryptWithKey(sodium: SodiumLike, payload: EncryptedPayload, keyB64: Base64): string {
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    sodium.from_base64(payload.ciphertext),
    null,
    sodium.from_base64(payload.nonce),
    sodium.from_base64(keyB64),
  );
  return sodium.to_string(plaintext);
}
