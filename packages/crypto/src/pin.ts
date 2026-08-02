import { decodeBase64 } from "./base64";
import type { SodiumLike } from "./sodium";
import type { Base64 } from "./types";
import { utf8Encode } from "./utf8";

/**
 * Хэш PIN-кода для блокировки приложения.
 *
 * Argon2id (crypto_pwhash), а не SHA-256: PIN — это четыре-шесть цифр, то есть
 * от десяти тысяч до миллиона вариантов. Быстрый хэш перебирается за секунды,
 * поэтому нужен медленный и требовательный к памяти. Параметры INTERACTIVE
 * (~64 МБ, доли секунды) — единственные, которые экспортирует нативная сборка
 * react-native-libsodium, и для разблокировки экрана этого достаточно.
 *
 * Чего это НЕ даёт: PIN не участвует в шифровании переписки. Ключи сообщений
 * лежат в Android Keystore и доступны приложению независимо от PIN — иначе
 * уведомления и работа в фоне были бы невозможны без ввода кода. Блокировка
 * закрывает содержимое от человека, взявшего разблокированный телефон в руки,
 * а не от того, кто вытащил данные приложения (см. ARCHITECTURE.md §13).
 */
const HASH_BYTES = 32;

export function generatePinSalt(sodium: SodiumLike): Base64 {
  return sodium.to_base64(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES));
}

export function hashPin(sodium: SodiumLike, pin: string, saltB64: Base64): Base64 {
  // PIN передаём байтами, а не строкой: строковый путь в двух реализациях
  // sodium разный, а UTF-8 в этом пакете и без того считается своим кодом.
  const hash = sodium.crypto_pwhash(
    HASH_BYTES,
    utf8Encode(pin),
    decodeBase64(sodium, saltB64),
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return sodium.to_base64(hash);
}

/**
 * Сравнение без досрочного выхода.
 *
 * Настоящей константности времени в JS не добиться (движок вправе оптимизировать
 * что угодно), но простое `===` для строк выходит на первом же различии, и это
 * дешёвая утечка, которой незачем быть. Байты берём после декодирования, чтобы
 * разные варианты base64 не считались разными хэшами.
 */
export function verifyPin(sodium: SodiumLike, pin: string, saltB64: Base64, hashB64: Base64): boolean {
  const expected = decodeBase64(sodium, hashB64);
  const actual = decodeBase64(sodium, hashPin(sodium, pin, saltB64));
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected[i]! ^ actual[i]!;
  return diff === 0;
}
