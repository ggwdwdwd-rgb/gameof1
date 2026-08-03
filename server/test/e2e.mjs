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
const aliceAuth = await alice.redeem(cliCode);
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
// Время в подтверждении — то самое, которым сервер пометил сообщение.
// Отправитель переписывает им своё местное, иначе порядок переписки у двух
// собеседников расходится при расхождении часов телефонов.
check("в msg.accepted есть серверное время", typeof accepted.payload.ts === "number", String(accepted.payload.ts));

const delivered = await bob.wait("msg.deliver", (m) => m.payload.msgId === clientMsgId);
check(
  "время у отправителя и получателя совпадает",
  accepted.payload.ts === delivered.payload.ts,
  `${accepted.payload.ts} vs ${delivered.payload.ts}`,
);
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

// ── 8a. Статус «в сети» ─────────────────────────────────────────────────────
check("в roster есть признак online", rosterB.payload.members.every((m) => typeof m.online === "boolean"));
check(
  "первый участник виден как online, пока подключён",
  rosterB.payload.members.find((m) => m.userId === alice.userId)?.online === true,
);

// Отдельное соединение, которое подключится и отключится: остальные должны
// увидеть и появление, и уход.
const watcherCode = await (async () => {
  alice.send("invite.create", {});
  alice.received = alice.received.filter((m) => m.type !== "invite.created");
  const created2 = await alice.wait("invite.created");
  return created2.payload.code;
})();
const watcher = new Client("Наблюдатель");
await watcher.open();
await watcher.redeem(watcherCode);
const cameOnline = await alice.wait("presence", (m) => m.payload.userId === watcher.userId && m.payload.online === true);
check("появление в сети рассылается остальным", Boolean(cameOnline));

watcher.ws.close();
const wentOffline = await alice.wait(
  "presence",
  (m) => m.payload.userId === watcher.userId && m.payload.online === false,
);
check("уход из сети рассылается остальным", Boolean(wentOffline));
check("вместе с уходом приходит время последнего появления", typeof wentOffline.payload.lastSeenAt === "number");

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
const bob2Auth = await bob2.authenticate();
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

// ── 10a. История длиннее одной страницы ─────────────────────────────────────
// Клиент просит по 200 сообщений и, получив полную страницу, запрашивает
// продолжение от времени последнего сообщения. Здесь проверяется контракт, на
// который он при этом опирается: страница не длиннее лимита, отдаётся по
// возрастанию времени, а следующий запрос от последнего ts выдаёт остаток без
// повторов и без пропусков.
const PAGE = 200;
const EXTRA = 12;
for (let i = 0; i < PAGE + EXTRA; i += 1) {
  const bulk = crypto.boxEncrypt(`массовое ${i}`, alicePeerKey, alice.encryption.secretKey);
  alice.send("msg.send", {
    clientMsgId: randomUUID(),
    chatId,
    contentType: "text",
    ciphertext: bulk.ciphertext,
    nonce: bulk.nonce,
    replyTo: null,
  });
}
// Ждём подтверждения последнего: пока сервер не записал всё, история неполна.
await new Promise((r) => setTimeout(r, 2500));

bob2.received = bob2.received.filter((m) => m.type !== "history.page");
bob2.send("history.fetch", { chatId, sinceTs: 0, limit: PAGE });
const firstPage = await bob2.wait("history.page");
check("страница истории не длиннее запрошенного лимита", firstPage.payload.messages.length === PAGE, String(firstPage.payload.messages.length));
check(
  "страница отдаётся по возрастанию времени",
  firstPage.payload.messages.every((m, i) => i === 0 || m.ts >= firstPage.payload.messages[i - 1].ts),
);

