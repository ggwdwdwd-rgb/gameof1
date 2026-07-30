/**
 * Минимальный интерфейс sodium, который реально использует этот пакет.
 *
 * ВАЖНО: набор функций ограничен тем, что реализовано в `react-native-libsodium`
 * (клиент). Эта библиотека покрывает лишь часть API `libsodium-wrappers`
 * (сервер, тесты) — например, `crypto_box_beforenm` в ней отсутствует, поэтому
 * парное шифрование сделано через `crypto_box_easy`, который есть в обеих.
 * Проверка наличия функций на старте — в app/src/crypto/sodium.ts.
 */
export interface SodiumLike {
  readonly ready: Promise<void>;

  crypto_sign_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_sign_detached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
  crypto_sign_verify_detached(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;

  crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_box_easy(
    message: Uint8Array,
    nonce: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array,
  ): Uint8Array;
  crypto_box_open_easy(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array,
  ): Uint8Array;

  crypto_generichash(hashLength: number, message: Uint8Array): Uint8Array;

  randombytes_buf(length: number): Uint8Array;

  to_base64(input: Uint8Array): string;
  from_base64(input: string): Uint8Array;
  from_string(input: string): Uint8Array;
  to_string(input: Uint8Array): string;

  readonly crypto_box_NONCEBYTES: number;
  readonly crypto_box_SECRETKEYBYTES: number;
}
