// Сквозная проверка сервера: два участника регистрируются по инвайтам,
// обмениваются зашифрованными сообщениями, получают статусы, историю и удаление.
// Шифрование берётся из packages/crypto, а sodium урезан до набора функций
// react-native-libsodium — то есть в точности условия телефона.
//
// Как запустить (две консоли, из папки server):
//   PORT=8099 DB_PATH=./data/e2e.db npm run dev
//   PORT=8099 DB_PATH=./data/e2e.db npm run invite:create   # взять код
//   WS_URL=ws://127.0.0.1:8099/ws npm run test:e2e -- <КОД>
// Код одноразовый, поэтому для каждого прогона нужен новый.
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const sodiumFull = require_("libsodium-wrappers");
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { createCrypto } from "../../packages/crypto/src/index.ts";
import { readNativeSodiumExports } from "../../packages/crypto/test/deviceExports.ts";

Error.stackTraceLimit = 4;
process.on("unhandledRejection", (e) => {
  console.error("ОШИБКА:", e && e.message ? e.message : e);
  process.exit(1);
});

await sodiumFull.ready;

// Оставляем доступным ровно то, что экспортирует нативная сборка
// react-native-libsodium — список читается из самого модуля, не пишется руками.
const availableOnDevice = readNativeSodiumExports();
const sodium = new Proxy(sodiumFull, {
  get(target, prop) {
    if (typeof prop === "string" && !availableOnDevice.has(prop)) return undefined;
    return target[prop];
  },
});
const crypto = createCrypto(sodium);

const URL = process.env.WS_URL ?? "ws://127.0.0.1:8099/ws";
const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

function envelope(type, payload) {
  return { v: 1, type, id: randomUUID(), ts: Date.now(), payload };
}

/** Простой клиент: собирает пришедшие пакеты и умеет ждать нужный тип. */
class Client {
  constructor(name) {
    this.name = name;
    this.deviceId = randomUUID();
    this.identity = crypto.generateIdentityKeyPair();
    this.encryption = crypto.generateEncryptionKeyPair();
    this.received = [];
    this.waiters = [];
  }