const lastMessage = firstPage.payload.messages.at(-1);
const lastTs = lastMessage.ts;
bob2.received = bob2.received.filter((m) => m.type !== "history.page");
// Курсор — пара (время, id): без id сообщения, попавшие в ту же миллисекунду,
// что и последнее на странице, терялись бы на границе.
bob2.send("history.fetch", { chatId, sinceTs: lastTs, sinceId: lastMessage.msgId, limit: PAGE });
const secondPage = await bob2.wait("history.page");
check("продолжение истории приходит", secondPage.payload.messages.length > 0, String(secondPage.payload.messages.length));
check(
  "продолжение строго после курсора",
  secondPage.payload.messages.every((m) => m.ts > lastTs || (m.ts === lastTs && m.msgId > lastMessage.msgId)),
);
const firstIds = new Set(firstPage.payload.messages.map((m) => m.msgId));
check(
  "страницы не пересекаются",
  secondPage.payload.messages.every((m) => !firstIds.has(m.msgId)),
);
check(
  "вместе страницы покрывают всю переписку",
  firstPage.payload.messages.length + secondPage.payload.messages.length >= PAGE + EXTRA,
  `${firstPage.payload.messages.length} + ${secondPage.payload.messages.length}`,
);

// ── 11. Удаление у всех — только автором ────────────────────────────────────
bob2.send("msg.delete", { msgId: clientMsgId, chatId });
const notOwner = await bob2.wait("error", (m) => m.payload.code === "NOT_OWNER");
check("не автор не может удалить сообщение", notOwner.payload.code === "NOT_OWNER");

alice.send("msg.delete", { msgId: clientMsgId, chatId });
const deleted = await bob2.wait("msg.deleted", (m) => m.payload.msgId === clientMsgId);
check("автор удаляет сообщение у всех", Boolean(deleted));

// ── 10b. «В сети» означает «человек у телефона», а не «сокет открыт» ─────────
// Со службой переднего плана соединение живёт постоянно, поэтому активность
// приходит от клиента явно. Без этого человек висел бы «в сети» с погашенным
// экраном в кармане.
// Историю presence чистим ДО отправки: Боб уже отключался выше, и подходящий
// пакет лежит в полученном — wait нашёл бы его и проверка прошла бы вслепую.
alice.received = alice.received.filter((m) => m.type !== "presence");
bob2.send("presence.set", { active: false });
const wentAway = await alice.wait("presence", (m) => m.payload.userId === bob.userId && m.payload.online === false);
check("уход в фон рассылается как «не в сети»", Boolean(wentAway));
check("вместе с уходом приходит время последнего появления", typeof wentAway.payload.lastSeenAt === "number");

// Повтор того же состояния рассылать незачем.
alice.received = alice.received.filter((m) => m.type !== "presence");
bob2.send("presence.set", { active: false });
await new Promise((r) => setTimeout(r, 300));
// Только про Боба: рядом отключаются другие участники теста, и их presence
// попал бы в это окно, сделав проверку случайной.
const extraPresence = alice.received.filter((m) => m.type === "presence" && m.payload.userId === bob.userId);
check(
  "повтор того же состояния не рассылается",
  extraPresence.length === 0,
  JSON.stringify(extraPresence.map((m) => m.payload)),
);

bob2.send("presence.set", { active: true });
const cameBack = await alice.wait("presence", (m) => m.payload.userId === bob.userId && m.payload.online === true);
check("возврат в приложение рассылается как «в сети»", Boolean(cameBack));

// ── 11b. Удаление участника — только первым зарегистрированным ──────────────
// Алиса зарегистрировалась первой, значит распоряжаться составом может только
// она. Права здесь важнее всего остального: ошибка означает, что любой
// участник может выкинуть любого.
check("сервер сообщил Алисе, что она админ", aliceAuth.payload.isAdmin === true, String(aliceAuth.payload.isAdmin));
check("Боб админом не считается", bob2Auth.payload.isAdmin !== true, String(bob2Auth.payload.isAdmin));

bob2.send("member.remove", { userId: alice.userId });
const notAdmin = await bob2.wait("error", (m) => m.payload.code === "NOT_ADMIN");
check("не админ не может удалить участника", notAdmin.payload.code === "NOT_ADMIN");

alice.send("member.remove", { userId: alice.userId });
const removeSelf = await alice.wait("error", (m) => m.payload.code === "CANNOT_REMOVE_SELF");
check("себя удалить нельзя", removeSelf.payload.code === "CANNOT_REMOVE_SELF");

