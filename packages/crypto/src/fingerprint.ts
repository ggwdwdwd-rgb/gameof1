import type { SodiumLike } from "./sodium.js";
import type { Base64 } from "./types.js";

/**
 * Человекочитаемый отпечаток identity-ключа для сверки вслух на экране «Семья»
 * (см. ARCHITECTURE.md §2.1, §8). Blake2b-хэш публичного ключа, 16 байт,
 * отформатированные группами по 4 hex-символа — так короче и легче
 * продиктовать по телефону, чем весь base64-ключ.
 */
export function computeFingerprint(sodium: SodiumLike, identityPublicKeyB64: Base64): string {
  const hash = sodium.crypto_generichash(16, sodium.from_base64(identityPublicKeyB64));
  const hex = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return (hex.match(/.{1,4}/g) ?? [hex]).join(" ").toUpperCase();
}
