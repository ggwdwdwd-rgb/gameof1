import { getSodium } from "./sodium.js";

/**
 * Проверяет подпись auth-челленджа. identityPublicKeyB64 — Ed25519 публичный
 * ключ устройства (как он хранится в devices.identity_public_key), nonce и
 * signature — base64.
 */
export async function verifyChallengeSignature(
  identityPublicKeyB64: string,
  nonceB64: string,
  signatureB64: string,
): Promise<boolean> {
  const sodium = await getSodium();
  try {
    const publicKey = sodium.from_base64(identityPublicKeyB64);
    const nonce = sodium.from_base64(nonceB64);
    const signature = sodium.from_base64(signatureB64);
    if (publicKey.length !== sodium.crypto_sign_PUBLICKEYBYTES) return false;
    if (signature.length !== sodium.crypto_sign_BYTES) return false;
    return sodium.crypto_sign_verify_detached(signature, nonce, publicKey);
  } catch {
    // некорректный base64 или длина ключа — считаем подпись невалидной, а не падаем
    return false;
  }
}

export async function randomNonceB64(): Promise<string> {
  const sodium = await getSodium();
  return sodium.to_base64(sodium.randombytes_buf(32));
}