alice.send("member.remove", { userId: "нет-такого" });
const noUser = await alice.wait("error", (m) => m.payload.code === "NO_SUCH_USER");
check("несуществующего участника удалить нельзя", noUser.payload.code === "NO_SUCH_USER");

// ── 11c. Отзыв доступа устройства — потерянный телефон ──────────────────────
// Мера мягче удаления и обратимая: человек и переписка остаются, отключается
// только устройство. Права те же, что на удаление.
bob2.send("device.revoke", { deviceId: alice.deviceId, revoked: true });
const revokeNotAdmin = await bob2.wait("error", (m) => m.payload.code === "NOT_ADMIN");
check("не админ не может отозвать доступ", revokeNotAdmin.payload.code === "NOT_ADMIN");

alice.send("device.revoke", { deviceId: alice.deviceId, revoked: true });
const revokeSelf = await alice.wait("error", (m) => m.payload.code === "CANNOT_REVOKE_SELF");
check("своё устройство отозвать нельзя", revokeSelf.payload.code === "CANNOT_REVOKE_SELF");

alice.send("device.revoke", { deviceId: "нет-такого", revoked: true });
const noDevice = await alice.wait("error", (m) => m.payload.code === "NO_SUCH_DEVICE");
check("несуществующее устройство отозвать нельзя", noDevice.payload.code === "NO_SUCH_DEVICE");

// Свидетель знакомится с Бобом ДО отзыва: добавить в контакты человека, у
// которого не осталось действующих устройств, нельзя — шифровать было бы нечем.
const witnessCode = await (async () => {
  alice.send("invite.create", {});
  alice.received = alice.received.filter((m) => m.type !== "invite.created");
  return (await alice.wait("invite.created")).payload.code;
})();
const witness = new Client("Свидетель");
await witness.open();
await witness.redeem(witnessCode);
await witness.wait("roster.snapshot");
// Список участников теперь у каждого свой: свидетель вошёл по коду Алисы и
// контактом Боба не является. Чтобы Боб появился у него в списке, его надо
// добавить — как это и делает человек в приложении.
witness.send("contact.add", { userId: bob.userId });
await witness.wait("contact.added", (m) => m.payload.user.userId === bob.userId);
witness.ws.close();
await new Promise((r) => setTimeout(r, 300));

alice.send("device.revoke", { deviceId: bob.deviceId, revoked: true });
const revoked = await alice.wait("member.revoked", (m) => m.payload.deviceId === bob.deviceId);
check("админ отзывает доступ, остальные получают member.revoked", revoked.payload.revoked === true);
check("в member.revoked есть участник", revoked.payload.userId === bob.userId, revoked.payload.userId);

// Соединение отозванного рвётся сразу: иначе оно продолжало бы получать
// сообщения до своего переподключения — а от этого отзыв и защищает.
await new Promise((r) => setTimeout(r, 400));
check(
  "соединение отозванного устройства разорвано",
  bob2.ws.readyState !== bob2.ws.OPEN,
  `readyState=${bob2.ws.readyState}`,
);

alice.send("device.revoke", { deviceId: bob.deviceId, revoked: true });
const alreadyRevoked = await alice.wait("error", (m) => m.payload.code === "ALREADY_IN_STATE");
check("повторный отзыв отклоняется", alreadyRevoked.payload.code === "ALREADY_IN_STATE");

// Отозванное устройство больше не входит — но именно с кодом REVOKED, а не
// UNKNOWN_DEVICE: приложению это разные сообщения для человека.
const revokedLogin = new Client("Боб-отозванный");
revokedLogin.deviceId = bob.deviceId;
revokedLogin.identity = bob.identity;
await revokedLogin.open();
const revokedChallenge = await revokedLogin.wait("auth.challenge");
revokedLogin.send("auth.response", {
  deviceId: revokedLogin.deviceId,
  signature: crypto.signDetached(revokedChallenge.payload.nonce, revokedLogin.identity.secretKey),
});
const revokedError = await revokedLogin.wait("auth.error");
check("отозванное устройство получает REVOKED", revokedError.payload.code === "REVOKED", revokedError.payload.code);
revokedLogin.ws.close();

