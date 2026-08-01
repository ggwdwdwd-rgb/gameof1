// Проверка отправки и получения сообщения кодом самого приложения.
//
// Зачем отдельно от server/test/e2e.mjs: там клиент написан заново, прямо в
// тесте. То есть проверялся сервер, а не то, что делает приложение. Здесь же
// импортируются настоящие модули из app/src — шифрование чата, вычисление
// chatId, формат конверта — и гоняются против живого сервера. Если приложение и
// сервер разойдутся хоть в чём-то (не тот ключ, не тот chatId, не то поле в
// пакете), сообщение перестанет доходить, а по экрану это выглядит просто как
// «сообщения не идут». Такой класс ошибок ловится только здесь.
//
// Не покрыто намеренно: sqlite и файлы (expo-sqlite/expo-file-system в Node не
// работают) — под них есть отдельный check-sql.mjs.
//
// Как запустить (из папки server поднять сервер, из app — этот скрипт):
//   PORT=8099 DB_PATH=./data/e2e.db npm run dev            # в папке server
//   PORT=8099 DB_PATH=./data/e2e.db npm run invite:create  # взять два кода
//   WS_URL=ws://127.0.0.1:8099/ws npm run check:send -- <КОД1> <КОД2>
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createCrypto } from "../../packages/crypto/src/index.ts";
import { readNativeSodiumExports } from "../../packages/crypto/test/deviceExports.ts";
// Настоящие модули приложения — ровно то, что выполняется на телефоне.
import { dmChatId, otherUserIdInDm } from "../src/chat/chatId.ts";
import { decryptDeliveredMessage, encryptForChat } from "../src/chat/encryption.ts";

// ws и libsodium-wrappers берём из зависимостей сервера, чтобы не тащить их в
// клиент: на устройстве ни то, ни другое не используется.
const require_ = createRequire(import.meta.url);
const { WebSocket } = require_("../../server/node_modules/ws");
const sodiumFull = require_("../../server/node_modules/libsodium-wrappers");
await sodiumFull.ready;

// Тот же приём, что в e2e: оставляем только функции, доступные в нативной
// сборке react-native-libsodium, иначе тест проверял бы не условия телефона.
const availableOnDevice = readNativeSodiumExports();
const sodium = new Proxy(sodiumFull, {
  get(target, prop) {
    if (typeof prop === "string" && !availableOnDevice.has(prop)) return undefined;
    return target[prop];
  },
});
const crypto = createCrypto(sodium);

const URL = process.env.WS_URL ?? "ws://127.0.0.1:8099/ws";
const codes = process.argv.slice(2);
if (codes.length < 2) {
  console.error("Нужны два кода приглашения: npm run check:send -- КОД1 КОД2");
  process.exit(2);
}

