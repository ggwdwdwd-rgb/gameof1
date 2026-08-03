import { createRequire } from "node:module";
import { timingSafeEqual } from "node:crypto";
import type _sodiumSumo from "libsodium-wrappers-sumo";

/**
 * Хэш пароля от аккаунта.
 *
 * Argon2id (`crypto_pwhash`) — тот же примитив, которым на устройстве хэшируется
 * PIN блокировки. Один алгоритм на проект: и проверять нужно одно, и объяснять
 * одно.
 *
 * Параметры MODERATE, а не INTERACTIVE как у PIN: пароль проверяется при входе
 * (редко) и на сервере, где есть память и процессор, а PIN — на телефоне при
 * каждой разблокировке. INTERACTIVE это ~64 МБ и доли секунды, MODERATE —
 * ~256 МБ и около секунды. Для аккаунта, который защищает привязку нового
 * устройства, это правильный размен.
 *
 * Почему sumo-сборка: обычный `libsodium-wrappers` не содержит `crypto_pwhash`
 * вовсе — это не наш выбор, а её состав. Обычная сборка остаётся для проверки
 * подписей устройств: она меньше, и её же используют тесты и клиентская
 * проверка отправки.
 *
 * Чего пароль НЕ даёт: доступа к переписке. Сообщения зашифрованы ключами
 * устройств, и сервер не может их прочитать ни с паролем, ни без. Пароль нужен
 * ровно для одного — привязать новое устройство к аккаунту.
 */
const require_ = createRequire(import.meta.url);
const sumo: typeof _sodiumSumo = require_("libsodium-wrappers-sumo");

let readyPromise: Promise<typeof _sodiumSumo> | undefined;

function getSumo(): Promise<typeof _sodiumSumo> {
  readyPromise ??= sumo.ready.then(() => sumo);
  return readyPromise;
}

/** Минимальная длина пароля. Восемь — нижняя граница, ниже которой смысла нет. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Очередь: одновременно считается не больше одного хэша.
 *
 * Argon2id по построению требует много памяти — 256 МБ на вызов. Это защита от
 * перебора, но на VPS с 2–4 ГБ она же становится способом положить сервер:
 * десяток одновременных попыток входа съел бы всю память. Последовательное
 * выполнение ограничивает расход одним хэшем в моменте и вдобавок делает
 * перебор строго последовательным.
 *
 * Ослаблять параметры вместо очереди было бы хуже: это удешевляет перебор
 * пароля, то есть решает проблему нагрузки за счёт стойкости.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  // Хвост очереди не должен обрываться на отказе одной операции.
  queue = result.catch(() => undefined);
  return result;
}

/**
 * Строка вида `$argon2id$...`, которую libsodium умеет проверять сама: соль и
 * параметры лежат внутри. Отдельного столбца для соли поэтому не нужно.
 */
export function hashPassword(password: string): Promise<string> {
  return serialized(async () => {
    const sodium = await getSumo();
    return sodium.crypto_pwhash_str(
      password,
      sodium.crypto_pwhash_OPSLIMIT_MODERATE,
      sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    );
  });
}

/**
 * Проверка пароля.
 *
 * `crypto_pwhash_str_verify` сама сравнивает за постоянное время и сама читает
 * параметры из строки хэша — поэтому старые хэши продолжают проверяться, даже
 * если параметры выше однажды поменяются.
 */
export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return serialized(async () => {
    const sodium = await getSumo();
    try {
      return sodium.crypto_pwhash_str_verify(storedHash, password);
    } catch {
      // Испорченная строка хэша — это «пароль не подходит», а не падение сервера.
      return false;
    }
  });
}

/**
 * Сравнение секретов (кодов подтверждения) за постоянное время.
 *
 * Обычное `===` для строк выходит на первом различии. Для короткого кода из
 * письма это дешёвая утечка, которой незачем быть.
 */
export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf-8");
  const right = Buffer.from(b, "utf-8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
