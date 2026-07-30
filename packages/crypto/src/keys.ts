import type { SodiumLike } from "./sodium";
import type { KeyPair } from "./types";

/** Identity-ключ устройства: Ed25519, для подписи auth-челленджа и fingerprint. */
export function generateIdentityKeyPair(sodium: SodiumLike): KeyPair {
  const kp = sodium.crypto_sign_keypair();
  return { publicKey: sodium.to_base64(kp.publicKey), secretKey: sodium.to_base64(kp.privateKey) };
}

/** Encryption-ключ устройства: X25519, только для согласования общих секретов (ECDH). */
export function generateEncryptionKeyPair(sodium: SodiumLike): KeyPair {
  const kp = sodium.crypto_box_keypair();
  return { publicKey: sodium.to_base64(kp.publicKey), secretKey: sodium.to_base64(kp.privateKey) };
}
