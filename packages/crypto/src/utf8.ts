/**
 * UTF-8 ↔ байты своими руками, без sodium и без TextEncoder.
 *
 * Почему не sodium: в react-native-libsodium функция `from_string` не
 * экспортирована вовсе (она есть только в web-варианте модуля, который
 * проксирует libsodium-wrappers). На устройстве `sodium.from_string`
 * оказывался undefined — из-за этого шифрование падало, и сообщения не
 * отправлялись. Ровно та же ловушка, что и с `crypto_box_beforenm`.
 *
 * Почему не TextEncoder: в React Native 0.86 его в глобальном окружении нет,
 * поэтому используем его только если он всё-таки есть (тогда он быстрее), а
 * иначе считаем сами.
 */

type Encoder = { encode(input: string): Uint8Array };
type Decoder = { decode(input: Uint8Array): string };

const nativeEncoder: Encoder | null =
  typeof TextEncoder === "function" ? (new TextEncoder() as unknown as Encoder) : null;
const nativeDecoder: Decoder | null =
  typeof TextDecoder === "function" ? (new TextDecoder("utf-8") as unknown as Decoder) : null;

/** Сколько байт займёт строка в UTF-8. Считаем заранее, чтобы выделить массив точного размера. */
function utf8Length(input: string): number {
  let bytes = 0;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4; // сурогатная пара — один символ вне BMP (например, эмодзи)
        i += 1;
        continue;
      }
      bytes += 3; // одинокий сурогат заменится на U+FFFD
    } else bytes += 3;
  }
  return bytes;
}

export function utf8Encode(input: string): Uint8Array {
  return nativeEncoder ? nativeEncoder.encode(input) : utf8EncodeFallback(input);
}

/**
 * Экспортируется отдельно, чтобы тесты проверяли именно её: в Node
 * TextEncoder есть, и без прямого вызова этот код — тот самый, что работает на
 * телефоне — остался бы непроверенным.
 */
export function utf8EncodeFallback(input: string): Uint8Array {
  const out = new Uint8Array(utf8Length(input));
  let pos = 0;
  for (let i = 0; i < input.length; i += 1) {
    let code = input.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      code = 0xfffd; // одинокий сурогат — невалидный UTF-16
    }

    if (code < 0x80) {
      out[pos++] = code;
    } else if (code < 0x800) {
      out[pos++] = 0xc0 | (code >> 6);
      out[pos++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      out[pos++] = 0xe0 | (code >> 12);
      out[pos++] = 0x80 | ((code >> 6) & 0x3f);
      out[pos++] = 0x80 | (code & 0x3f);
    } else {
      out[pos++] = 0xf0 | (code >> 18);
      out[pos++] = 0x80 | ((code >> 12) & 0x3f);
      out[pos++] = 0x80 | ((code >> 6) & 0x3f);
      out[pos++] = 0x80 | (code & 0x3f);
    }
  }
  return out;
}

/** Собираем строку кусками: String.fromCharCode на десятках миллионов аргументов упадёт по стеку. */
const DECODE_CHUNK = 4096;

export function utf8Decode(bytes: Uint8Array): string {
  return nativeDecoder ? nativeDecoder.decode(bytes) : utf8DecodeFallback(bytes);
}

/** См. комментарий к utf8EncodeFallback — экспортируется ради тестов. */
export function utf8DecodeFallback(bytes: Uint8Array): string {
  let result = "";
  let chunk: number[] = [];
  let i = 0;

  while (i < bytes.length) {
    const byte1 = bytes[i]!;
    let code: number;

    if (byte1 < 0x80) {
      code = byte1;
      i += 1;
    } else if (byte1 < 0xe0) {
      code = ((byte1 & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      i += 2;
    } else if (byte1 < 0xf0) {
      code = ((byte1 & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      i += 3;
    } else {
      code =
        ((byte1 & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
      i += 4;
    }

    if (code > 0xffff) {
      const offset = code - 0x10000;
      chunk.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    } else {
      chunk.push(code);
    }

    if (chunk.length >= DECODE_CHUNK) {
      result += String.fromCharCode(...chunk);
      chunk = [];
    }
  }

  if (chunk.length > 0) result += String.fromCharCode(...chunk);
  return result;
}
