/** Здесь и далее — строки в кодировке base64 (то, что реально уходит в JSON-пакеты протокола). */
export type Base64 = string;

export interface KeyPair {
  publicKey: Base64;
  secretKey: Base64;
}

export interface EncryptedPayload {
  ciphertext: Base64;
  nonce: Base64;
}
