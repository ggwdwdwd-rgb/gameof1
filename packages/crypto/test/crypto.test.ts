import { beforeAll, describe, expect, it } from "vitest";
import { createCrypto } from "../src/index.js";
import type { SodiumLike } from "../src/sodium.js";
import { getTestSodium } from "./testSodium.js";

let sodium: Awaited<ReturnType<typeof getTestSodium>>;
let crypto: ReturnType<typeof createCrypto>;

beforeAll(async () => {
  sodium = await getTestSodium();
  crypto = createCrypto(sodium as unknown as SodiumLike);
});

describe("генерация ключей", () => {
  it("identity-ключ имеет корректную длину (Ed25519)", () => {
    const kp = crypto.generateIdentityKeyPair();
    expect(sodium.from_base64(kp.publicKey)).toHaveLength(sodium.crypto_sign_PUBLICKEYBYTES);
    expect(sodium.from_base64(kp.secretKey)).toHaveLength(sodium.crypto_sign_SECRETKEYBYTES);
  });

  it("encryption-ключ имеет корректную длину (X25519)", () => {
    const kp = crypto.generateEncryptionKeyPair();
    expect(sodium.from_base64(kp.publicKey)).toHaveLength(sodium.crypto_box_PUBLICKEYBYTES);
    expect(sodium.from_base64(kp.secretKey)).toHaveLength(sodium.crypto_box_SECRETKEYBYTES);
  });

  it("два вызова генерации дают разные ключи (не детерминировано)", () => {
    const a = crypto.generateIdentityKeyPair();
    const b = crypto.generateIdentityKeyPair();
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});

describe("подпись auth-челленджа (Ed25519)", () => {
  it("валидная подпись проходит проверку", () => {
    const kp = crypto.generateIdentityKeyPair();
    const nonce = sodium.to_base64(sodium.randombytes_buf(32));
    const signature = crypto.signDetached(nonce, kp.secretKey);
    expect(crypto.verifyDetached(signature, nonce, kp.publicKey)).toBe(true);
  });

  it("подпись под другим сообщением не проходит", () => {
    const kp = crypto.generateIdentityKeyPair();
    const nonce = sodium.to_base64(sodium.randombytes_buf(32));
    const otherNonce = sodium.to_base64(sodium.randombytes_buf(32));
    const signature = crypto.signDetached(nonce, kp.secretKey);
    expect(crypto.verifyDetached(signature, otherNonce, kp.publicKey)).toBe(false);
  });

  it("подпись под чужим публичным ключом не проходит (имитация MITM)", () => {
    const kpA = crypto.generateIdentityKeyPair();
    const kpB = crypto.generateIdentityKeyPair();
    const nonce = sodium.to_base64(sodium.randombytes_buf(32));
    const signature = crypto.signDetached(nonce, kpA.secretKey);
    expect(crypto.verifyDetached(signature, nonce, kpB.publicKey)).toBe(false);
  });

  it("мусорный base64 не роняет verify, а возвращает false", () => {
    expect(crypto.verifyDetached("не-base64!!!", "тоже-не-base64", "и-это-тоже")).toBe(false);
  });
});

describe("согласование общего секрета (X25519 ECDH)", () => {
  it("shared key одинаковый с обеих сторон", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();
    const sharedByAlice = crypto.deriveSharedKey(alice.secretKey, bob.publicKey);
    const sharedByBob = crypto.deriveSharedKey(bob.secretKey, alice.publicKey);
    expect(sharedByAlice).toBe(sharedByBob);
  });

  it("разные пары дают разный shared key", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();
    const carol = crypto.generateEncryptionKeyPair();
    const sharedAB = crypto.deriveSharedKey(alice.secretKey, bob.publicKey);
    const sharedAC = crypto.deriveSharedKey(alice.secretKey, carol.publicKey);
    expect(sharedAB).not.toBe(sharedAC);
  });
});

