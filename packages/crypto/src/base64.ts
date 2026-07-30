import type { SodiumLike } from "./sodium";

/**
 * libsodium по умолчанию и пишет, и читает base64 в варианте URLSAFE_NO_PADDING
 * («-» и «_» вместо «+» и «/», без «=»), а на строке в обычном варианте
 * from_base64 бросает исключение.
 *
 * Сервер хранит шифротекст и nonce блобами, и при выдаче истории кодировал их
 * обычным base64 — из-за этого сообщения, полученные не «вживую», а через
 * history.fetch, не расшифровывались. Сервер исправлен, но клиент всё равно
 * должен принимать оба варианта: иначе после обновления приложения оно
 * перестало бы читать историю со ещё не обновлённого сервера.
 */
export function decodeBase64(sodium: SodiumLike, value: string): Uint8Array {
  const normalized = value.trim().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return sodium.from_base64(normalized);
}