// Главное свойство: отозванное устройство остаётся в roster с признаком.
// Клиент удаляет участников, которых в roster нет, вместе с перепиской — если
// сервер скрывал бы отозванных, отзыв одного телефона стирал бы переписку с
// этим человеком у всех остальных.
// Главное свойство: отозванное устройство остаётся в roster с признаком.
// Клиент удаляет участников, которых в roster нет, вместе с перепиской — если
// сервер скрывал бы отозванных, отзыв одного телефона стирал бы переписку с
// этим человеком у всех остальных.
const witness2 = new Client("Свидетель");
witness2.deviceId = witness.deviceId;
witness2.identity = witness.identity;
witness2.encryption = witness.encryption;
await witness2.open();
await witness2.authenticate();
const witnessRoster = await witness2.wait("roster.snapshot");
const bobInRoster = witnessRoster.payload.members.find((m) => m.deviceId === bob.deviceId);
check("отозванное устройство остаётся в roster", Boolean(bobInRoster));
check("в roster у него признак revoked", bobInRoster?.revoked === true, JSON.stringify(bobInRoster?.revoked));
check(
  "у действующих устройств признак revoked снят",
  witnessRoster.payload.members.filter((m) => m.deviceId !== bob.deviceId).every((m) => m.revoked === false),
);
check(
  "ключи отозванного устройства сохраняются (иначе его сообщения не расшифровать)",
  bobInRoster?.encryptionPublicKey === bob.encryption.publicKey,
);
witness2.ws.close();

// Отзыв обратим — иначе он был бы просто удалением с лишним шагом.
alice.received = alice.received.filter((m) => m.type !== "member.revoked");
alice.send("device.revoke", { deviceId: bob.deviceId, revoked: false });
const restored = await alice.wait("member.revoked", (m) => m.payload.deviceId === bob.deviceId);
check("доступ возвращается тем же пакетом", restored.payload.revoked === false);

const bob3 = new Client("Боб");
bob3.deviceId = bob.deviceId;
bob3.identity = bob.identity;
bob3.encryption = bob.encryption;
bob3.userId = bob.userId;
await bob3.open();
await bob3.authenticate();
check("после возврата доступа устройство снова входит", true);

// Само удаление проверяем последним: после него Боба в системе нет.
alice.send("member.remove", { userId: bob.userId });
const memberRemoved = await alice.wait("member.removed", (m) => m.payload.userId === bob.userId);
check("админ удаляет участника, остальные получают member.removed", Boolean(memberRemoved));

// Соединение удалённого рвётся сразу: иначе он остался бы «на связи» и мог бы
// отправлять сообщения, хотя устройства в базе уже нет.
await new Promise((r) => setTimeout(r, 400));
check("соединение удалённого участника разорвано", bob3.ws.readyState !== bob3.ws.OPEN, `readyState=${bob3.ws.readyState}`);

// Повторный вход тем же устройством теперь невозможен — записи нет.
const ghost = new Client("Боб-призрак");
ghost.deviceId = bob.deviceId;
ghost.identity = bob.identity;
await ghost.open();
await ghost.wait("auth.challenge");
ghost.send("auth.response", {
  deviceId: ghost.deviceId,
  signature: crypto.signDetached((await ghost.wait("auth.challenge")).payload.nonce, ghost.identity.secretKey),
});
const ghostError = await ghost.wait("auth.error");
check("удалённое устройство больше не входит", ghostError.payload.code === "UNKNOWN_DEVICE", ghostError.payload.code);
ghost.ws.close();

// ── 12. Неизвестный тип пакета ──────────────────────────────────────────────
alice.send("totally.unknown", {});
const unknown = await alice.wait("error", (m) => m.payload.code === "UNKNOWN_TYPE");
check("неизвестный тип пакета не рвёт соединение", unknown.payload.code === "UNKNOWN_TYPE");

alice.ws.close();
bob3.ws.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nИтог: ${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length === 0 ? 0 : 1);