describe("шифрование сообщений (XChaCha20-Poly1305)", () => {
  it("расшифровка возвращает исходный текст", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();
    const key = crypto.deriveSharedKey(alice.secretKey, bob.publicKey);

    const plaintext = "Привет! Ужин в 19:00 🍲";
    const payload = crypto.encryptWithKey(plaintext, key);
    const decrypted = crypto.decryptWithKey(payload, key);

    expect(decrypted).toBe(plaintext);
  });

  it("каждое сообщение шифруется новым nonce", () => {
    const key = crypto.generateGroupKey();
    const a = crypto.encryptWithKey("одно и то же сообщение", key);
    const b = crypto.encryptWithKey("одно и то же сообщение", key);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("подмена шифротекста ломает AEAD-тег — decrypt бросает исключение", () => {
    const key = crypto.generateGroupKey();
    const payload = crypto.encryptWithKey("не трогай меня", key);
    const raw = sodium.from_base64(payload.ciphertext);
    raw[0] = raw[0]! ^ 0xff; // портим один байт
    const tampered = { ciphertext: sodium.to_base64(raw), nonce: payload.nonce };

    expect(() => crypto.decryptWithKey(tampered, key)).toThrow();
  });

  it("расшифровка неверным ключом бросает исключение", () => {
    const key = crypto.generateGroupKey();
    const wrongKey = crypto.generateGroupKey();
    const payload = crypto.encryptWithKey("секрет семьи", key);
    expect(() => crypto.decryptWithKey(payload, wrongKey)).toThrow();
  });
});

describe("групповой ключ", () => {
  it("сгенерированный групповой ключ имеет длину 32 байта и работает с encrypt/decrypt", () => {
    const key = crypto.generateGroupKey();
    expect(sodium.from_base64(key)).toHaveLength(32);
    const payload = crypto.encryptWithKey("список покупок: молоко, хлеб", key);
    expect(crypto.decryptWithKey(payload, key)).toBe("список покупок: молоко, хлеб");
  });
});

describe("fingerprint (экран «Семья»)", () => {
  it("детерминирован для одного и того же ключа", () => {
    const kp = crypto.generateIdentityKeyPair();
    expect(crypto.computeFingerprint(kp.publicKey)).toBe(crypto.computeFingerprint(kp.publicKey));
  });

  it("разные ключи дают разный fingerprint", () => {
    const a = crypto.generateIdentityKeyPair();
    const b = crypto.generateIdentityKeyPair();
    expect(crypto.computeFingerprint(a.publicKey)).not.toBe(crypto.computeFingerprint(b.publicKey));
  });

  it("формат — группы по 4 hex-символа через пробел", () => {
    const kp = crypto.generateIdentityKeyPair();
    const fp = crypto.computeFingerprint(kp.publicKey);
    expect(fp).toMatch(/^[0-9A-F]{4}(?: [0-9A-F]{4})*$/);
  });
});

/**
 * Golden-векторы: ключи получены детерминировано из фиксированного seed
 * (crypto_box_seed_keypair/crypto_sign_seed_keypair), ожидаемые значения
 * зафиксированы заранее прогоном той же связки libsodium. Это не официальные
 * NIST/IETF-векторы (для XChaCha20-Poly1305-IETF таких общедоступных векторов
 * с этой конкретной комбинацией ключ/nonce нет) — назначение теста другое:
 * поймать регрессию, если вызовы sodium в этом пакете вдруг перестанут быть
 * побайтово совместимы (не тот порядок аргументов AEAD, не та переменная
 * nonce/lib и т.д.), а не проверить сам алгоритм XChaCha20-Poly1305.
 */
describe("golden-векторы (защита от регрессий в обвязке над sodium)", () => {
  const seedA = new Uint8Array(32).fill(1);
  const seedB = new Uint8Array(32).fill(2);

  it("Ed25519: подпись фиксированного сообщения фиксированным ключом", () => {
    const signKeys = sodium.crypto_sign_seed_keypair(seedA);
    const message = sodium.from_string("auth-nonce-example");
    const signature = sodium.crypto_sign_detached(message, signKeys.privateKey);

    expect(sodium.to_base64(signKeys.publicKey)).toBe("iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w");
    expect(sodium.to_base64(signature)).toBe(
      "mPDORYsEd0HhSISLJNJcptB7vdGxdnQjo07IulUlUrlg_M28vIEKwdc4Sr7whuXzvBk-YMbmK-N2Wtbde23NCQ",
    );
    expect(sodium.crypto_sign_verify_detached(signature, message, signKeys.publicKey)).toBe(true);
  });

  it("X25519 ECDH: shared key для фиксированной пары seed-ключей", () => {
    const boxA = sodium.crypto_box_seed_keypair(seedA);
    const boxB = sodium.crypto_box_seed_keypair(seedB);
    const shared = sodium.crypto_box_beforenm(boxB.publicKey, boxA.privateKey);

    expect(sodium.to_base64(shared)).toBe("EyWNz7BcELoWogBZNrLUyssB7j74OgiHq9Y-SguAs_Q");
  });

  it("XChaCha20-Poly1305: шифротекст для фиксированных ключа/nonce/текста", () => {
    const boxA = sodium.crypto_box_seed_keypair(seedA);
    const boxB = sodium.crypto_box_seed_keypair(seedB);
    const key = sodium.crypto_box_beforenm(boxB.publicKey, boxA.privateKey);
    const nonce = new Uint8Array(24).fill(7);

    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      sodium.from_string("привет, семья"),
      null,
      null,
      nonce,
      key,
    );

    expect(sodium.to_base64(ciphertext)).toBe("G2Vsh95VK3OaUR7kMRbVlDvt75Bc1WUMKzYoHNtaya9tPVUtQJzuEg");

    const decrypted = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, null, nonce, key);
    expect(sodium.to_string(decrypted)).toBe("привет, семья");
  });

  it("fingerprint фиксированного публичного ключа", () => {
    const signKeys = sodium.crypto_sign_seed_keypair(seedA);
    const fp = crypto.computeFingerprint(sodium.to_base64(signKeys.publicKey));
    expect(fp).toBe("E680 8F33 FBEC 8797 5122 804A C9CE DA8E");
  });
});
