import { beforeAll, describe, expect, it } from "vitest";
import { createCrypto } from "../src/index";
import type { SodiumLike } from "../src/sodium";
import { getTestSodium } from "./testSodium";
import { readNativeSodiumExports } from "./deviceExports";
import { utf8DecodeFallback, utf8EncodeFallback } from "../src/utf8";

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
 * Пакет обязан пользоваться только теми примитивами, которые реально есть в
 * react-native-libsodium. Это уже дважды ломало приложение при зелёных тестах в
 * Node: сначала из-за отсутствующего crypto_box_beforenm, потом из-за
 * from_string, которого в нативной сборке нет вовсе.
 *
 * Поэтому список доступного не пишется руками, а читается из самого модуля.
 */
describe("совместимость с react-native-libsodium", () => {
  const availableOnDevice = readNativeSodiumExports();

  it("нативная сборка действительно не содержит функций, из-за которых всё падало", () => {
    // Страховка на случай, если разбор экспортов однажды перестанет работать и
    // начнёт возвращать «всё разрешено»: эти имена там отсутствовать обязаны.
    expect(availableOnDevice.has("crypto_box_beforenm")).toBe(false);
    expect(availableOnDevice.has("from_string")).toBe(false);
    // А эти — обязаны быть, иначе список прочитан неверно.
    expect(availableOnDevice.has("crypto_box_easy")).toBe(true);
    expect(availableOnDevice.has("to_string")).toBe(true);
    expect(availableOnDevice.size).toBeGreaterThan(30);
  });

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

    const forbidden = [...used].filter((name) => !availableOnDevice.has(name));
    expect(forbidden).toEqual([]);
  });

  it("шифрование работает на sodium без функций, отсутствующих на устройстве", () => {
    // Полная имитация устройства: всё, чего нет в нативной сборке, недоступно.
    const deviceSodium = new Proxy(sodium as unknown as Record<string, unknown>, {
      get(target, prop: string) {
        if (!availableOnDevice.has(prop)) return undefined;
        return target[prop];
      },
    }) as unknown as SodiumLike;

    const onDevice = createCrypto(deviceSodium);
    const me = onDevice.generateEncryptionKeyPair();
    const peer = onDevice.generateEncryptionKeyPair();
    const text = "Проверка на устройстве: кириллица, эмодзи 🔐, symbols";

    const payload = onDevice.boxEncrypt(text, peer.publicKey, me.secretKey);
    expect(onDevice.boxOpen(payload, me.publicKey, peer.secretKey)).toBe(text);
    expect(onDevice.computeFingerprint(onDevice.generateIdentityKeyPair().publicKey)).toMatch(
      /^[0-9A-F]{4}( [0-9A-F]{4}){7}$/,
    );
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

/**
 * Сервер хранит шифротекст блобом, и при выдаче истории раньше кодировал его
 * обычным base64 — а libsodium по умолчанию читает URLSAFE_NO_PADDING и падал
 * на символах «+», «/», «=». Из-за этого сообщения из history.fetch не
 * расшифровывались. Клиент обязан принимать оба варианта.
 */
describe("совместимость вариантов base64 (история с сервера)", () => {
  /** Перекодирование urlsafe-no-padding → обычный base64 с «=», как делал сервер. */
  function toStandardBase64(urlsafe: string): string {
    const standard = urlsafe.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (standard.length % 4)) % 4;
    return standard + "=".repeat(padding);
  }

  it("расшифровывает сообщение, пришедшее в обычном base64 с «=»", () => {
    const alice = crypto.generateEncryptionKeyPair();
    const bob = crypto.generateEncryptionKeyPair();
    // 82 байта шифротекста → в обычном base64 обязательно появится «==».
    const text = "Привет! Проверка сквозного шифрования 🔐";

    const payload = crypto.boxEncrypt(text, bob.publicKey, alice.secretKey);
    const asServerSent = {
      ciphertext: toStandardBase64(payload.ciphertext),
      nonce: toStandardBase64(payload.nonce),
    };
    expect(asServerSent.ciphertext).not.toBe(payload.ciphertext);

    expect(crypto.boxOpen(asServerSent, alice.publicKey, bob.secretKey)).toBe(text);
  });

  it("принимает публичный ключ в обычном base64 при вычислении отпечатка", () => {
    const identity = crypto.generateIdentityKeyPair();
    expect(crypto.computeFingerprint(toStandardBase64(identity.publicKey))).toBe(
      crypto.computeFingerprint(identity.publicKey),
    );
  });
});

/**
 * Своя реализация UTF-8 (src/utf8.ts) появилась потому, что в нативной сборке
 * react-native-libsodium нет `from_string`. Сверяем её с эталоном — TextEncoder
 * из Node: именно fallback-версия работает на телефоне, где TextEncoder нет.
 */
describe("UTF-8 без sodium и без TextEncoder", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");

  const samples = [
    "",
    "ascii only",
    "Привет, семья",
    "emoji \u{1F510} и составное \u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
    "смешанное: a\u2014б в\t\n\"'<>&",
    "граница 2 байт: ¡¢£ÿ",
    "граница 3 байт: \u0800\uFFFD日本語",
    "вне BMP: \u{1D11E}\u{10348}\u{1F004}",
  ];

  it("кодирует ровно так же, как TextEncoder", () => {
    for (const sample of samples) {
      expect(Array.from(utf8EncodeFallback(sample)), sample).toEqual(Array.from(encoder.encode(sample)));
    }
  });

  it("декодирует ровно так же, как TextDecoder", () => {
    for (const sample of samples) {
      const bytes = encoder.encode(sample);
      expect(utf8DecodeFallback(bytes), sample).toBe(decoder.decode(bytes));
    }
  });

  it("round-trip выдерживает все кодовые точки BMP и несколько за её пределами", () => {
    let text = "";
    for (let code = 0; code < 0x10000; code += 1) {
      // Сурогаты по отдельности невалидны — они проверены отдельным тестом.
      if (code >= 0xd800 && code <= 0xdfff) continue;
      text += String.fromCharCode(code);
    }
    text += "\u{1D11E}\u{1F510}\u{1F44D}";
    expect(utf8DecodeFallback(utf8EncodeFallback(text))).toBe(text);
  });

  it("одинокий сурогат не роняет кодирование, а заменяется на U+FFFD", () => {
    const lonely = "до\uD83Dпосле";
    expect(utf8DecodeFallback(utf8EncodeFallback(lonely))).toBe("до\uFFFDпосле");
    // TextEncoder делает точно так же — поведение не самодельное.
    expect(decoder.decode(encoder.encode(lonely))).toBe("до\uFFFDпосле");
  });

  it("справляется с длинной строкой (проверка чанкования при декодировании)", () => {
    const long = "строка с кириллицей и эмодзи \u{1F510} ".repeat(20_000);
    expect(utf8DecodeFallback(utf8EncodeFallback(long))).toBe(long);
  });
});