let failed = 0;
function check(name, ok, extra = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

process.on("unhandledRejection", (e) => {
  console.error("ОШИБКА:", e?.message ?? e);
  process.exit(1);
});

/** Минимальный клиент: только транспорт. Вся логика берётся из app/src. */
class Peer {
  constructor(name) {
    this.name = name;
    this.received = [];
    this.waiters = [];
  }

  async open() {
    this.ws = new WebSocket(URL);
    this.ws.on("message", (raw) => {
      const packet = JSON.parse(raw.toString("utf-8"));
      this.received.push(packet);
      this.waiters = this.waiters.filter((w) => {
        if (w.type !== packet.type || !w.match(packet)) return true;
        w.resolve(packet);
        return false;
      });
    });
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
  }

  send(type, payload) {
    this.ws.send(JSON.stringify({ v: 1, type, id: randomUUID(), ts: Date.now(), payload }));
  }

  wait(type, match = () => true, timeoutMs = 5000) {
    const existing = this.received.find((p) => p.type === type && match(p));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: не дождались ${type}`)), timeoutMs);
      this.waiters.push({
        type,
        match,
        resolve: (packet) => {
          clearTimeout(timer);
          resolve(packet);
        },
      });
    });
  }

  /** Регистрация по инвайту + сбор identity в том же виде, что хранит приложение. */
  async register(code, displayName) {
    const identityKeys = crypto.generateIdentityKeyPair();
    const encryptionKeys = crypto.generateEncryptionKeyPair();
    const deviceId = randomUUID();

    await this.open();
    await this.wait("auth.challenge");
    this.send("invite.redeem", {
      code,
      deviceId,
      displayName,
      identityPublicKey: identityKeys.publicKey,
      encryptionPublicKey: encryptionKeys.publicKey,
    });
    const ok = await this.wait("invite.redeem.ok");

    this.identity = {
      userId: ok.payload.userId,
      deviceId,
      displayName,
      serverUrl: URL,
      identityPublicKey: identityKeys.publicKey,
      identitySecretKey: identityKeys.secretKey,
      encryptionPublicKey: encryptionKeys.publicKey,
      encryptionSecretKey: encryptionKeys.secretKey,
    };
    return this.identity;
  }

  /** Контакты в том виде, в каком их держит приложение (см. db/contacts.ts). */
  contactsFromRoster(members) {
    return new Map(
      members.map((m) => [
        m.userId,
        {
          userId: m.userId,
          deviceId: m.deviceId,
          displayName: m.displayName,
          localName: null,
          identityPublicKey: m.identityPublicKey,
          encryptionPublicKey: m.encryptionPublicKey,
          fingerprint: crypto.computeFingerprint(m.identityPublicKey),
          isRevoked: false,
        },
      ]),
    );
  }
}

// ── Регистрация двоих ────────────────────────────────────────────────────────
const alice = new Peer("Алиса");
const bob = new Peer("Боб");
await alice.register(codes[0], "Алиса");
const aliceRoster = await alice.wait("roster.snapshot");
await bob.register(codes[1], "Боб");
const bobRoster = await bob.wait("roster.snapshot");

check("оба участника зарегистрированы", Boolean(alice.identity.userId && bob.identity.userId));

// У Алисы Боба в первом roster ещё нет — он приходит пакетом member.joined,
// как и в приложении.
const joined = await alice.wait("member.joined", (m) => m.payload.userId === bob.identity.userId);
const aliceContacts = alice.contactsFromRoster([...aliceRoster.payload.members, joined.payload]);
const bobContacts = bob.contactsFromRoster(bobRoster.payload.members);

check("Алиса знает Боба", aliceContacts.has(bob.identity.userId));
check("Боб знает Алису", bobContacts.has(alice.identity.userId));

// ── chatId считают обе стороны независимо и должны получить один и тот же ────
const chatIdFromAlice = dmChatId(alice.identity.userId, bob.identity.userId);
const chatIdFromBob = dmChatId(bob.identity.userId, alice.identity.userId);
check("chatId одинаков с обеих сторон", chatIdFromAlice === chatIdFromBob, `${chatIdFromAlice} / ${chatIdFromBob}`);
check(
  "собеседник по chatId определяется верно",
  otherUserIdInDm(chatIdFromAlice, alice.identity.userId) === bob.identity.userId,
);

// ── Отправка кодом приложения ────────────────────────────────────────────────
const text = "проверка отправки 🙂 многострочный\nвторая строка";
const encrypted = encryptForChat(crypto, alice.identity, chatIdFromAlice, text, aliceContacts);
check("приложение зашифровало сообщение", !("error" in encrypted), encrypted.error ?? "");
if ("error" in encrypted) {
  console.log(`\nПровалено: ${failed}`);
  process.exit(1);
}

const clientMsgId = randomUUID();
alice.send("msg.send", {
  clientMsgId,
  chatId: chatIdFromAlice,
  contentType: "text",
  ciphertext: encrypted.ciphertext,
  nonce: encrypted.nonce,
  replyTo: null,
});

// Отказ сервера тоже ждём: если он ответит error, сообщение навсегда осталось
// бы «в отправке», и это надо увидеть здесь, а не на телефоне.
const acceptedOrError = await Promise.race([
  alice.wait("msg.accepted", (m) => m.payload.clientMsgId === clientMsgId),
  alice.wait("error").then((e) => ({ error: e })),
]);
check(
  "сервер принял сообщение, а не отклонил",
  !acceptedOrError.error,
  acceptedOrError.error ? JSON.stringify(acceptedOrError.error.payload) : "",
);
if (acceptedOrError.error) {
  console.log(`\nПровалено: ${failed}`);
  process.exit(1);
}
check("в подтверждении есть серверное время", typeof acceptedOrError.payload.ts === "number");

// ── Получение и расшифровка кодом приложения ─────────────────────────────────
const delivered = await bob.wait("msg.deliver", (m) => m.payload.msgId === clientMsgId);
check("сообщение доставлено получателю", Boolean(delivered));
check(
  "время у отправителя и получателя одинаковое",
  delivered.payload.ts === acceptedOrError.payload.ts,
  `${acceptedOrError.payload.ts} vs ${delivered.payload.ts}`,
);

const decryptedByBob = decryptDeliveredMessage(crypto, bob.identity, delivered.payload, bobContacts);
check("получатель расшифровал сообщение кодом приложения", decryptedByBob === text, String(decryptedByBob));

// Автор получает копию своего сообщения (второе устройство и история) и должен
// открыть её тем же кодом — здесь легко разойтись с ключами.
const ownCopy = alice.received.find((m) => m.type === "msg.deliver" && m.payload.msgId === clientMsgId);
if (ownCopy) {
  const decryptedByAlice = decryptDeliveredMessage(crypto, alice.identity, ownCopy.payload, aliceContacts);
  check("автор расшифровал свою же копию", decryptedByAlice === text, String(decryptedByAlice));
}

// ── История: тот же путь, что при переподключении ────────────────────────────
bob.send("history.fetch", { chatId: chatIdFromBob, sinceTs: 0, limit: 200 });
const page = await bob.wait("history.page", (m) => m.payload.chatId === chatIdFromBob);
const fromHistory = page.payload.messages.find((m) => m.msgId === clientMsgId);
check("сообщение есть в истории", Boolean(fromHistory));
if (fromHistory) {
  const decryptedFromHistory = decryptDeliveredMessage(crypto, bob.identity, fromHistory, bobContacts);
  check("сообщение из истории расшифровывается", decryptedFromHistory === text, String(decryptedFromHistory));
}

alice.ws.close();
bob.ws.close();

console.log(failed === 0 ? "\nОтправка и получение работают" : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
