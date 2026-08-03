// Импорты без .js-расширений: пакет резолвится Metro напрямую из исходников
// (см. package.json), а Metro, в отличие от tsc, не подменяет .js на .ts.
import { boxEncrypt, boxOpen } from "./channel";
import { decryptBackup, encryptBackup, type EncryptedBackup } from "./backup";
import { computeFingerprint } from "./fingerprint";
import { generateEncryptionKeyPair, generateIdentityKeyPair } from "./keys";
import { generatePinSalt, hashPin, verifyPin } from "./pin";
import type { SodiumLike } from "./sodium";
import { signDetached, verifyDetached } from "./signing";

export type { Base64, EncryptedPayload, KeyPair } from "./types";
export type { EncryptedBackup } from "./backup";
export type { SodiumLike } from "./sodium";

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
    /** Зашифровать для собеседника: его публичный X25519-ключ + мой приватный. */
    boxEncrypt: (plaintext: string, theirPublicKeyB64: string, mySecretKeyB64: string) =>
      boxEncrypt(sodium, plaintext, theirPublicKeyB64, mySecretKeyB64),
    /** Расшифровать от собеседника (работает и для своих сообщений: ключ пары симметричен). */
    boxOpen: (payload: { ciphertext: string; nonce: string }, theirPublicKeyB64: string, mySecretKeyB64: string) =>
      boxOpen(sodium, payload, theirPublicKeyB64, mySecretKeyB64),
    computeFingerprint: (identityPublicKeyB64: string) => computeFingerprint(sodium, identityPublicKeyB64),
    /** Соль для PIN-кода блокировки: своя на устройство, хранится рядом с хэшем. */
    generatePinSalt: () => generatePinSalt(sodium),
    hashPin: (pin: string, saltB64: string) => hashPin(sodium, pin, saltB64),
    verifyPin: (pin: string, saltB64: string, hashB64: string) => verifyPin(sodium, pin, saltB64, hashB64),
    /** Резервная копия переписки, зашифрованная кодовой фразой (см. backup.ts). */
    encryptBackup: (plaintext: string, passphrase: string) => encryptBackup(sodium, plaintext, passphrase),
    /** null — фраза не подходит либо копия испорчена. */
    decryptBackup: (backup: EncryptedBackup, passphrase: string) => decryptBackup(sodium, backup, passphrase),
  };
}

export type Crypto = ReturnType<typeof createCrypto>;
