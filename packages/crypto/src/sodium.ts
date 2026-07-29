/**
 * Минимальный интерфейс sodium, который реально использует этот пакет.
 * И `libsodium-wrappers` (сервер, тесты), и `react-native-libsodium` (клиент,
 * Этап 3) реализуют этот же набор функций с одинаковыми сигнатурами — пакет
 * не завязан на конкретный биндинг, вызывающий код сам передаёт готовый
 * инстанс через createCrypto(sodium).
 */
export interface SodiumLike {
  readonly ready: Promise<void>;

  crypto_sign_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_sign_detached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
  crypto_sign_verify_detached(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;

  crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_box_beforenm(publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array;

  crypto_aead_xchacha20poly1305_ietf_encrypt(
    message: Uint8Array,
    additionalData: Uint8Array | null,
    secretNonce: null,
    publicNonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;
  crypto_aead_xchacha20poly1305_ietf_decrypt(
    secretNonce: null,
    ciphertext: Uint8Array,
    additionalData: Uint8Array | null,
    publicNonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;

  crypto_generichash(hashLength: number, message: Uint8Array): Uint8Array;

  randombytes_buf(length: number): Uint8Array;

  to_base64(input: Uint8Array): string;
  from_base64(input: string): Uint8Array;
  from_string(input: string): Uint8Array;
  to_string(input: Uint8Array): string;

  readonly crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
  readonly crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
  readonly crypto_box_SECRETKEYBYTES: number;
}
