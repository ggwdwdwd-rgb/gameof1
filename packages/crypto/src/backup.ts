import { decodeBase64 } from "./base64";
import type { SodiumLike } from "./sodium";
import type { Base64 } from "./types";
import { utf8Decode, utf8Encode } from "./utf8";

/**
 * Резервная копия переписки, зашифрованная кодовой фразой.
 *
 * Зачем вообще: с аккаунтами человек ожидает, что после входа с нового телефона
 * чаты будут на месте. Но переписка расшифровывается ключами устройства, а они
 * остаются на прежнем телефоне — сервер хранит только шифротекст и помочь не
 * может. Значит копию должен делать сам клиент, и она должна быть зашифрована
 * так, чтобы сервер её не прочитал.
 *
 * Ключ выводится из фразы через Argon2id (`crypto_pwhash`) с новой случайной
 * солью на каждую копию, шифрование — `crypto_secretbox_easy` (XSalsa20-Poly1305).
 * Оба примитива есть в нативной сборке react-native-libsodium, это проверяется
 * тестом.
 *
 * Параметры INTERACTIVE, а не MODERATE: копия расшифровывается на телефоне, и
 * 256 МБ там уже рискованно. Для фразы (а не четырёх цифр PIN) стойкости
 * INTERACTIVE достаточно — но именно поэтому фраза и должна быть фразой.
 *
 * Чего эта копия НЕ содержит: приватных ключей устройства. Они не покидают
 * телефон — это свойство, на котором держится всё остальное, и ломать его ради
 * удобства нельзя. Отсюда честное следствие: сообщения, пришедшие на прежний
 * телефон уже ПОСЛЕ последней копии, на новом расшифровать нечем. Они останутся
 * на сервере зашифрованными и просто не покажутся.
 */
const KEY_BYTES = 32;

export interface EncryptedBackup {
  /** Версия формата: копию, созданную новой версией, старая не должна пытаться читать. */
  v: 1;
  salt: Base64;
  nonce: Base64;
  ciphertext: Base64;
}

export function encryptBackup(sodium: SodiumLike, plaintext: string, passphrase: string): EncryptedBackup {
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const key = deriveKey(sodium, passphrase, salt);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(utf8Encode(plaintext), nonce, key);
  return {
    v: 1,
    salt: sodium.to_base64(salt),
    nonce: sodium.to_base64(nonce),
    ciphertext: sodium.to_base64(ciphertext),
  };
}

/**
 * Расшифровка. null — фраза не подходит либо копия испорчена.
 *
 * Различать эти два случая незачем и вредно: подсказка «фраза верная, но файл
 * битый» помогает только тому, кто подбирает фразу.
 */
export function decryptBackup(sodium: SodiumLike, backup: EncryptedBackup, passphrase: string): string | null {
  if (backup.v !== 1) return null;
  try {
    const key = deriveKey(sodium, passphrase, decodeBase64(sodium, backup.salt));
    const opened = sodium.crypto_secretbox_open_easy(
      decodeBase64(sodium, backup.ciphertext),
      decodeBase64(sodium, backup.nonce),
      key,
    );
    // Тег Poly1305 внутри secretbox сам ловит и неверный ключ, и подмену
    // шифротекста: библиотека в этом случае бросает исключение.
    return utf8Decode(opened);
  } catch {
    return null;
  }
}

function deriveKey(sodium: SodiumLike, passphrase: string, salt: Uint8Array): Uint8Array {
  return sodium.crypto_pwhash(
    KEY_BYTES,
    utf8Encode(passphrase),
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}
