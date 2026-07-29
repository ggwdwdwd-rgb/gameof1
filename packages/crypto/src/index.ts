import { deriveSharedKey, decryptWithKey, encryptWithKey, generateGroupKey } from "./channel.js";
import { computeFingerprint } from "./fingerprint.js";
import { generateEncryptionKeyPair, generateIdentityKeyPair } from "./keys.js";
import type { SodiumLike } from "./sodium.js";
import { signDetached, verifyDetached } from "./signing.js";

export type { Base64, EncryptedPayload, KeyPair } from "./types.js";
export type { SodiumLike } from "./sodium.js";

/**
 * Фабрика вместо синглтона: вызывающий код (сервер — libsodium-wrappers,
 * клиент на Этапе 3 — react-native-libsodium) сам решает, каким биндингом
 * sodium пользоваться, и передаёт готовый (уже awaited .ready) инстанс сюда.
 */
export function createCrypto(sodium: SodiumLike) {
  return {
    generateIdentityKeyPair: () => generateIdentityKeyPair(sodium),
    generateEncryptionKeyPair: () => generateEncryptionKeyPair(sodium),
    signDetached: (messageB64: string, secretKeyB64: string) => signDetached(sodium, messageB64, secretKeyB64),
    verifyDetached: (signatureB64: string, messageB64: string, publicKeyB64: string) =>
      verifyDetached(sodium, signatureB64, messageB64, publicKeyB64),
    deriveSharedKey: (mySecretKeyB64: string, theirPublicKeyB64: string) =>
      deriveSharedKey(sodium, mySecretKeyB64, theirPublicKeyB64),
    generateGroupKey: () => generateGroupKey(sodium),
    encryptWithKey: (plaintext: string, keyB64: string) => encryptWithKey(sodium, plaintext, keyB64),
    decryptWithKey: (payload: { ciphertext: string; nonce: string }, keyB64: string) =>
      decryptWithKey(sodium, payload, keyB64),
    computeFingerprint: (identityPublicKeyB64: string) => computeFingerprint(sodium, identityPublicKeyB64),
  };
}

export type Crypto = ReturnType<typeof createCrypto>;
