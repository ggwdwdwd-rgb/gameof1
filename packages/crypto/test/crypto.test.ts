import { beforeAll, describe, expect, it } from "vitest";
import { createCrypto } from "../src/index";
import type { SodiumLike } from "../src/sodium";
import { getTestSodium } from "./testSodium";

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

describe("парное шифрование сообщений (NaCl box)", () => {
  it("получатель расшифровывает сообщение отправителя", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();

    const plaintext = "Привет! Ужин в 19:00 🍲";
    const payload = crypto.boxEncrypt(plaintext, bob.publicKey, alice.secretKey);

    expect(crypto.boxOpen(payload, alice.publicKey, bob.secretKey)).toBe(plaintext);
  });

  it("автор расшифровывает своё же сообщение (сценарий истории после переустановки)", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();

    const plaintext = "моё сообщение из истории";
    const payload = crypto.boxEncrypt(plaintext, bob.publicKey, alice.secretKey);

    // Ключ пары симметричен: (bob.pub, alice.sec) === (alice.pub, bob.sec).
    expect(crypto.boxOpen(payload, bob.publicKey, alice.secretKey)).toBe(plaintext);
  });

  it("посторонний не может расшифровать", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();
    const eve = crypto.generateEncryptionKeyPair();

    const payload = crypto.boxEncrypt("секрет", bob.publicKey, alice.secretKey);
    expect(() => crypto.boxOpen(payload, alice.publicKey, eve.secretKey)).toThrow();
  });

  it("каждое сообщение шифруется новым nonce", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();

    const a = crypto.boxEncrypt("одно и то же сообщение", bob.publicKey, alice.secretKey);
    const b = crypto.boxEncrypt("одно и то же сообщение", bob.publicKey, alice.secretKey);

    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("nonce имеет длину crypto_box_NONCEBYTES", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();
    const payload = crypto.boxEncrypt("текст", bob.publicKey, alice.secretKey);
    expect(sodium.from_base64(payload.nonce)).toHaveLength(sodium.crypto_box_NONCEBYTES);
  });

  it("подмена шифротекста ломает тег — расшифровка бросает исключение", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();

    const payload = crypto.boxEncrypt("не трогай меня", bob.publicKey, alice.secretKey);
    const raw = sodium.from_base64(payload.ciphertext);
    raw[0] = raw[0]! ^ 0xff; // портим один байт
    const tampered = { ciphertext: sodium.to_base64(raw), nonce: payload.nonce };

    expect(() => crypto.boxOpen(tampered, alice.publicKey, bob.secretKey)).toThrow();
  });

  it("подмена nonce ломает расшифровку", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();

    const payload = crypto.boxEncrypt("сообщение", bob.publicKey, alice.secretKey);
    const otherNonce = sodium.to_base64(sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES));

    expect(() => crypto.boxOpen({ ciphertext: payload.ciphertext, nonce: otherNonce }, alice.publicKey, bob.secretKey)).toThrow();
  });

  it("работает на длинном тексте (проверка объёмных вложений)", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();

    const long = "x".repeat(200_000);
    const payload = crypto.boxEncrypt(long, bob.publicKey, alice.secretKey);
    expect(crypto.boxOpen(payload, alice.publicKey, bob.secretKey)).toBe(long);
  });
});

describe("fingerprint (сверка ключей вслух)", () => {
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
 * Пакет обязан пользоваться только теми примитивами, которые есть в
 * react-native-libsodium: именно из-за отсутствующего там crypto_box_beforenm
 * отправка сообщений на устройстве падала, хотя тесты в Node проходили.
 * Этот тест фиксирует список и не даёт снова взять недоступную функцию.
 */
describe("совместимость с react-native-libsodium", () => {
  const AVAILABLE_ON_DEVICE = new Set([
    "ready",
    "crypto_sign_keypair",
    "crypto_sign_detached",
    "crypto_sign_verify_detached",
    "crypto_box_keypair",
    "crypto_box_easy",
    "crypto_box_open_easy",
    "crypto_generichash",
    "randombytes_buf",
    "to_base64",
    "from_base64",
    "from_string",
    "to_string",
    "crypto_box_NONCEBYTES",
    "crypto_box_SECRETKEYBYTES",
  ]);

  it("createCrypto обращается только к доступным на устройстве функциям", () => {
    const used = new Set<string>();
    const probe = new Proxy(sodium as unknown as Record<string, unknown>, {
      get(target, prop: string) {
        used.add(prop);
        return target[prop];
      },
    }) as unknown as SodiumLike;

    const probed = createCrypto(probe);
    const identity = probed.generateIdentityKeyPair();
    const encryption = probed.generateEncryptionKeyPair();
    const peer = probed.generateEncryptionKeyPair();
    const signed = probed.signDetached(sodium.to_base64(sodium.randombytes_buf(32)), identity.secretKey);
    probed.verifyDetached(signed, sodium.to_base64(sodium.randombytes_buf(32)), identity.publicKey);
    const payload = probed.boxEncrypt("проверка", peer.publicKey, encryption.secretKey);
    probed.boxOpen(payload, encryption.publicKey, peer.secretKey);
    probed.computeFingerprint(identity.publicKey);

    const forbidden = [...used].filter((name) => !AVAILABLE_ON_DEVICE.has(name));
    expect(forbidden).toEqual([]);
  });
});

/**
 * Golden-векторы на фиксированных seed-ключах: ловят регрессию, если вызовы
 * sodium в этом пакете перестанут быть побайтово совместимы (не тот порядок
 * аргументов, не та функция), а не проверяют сами алгоритмы.
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

  it("NaCl box: шифротекст для фиксированных ключей, nonce и текста", () => {
    const boxA = sodium.crypto_box_seed_keypair(seedA);
    const boxB = sodium.crypto_box_seed_keypair(seedB);
    const nonce = new Uint8Array(sodium.crypto_box_NONCEBYTES).fill(7);

    const ciphertext = sodium.crypto_box_easy(
      sodium.from_string("привет, семья"),
      nonce,
      boxB.publicKey,
      boxA.privateKey,
    );

    // Расшифровка второй стороной обязана давать исходный текст.
    const opened = sodium.crypto_box_open_easy(ciphertext, nonce, boxA.publicKey, boxB.privateKey);
    expect(sodium.to_string(opened)).toBe("привет, семья");
    expect(sodium.to_base64(boxA.publicKey)).toBe("GxtY3VDqFLYNoXt5DNAnVNlwybq4ZOuzwPMBb-UdP1c");
  });

  it("fingerprint фиксированного публичного ключа", () => {
    const signKeys = sodium.crypto_sign_seed_keypair(seedA);
    const fp = crypto.computeFingerprint(sodium.to_base64(signKeys.publicKey));
    expect(fp).toBe("E680 8F33 FBEC 8797 5122 804A C9CE DA8E");
  });
});