  async open() {
    this.ws = new WebSocket(URL);
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      this.received.push(msg);
      for (const w of [...this.waiters]) {
        if (w.type === msg.type && (!w.predicate || w.predicate(msg))) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          clearTimeout(w.timer);
          w.resolve(msg);
        }
      }
    });
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
  }

  send(type, payload) {
    this.ws.send(JSON.stringify(envelope(type, payload)));
  }

  wait(type, predicate, timeoutMs = 5000) {
    const existingIndex = this.received.findIndex((m) => m.type === type && (!predicate || predicate(m)));
    if (existingIndex >= 0) return Promise.resolve(this.received[existingIndex]);
    return new Promise((resolve, reject) => {
      const waiter = { type, predicate, resolve };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`${this.name}: не дождался пакета ${type}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async redeem(code) {
    await this.wait("auth.challenge");
    this.send("invite.redeem", {
      code,
      deviceId: this.deviceId,
      displayName: this.name,
      identityPublicKey: this.identity.publicKey,
      encryptionPublicKey: this.encryption.publicKey,
    });
    const ok = await this.wait("invite.redeem.ok");
    this.userId = ok.payload.userId;
    return ok;
  }

  async authenticate() {
    const challenge = await this.wait("auth.challenge");
    this.send("auth.response", {
      deviceId: this.deviceId,
      signature: crypto.signDetached(challenge.payload.nonce, this.identity.secretKey),
    });
    return this.wait("auth.ok");
  }
}

function dmChatId(a, b) {
  return `dm:${[a, b].sort().join(":")}`;
}

// ── 1. Первый участник входит по инвайту из CLI ──────────────────────────────
const cliCode = process.argv[2];
const alice = new Client("Алиса");
await alice.open();
await alice.redeem(cliCode);
check("регистрация первого участника по CLI-коду", Boolean(alice.userId));

const rosterA = await alice.wait("roster.snapshot");
check("roster.snapshot приходит сразу после входа", Array.isArray(rosterA.payload.members));

// ── 2. Первый участник выпускает код из приложения ───────────────────────────
alice.send("invite.create", {});
const created = await alice.wait("invite.created");
check("invite.create выдаёт код из приложения", /^[A-Z0-9]{8}$/.test(created.payload.code), created.payload.code);
check("в invite.created есть QR-payload", created.payload.qrPayload.includes(created.payload.code));

// ── 3. Второй участник входит по этому коду ──────────────────────────────────
const bob = new Client("Боб");
await bob.open();
await bob.redeem(created.payload.code);
check("регистрация второго участника по коду из приложения", Boolean(bob.userId));

const rosterB = await bob.wait("roster.snapshot");
check(
  "новый участник видит первого в roster",
  rosterB.payload.members.some((m) => m.userId === alice.userId),
);
const joined = await alice.wait("member.joined", (m) => m.payload.userId === bob.userId);
check("первый участник получает member.joined", joined.payload.displayName === "Боб");

// ── 4. Код одноразовый ──────────────────────────────────────────────────────
const impostor = new Client("Самозванец");
await impostor.open();
await impostor.wait("auth.challenge");
impostor.send("invite.redeem", {
  code: created.payload.code,
  deviceId: impostor.deviceId,
  displayName: "Самозванец",
  identityPublicKey: impostor.identity.publicKey,
  encryptionPublicKey: impostor.encryption.publicKey,
});
const reused = await impostor.wait("invite.redeem.error");
check("повторное использование кода отклонено", Boolean(reused.payload.code), reused.payload.code);
impostor.ws.close();

// ── 5. Сообщение Алиса → Боб, шифрование как на устройстве ───────────────────
const chatId = dmChatId(alice.userId, bob.userId);
const bobPubKey = rosterB.payload.members.find((m) => m.userId === alice.userId).encryptionPublicKey;
const alicePeerKey = joined.payload.encryptionPublicKey;

const text = "Привет! Проверка сквозного шифрования 🔐";
const box = crypto.boxEncrypt(text, alicePeerKey, alice.encryption.secretKey);
const clientMsgId = randomUUID();
alice.send("msg.send", {
  clientMsgId,
  chatId,
  contentType: "text",
  ciphertext: box.ciphertext,
  nonce: box.nonce,
  replyTo: null,
});
const accepted = await alice.wait("msg.accepted", (m) => m.payload.clientMsgId === clientMsgId);
check("сервер принял сообщение (msg.accepted)", Boolean(accepted));

const delivered = await bob.wait("msg.deliver", (m) => m.payload.msgId === clientMsgId);
const decrypted = crypto.boxOpen(
  { ciphertext: delivered.payload.ciphertext, nonce: delivered.payload.nonce },
  bobPubKey,
  bob.encryption.secretKey,
);
check("получатель расшифровал сообщение", decrypted === text, decrypted);

// Автор тоже получает копию (второе устройство/история) и должен её открыть.
const selfCopy = await alice.wait("msg.deliver", (m) => m.payload.msgId === clientMsgId).catch(() => null);
if (selfCopy) {
  const own = crypto.boxOpen(
    { ciphertext: selfCopy.payload.ciphertext, nonce: selfCopy.payload.nonce },
    alicePeerKey,
    alice.encryption.secretKey,
  );
  check("автор расшифровал собственное сообщение", own === text);
}

// ── 5b. Повторная отправка того же сообщения идемпотентна ────────────────────
// Так бывает после переподключения: подтверждение msg.accepted потерялось, и
// клиент присылает сообщение из своей очереди заново. Раньше сервер отвечал
// ошибкой DUPLICATE без clientMsgId, поэтому клиент не мог убрать сообщение из
// очереди и пересылал его вечно.
const deliveredBefore = bob.received.filter((m) => m.type === "msg.deliver").length;
alice.received = alice.received.filter((m) => m.type !== "msg.accepted");
alice.send("msg.send", {
  clientMsgId,
  chatId,
  contentType: "text",
  ciphertext: box.ciphertext,
  nonce: box.nonce,
  replyTo: null,
});
const reaccepted = await alice.wait("msg.accepted", (m) => m.payload.clientMsgId === clientMsgId);
check("повтор отправки подтверждается, а не отклоняется", Boolean(reaccepted));
check("в msg.accepted есть chatId", reaccepted.payload.chatId === chatId, String(reaccepted.payload.chatId));

await new Promise((r) => setTimeout(r, 400));
const deliveredAfter = bob.received.filter((m) => m.type === "msg.deliver").length;
check("повтор не дублирует сообщение у получателя", deliveredAfter === deliveredBefore, `${deliveredBefore} -> ${deliveredAfter}`);

// ── 6. Статусы ──────────────────────────────────────────────────────────────
bob.send("msg.ack", { msgId: clientMsgId, chatId, status: "delivered" });
const ackDelivered = await alice.wait("msg.ackRelay", (m) => m.payload.status === "delivered");
check("статус «доставлено» доходит до автора", ackDelivered.payload.msgId === clientMsgId);
bob.send("msg.ack", { msgId: clientMsgId, chatId, status: "read" });
const ackRead = await alice.wait("msg.ackRelay", (m) => m.payload.status === "read");
check("статус «прочитано» доходит до автора", ackRead.payload.msgId === clientMsgId);

// ── 7. Индикатор «печатает» ─────────────────────────────────────────────────
bob.send("typing", { chatId, isTyping: true });
const typing = await alice.wait("typing.relay", (m) => m.payload.isTyping === true);
check("typing.relay доходит до собеседника", typing.payload.fromUserId === bob.userId);

// ── 8. Чужой чат и групповой чат отклоняются ─────────────────────────────────
bob.send("msg.send", {
  clientMsgId: randomUUID(),
  chatId: "family",
  contentType: "text",
  ciphertext: box.ciphertext,
  nonce: box.nonce,
  replyTo: null,
});
const groupRejected = await bob.wait("error", (m) => m.payload.code !== "UNKNOWN_TYPE");
check("групповой чат отклонён", Boolean(groupRejected.payload.code), groupRejected.payload.code);

bob.send("msg.send", {
  clientMsgId: randomUUID(),
  chatId: dmChatId(alice.userId, "00000000-0000-0000-0000-000000000000"),
  contentType: "text",
  ciphertext: box.ciphertext,
  nonce: box.nonce,
  replyTo: null,
});
const foreignRejected = await bob.wait(
  "error",
  (m) => m !== groupRejected && m.payload.code !== "UNKNOWN_TYPE",
  5000,
);
check("чужой чат отклонён", Boolean(foreignRejected.payload.code), foreignRejected.payload.code);

// ── 8b. Переименование участника ────────────────────────────────────────────
bob.send("profile.update", { displayName: "Боб Новый" });
const renamed = await alice.wait("member.updated", (m) => m.payload.userId === bob.userId);
check("смена имени доходит до остальных", renamed.payload.displayName === "Боб Новый", renamed.payload.displayName);
const selfRenamed = await bob.wait("member.updated", (m) => m.payload.userId === bob.userId);
check("автор тоже получает подтверждение", selfRenamed.payload.displayName === "Боб Новый");

bob.send("profile.update", { displayName: "   " });
const badName = await bob.wait("error", (m) => m.payload.code === "BAD_NAME");
check("пустое имя отклонено", badName.payload.code === "BAD_NAME");

bob.send("profile.update", { displayName: "х".repeat(41) });
const longName = await bob.wait("error", (m) => m.payload.code === "BAD_NAME", 5000);
check("слишком длинное имя отклонено", Boolean(longName));

// ── 9. Незнакомое устройство получает внятный отказ ──────────────────────────
// Это ровно тот случай, который в приложении выглядел как «нет соединения»:
// сокет открывается, но сервер не признаёт устройство.
const stranger = new Client("Незнакомец");
await stranger.open();
const strangerChallenge = await stranger.wait("auth.challenge");
stranger.send("auth.response", {
  deviceId: randomUUID(),
  signature: crypto.signDetached(strangerChallenge.payload.nonce, stranger.identity.secretKey),
});
const authError = await stranger.wait("auth.error");
check("незнакомое устройство получает auth.error", authError.payload.code === "UNKNOWN_DEVICE", authError.payload.code);
stranger.ws.close();

// ── 10. Переподключение и история ────────────────────────────────────────────
bob.ws.close();
await new Promise((r) => setTimeout(r, 300));
const bob2 = new Client("Боб");
bob2.deviceId = bob.deviceId;
bob2.identity = bob.identity;
bob2.encryption = bob.encryption;
bob2.userId = bob.userId;
await bob2.open();
await bob2.authenticate();
check("повторный вход по подписи устройства", true);

bob2.send("history.fetch", { chatId, sinceTs: 0, limit: 200 });
const page = await bob2.wait("history.page");
check("история содержит отправленное сообщение", page.payload.messages.some((m) => m.msgId === clientMsgId));
const fromHistory = page.payload.messages.find((m) => m.msgId === clientMsgId);
check(
  "сообщение из истории расшифровывается",
  crypto.boxOpen({ ciphertext: fromHistory.ciphertext, nonce: fromHistory.nonce }, bobPubKey, bob2.encryption.secretKey) ===
    text,
);

// ── 11. Удаление у всех — только автором ────────────────────────────────────
bob2.send("msg.delete", { msgId: clientMsgId, chatId });
const notOwner = await bob2.wait("error", (m) => m.payload.code === "NOT_OWNER");
check("не автор не может удалить сообщение", notOwner.payload.code === "NOT_OWNER");

alice.send("msg.delete", { msgId: clientMsgId, chatId });
const deleted = await bob2.wait("msg.deleted", (m) => m.payload.msgId === clientMsgId);
check("автор удаляет сообщение у всех", Boolean(deleted));

// ── 12. Неизвестный тип пакета ──────────────────────────────────────────────
alice.send("totally.unknown", {});
const unknown = await alice.wait("error", (m) => m.payload.code === "UNKNOWN_TYPE");
check("неизвестный тип пакета не рвёт соединение", unknown.payload.code === "UNKNOWN_TYPE");

alice.ws.close();
bob2.ws.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nИтог: ${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length === 0 ? 0 : 1);
