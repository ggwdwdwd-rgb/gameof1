// Сквозная проверка аккаунтов: регистрация по почте, вход, поиск по @тегу,
// контакты и — главное — что незнакомые люди друг друга не видят.
//
// Последнее и есть смысл этого этапа. Раньше сервер рассылал полный список всех
// участников каждому подключившемуся: зарегистрировался — и тебя видят все.
// Теперь список у каждого свой, и попасть в него можно только двумя способами:
// быть найденным по тегу или написать первым.
//
// Как запустить (из папки server):
//   PORT=8097 DB_PATH=./data/acc.db npm run dev
//   WS_URL=ws://127.0.0.1:8097/ws npm run test:accounts
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const sodiumFull = require_("libsodium-wrappers");
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { createCrypto } from "../../packages/crypto/src/index.ts";

Error.stackTraceLimit = 4;
process.on("unhandledRejection", (e) => {
  console.error("ОШИБКА:", e && e.message ? e.message : e);
  process.exit(1);
});

await sodiumFull.ready;
const crypto = createCrypto(sodiumFull);

const URL = process.env.WS_URL ?? "ws://127.0.0.1:8097/ws";
const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

function envelope(type, payload) {
  return { v: 1, type, id: randomUUID(), ts: Date.now(), payload };
}

/** Уникальный суффикс на прогон: база между запусками не чистится. */
const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

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
    await this.wait("auth.challenge");
  }

  send(type, payload) {
    this.ws.send(JSON.stringify(envelope(type, payload)));
  }

  wait(type, predicate, timeoutMs = 8000) {
    const existing = this.received.findIndex((m) => m.type === type && (!predicate || predicate(m)));
    if (existing >= 0) return Promise.resolve(this.received[existing]);
    return new Promise((resolve, reject) => {
      const waiter = { type, predicate, resolve };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`${this.name}: не дождался пакета ${type}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  keys() {
    return {
      deviceId: this.deviceId,
      identityPublicKey: this.identity.publicKey,
      encryptionPublicKey: this.encryption.publicKey,
    };
  }

  async register(tag, password = "очень-длинный-пароль") {
    this.username = `${tag}_${RUN}`;
    this.email = `${tag}_${RUN}@example.com`;
    this.password = password;
    this.send("auth.register", {
      email: this.email,
      password,
      username: this.username,
      displayName: this.name,
      ...this.keys(),
    });
    const ok = await this.wait("auth.register.ok");
    this.userId = ok.payload.userId;
    return ok;
  }
}

function dmChatId(a, b) {
  return `dm:${[a, b].sort().join(":")}`;
}

// ── 1. Регистрация по почте ─────────────────────────────────────────────────
const alice = new Client("Алиса");
await alice.open();
const aliceReg = await alice.register("alice");
check("регистрация по почте и паролю", Boolean(alice.userId));
check("сервер вернул @тег", aliceReg.payload.username === alice.username, String(aliceReg.payload.username));
// Права проверяем на факт передачи, а не на значение: база между прогонами не
// чистится, и в непустой системе главный — кто-то из прежних аккаунтов. Что
// первый участник ПУСТОЙ системы становится главным, проверяет test:users, где
// база создаётся с нуля.
check("признак прав приходит в ответе", typeof aliceReg.payload.isAdmin === "boolean", String(aliceReg.payload.isAdmin));

const aliceRoster = await alice.wait("roster.snapshot");
check(
  "у нового аккаунта список контактов пуст",
  aliceRoster.payload.members.length === 0,
  String(aliceRoster.payload.members.length),
);

// ── 2. Проверки при регистрации ─────────────────────────────────────────────
const bad = new Client("Плохой");
await bad.open();

bad.send("auth.register", { email: "не-почта", password: "очень-длинный-пароль", username: `x_${RUN}`, displayName: "X", ...bad.keys() });
check("почта без @ отклонена", (await bad.wait("auth.register.error")).payload.code === "BAD_EMAIL");

bad.received = [];
bad.send("auth.register", { email: `a_${RUN}@example.com`, password: "1234567", username: `y_${RUN}`, displayName: "Y", ...bad.keys() });
check("короткий пароль отклонён", (await bad.wait("auth.register.error")).payload.code === "WEAK_PASSWORD");

bad.received = [];
bad.send("auth.register", { email: `b_${RUN}@example.com`, password: "очень-длинный-пароль", username: "тег", displayName: "Z", ...bad.keys() });
check("тег кириллицей отклонён", (await bad.wait("auth.register.error")).payload.code === "BAD_USERNAME");

bad.received = [];
bad.send("auth.register", { email: alice.email, password: "очень-длинный-пароль", username: `q_${RUN}`, displayName: "Q", ...bad.keys() });
check("занятая почта отклонена", (await bad.wait("auth.register.error")).payload.code === "EMAIL_TAKEN");

bad.received = [];
bad.send("auth.register", { email: `c_${RUN}@example.com`, password: "очень-длинный-пароль", username: alice.username, displayName: "W", ...bad.keys() });
check("занятый тег отклонён", (await bad.wait("auth.register.error")).payload.code === "USERNAME_TAKEN");

// Регистр почты не должен создавать второй аккаунт на тот же ящик.
bad.received = [];
bad.send("auth.register", { email: alice.email.toUpperCase(), password: "очень-длинный-пароль", username: `e_${RUN}`, displayName: "E", ...bad.keys() });
check("почта в другом регистре — тот же ящик", (await bad.wait("auth.register.error")).payload.code === "EMAIL_TAKEN");
bad.ws.close();

// ── 3. Второй аккаунт: незнакомцы друг друга не видят ───────────────────────
const bob = new Client("Боб");
await bob.open();
await bob.register("bob");
check("второй аккаунт зарегистрирован", Boolean(bob.userId));
check("второй аккаунт не главный", (await bob.wait("auth.register.ok")).payload.isAdmin !== true);

const bobRoster = await bob.wait("roster.snapshot");
check(
  "новый участник НЕ видит уже зарегистрированных",
  bobRoster.payload.members.length === 0,
  JSON.stringify(bobRoster.payload.members.map((m) => m.displayName)),
);

// И обратное: Алисе о появлении Боба знать не положено.
await new Promise((r) => setTimeout(r, 400));
check(
  "уже зарегистрированный НЕ узнаёт о новом участнике",
  alice.received.filter((m) => m.type === "member.joined" || m.type === "presence").length === 0,
  JSON.stringify(alice.received.filter((m) => m.type === "member.joined" || m.type === "presence").map((m) => m.type)),
);

// ── 4. Поиск по @тегу ───────────────────────────────────────────────────────
alice.send("user.search", { query: `нет-такого-тега-${RUN}` });
check("поиск несуществующего тега ничего не находит", (await alice.wait("user.found")).payload.user === null);

alice.received = alice.received.filter((m) => m.type !== "user.found");
alice.send("user.search", { query: `@${bob.username}` });
const foundBob = await alice.wait("user.found");
check("поиск по @тегу находит человека", foundBob.payload.user?.userId === bob.userId);
check("в карточке есть публичный ключ шифрования", foundBob.payload.user?.encryptionPublicKey === bob.encryption.publicKey);
check("в карточке нет почты и телефона", !("email" in (foundBob.payload.user ?? {})) && !("phone" in (foundBob.payload.user ?? {})));

alice.received = alice.received.filter((m) => m.type !== "user.found");
alice.send("user.search", { query: bob.email });
check("поиск по почте тоже работает", (await alice.wait("user.found")).payload.user?.userId === bob.userId);

// Поиск по части тега не должен давать ничего: иначе можно обойти весь сервер.
alice.received = alice.received.filter((m) => m.type !== "user.found");
alice.send("user.search", { query: bob.username.slice(0, 3) });
check("поиск по части тега ничего не даёт", (await alice.wait("user.found")).payload.user === null);

alice.received = alice.received.filter((m) => m.type !== "user.found");
alice.send("user.search", { query: alice.username });
check("себя поиск не находит", (await alice.wait("user.found")).payload.user === null);

// ── 5. Добавление контакта — связь взаимная ─────────────────────────────────
alice.send("contact.add", { userId: bob.userId });
const added = await alice.wait("contact.added");
check("добавивший получает карточку", added.payload.user.userId === bob.userId);

const bobGotAlice = await bob.wait("contact.added");
check("добавленный тоже получает карточку — связь взаимная", bobGotAlice.payload.user.userId === alice.userId);
check("и в ней есть ключ для шифрования ответа", bobGotAlice.payload.user.encryptionPublicKey === alice.encryption.publicKey);

alice.send("contact.add", { userId: alice.userId });
check("себя добавить нельзя", (await alice.wait("error", (m) => m.payload.code === "CANNOT_ADD_SELF")).payload.code === "CANNOT_ADD_SELF");

// ── 6. Переписка между контактами ──────────────────────────────────────────
const chatId = dmChatId(alice.userId, bob.userId);
const text = "Привет из аккаунтов 🔐";
const box = crypto.boxEncrypt(text, bobGotAlice.payload.user.userId === alice.userId ? bob.encryption.publicKey : bob.encryption.publicKey, alice.encryption.secretKey);
const clientMsgId = randomUUID();
alice.send("msg.send", { clientMsgId, chatId, contentType: "text", ciphertext: box.ciphertext, nonce: box.nonce, replyTo: null });
check("сообщение принято", Boolean(await alice.wait("msg.accepted", (m) => m.payload.clientMsgId === clientMsgId)));
const delivered = await bob.wait("msg.deliver", (m) => m.payload.msgId === clientMsgId);
check(
  "получатель расшифровал сообщение",
  crypto.boxOpen(
    { ciphertext: delivered.payload.ciphertext, nonce: delivered.payload.nonce },
    alice.encryption.publicKey,
    bob.encryption.secretKey,
  ) === text,
);

// ── 7. Присутствие приходит только контактам ───────────────────────────────
const stranger = new Client("Посторонний");
await stranger.open();
await stranger.register("stranger");
await stranger.wait("roster.snapshot");

alice.received = alice.received.filter((m) => m.type !== "presence");
bob.received = bob.received.filter((m) => m.type !== "presence");
stranger.ws.close();
await new Promise((r) => setTimeout(r, 500));
check(
  "уход постороннего из сети никому не рассылается",
  alice.received.filter((m) => m.type === "presence").length === 0,
);

// А уход контакта — рассылается.
bob.ws.close();
const bobLeft = await alice.wait("presence", (m) => m.payload.userId === bob.userId && m.payload.online === false);
check("уход контакта из сети приходит", Boolean(bobLeft));

// ── 8. Вход с нового устройства по почте и паролю ──────────────────────────
const bobPhone2 = new Client("Боб");
bobPhone2.encryption = crypto.generateEncryptionKeyPair();
bobPhone2.identity = crypto.generateIdentityKeyPair();
await bobPhone2.open();
bobPhone2.send("auth.login", { email: bob.email, password: bob.password, ...bobPhone2.keys() });
const logged = await bobPhone2.wait("auth.login.ok");
check("вход по почте с нового устройства", logged.payload.userId === bob.userId);
check("тег сохранился", logged.payload.username === bob.username, String(logged.payload.username));

const roster2 = await bobPhone2.wait("roster.snapshot");
check(
  "после входа контакты на месте",
  roster2.payload.members.some((m) => m.userId === alice.userId),
  JSON.stringify(roster2.payload.members.map((m) => m.displayName)),
);
check("в контакте есть @тег", roster2.payload.members.find((m) => m.userId === alice.userId)?.username === alice.username);

bobPhone2.received = [];
bobPhone2.send("auth.login", { email: bob.email, password: "неверный-пароль", ...bobPhone2.keys() });
// Соединение уже аутентифицировано, поэтому повторный логин — неизвестный тип.
check("повторный вход в том же соединении не проходит", Boolean(await bobPhone2.wait("error")));

const wrong = new Client("Неверный");
await wrong.open();
wrong.send("auth.login", { email: bob.email, password: "совсем-не-тот-пароль", ...wrong.keys() });
check("неверный пароль отклонён", (await wrong.wait("auth.login.error")).payload.code === "BAD_CREDENTIALS");

wrong.received = [];
wrong.send("auth.login", { email: `никого_${RUN}@example.com`, password: "любой-длинный-пароль", ...wrong.keys() });
check(
  "неизвестная почта даёт тот же ответ, что неверный пароль",
  (await wrong.wait("auth.login.error")).payload.code === "BAD_CREDENTIALS",
);
wrong.ws.close();

// ── 9. Смена @тега ─────────────────────────────────────────────────────────
alice.send("username.set", { username: `alice_new_${RUN}` });
check("тег меняется", (await alice.wait("username.ok")).payload.username === `alice_new_${RUN}`);

alice.received = alice.received.filter((m) => m.type !== "error");
alice.send("username.set", { username: bob.username });
check("занятый тег не занять", (await alice.wait("error", (m) => m.payload.code === "USERNAME_TAKEN")).payload.code === "USERNAME_TAKEN");

alice.received = alice.received.filter((m) => m.type !== "user.found");
alice.send("user.search", { query: `alice_new_${RUN}` });
check("старый тег больше не находит", (await alice.wait("user.found")).payload.user === null, "себя поиск не находит — проверка ниже");

bobPhone2.received = bobPhone2.received.filter((m) => m.type !== "user.found");
bobPhone2.send("user.search", { query: `alice_new_${RUN}` });
check("по новому тегу человек находится", (await bobPhone2.wait("user.found")).payload.user?.userId === alice.userId);

bobPhone2.received = bobPhone2.received.filter((m) => m.type !== "user.found");
bobPhone2.send("user.search", { query: alice.username });
check("по прежнему тегу больше никого нет", (await bobPhone2.wait("user.found")).payload.user === null);

// ── 10. Резервная копия переписки ──────────────────────────────────────────
//
// Проверяем ровно то, за что отвечает сервер: он хранит блоб как есть, отдаёт
// его только владельцу и не даёт превысить предел. Сама криптография копии
// проверяется в packages/crypto (там же, где остальные примитивы), но блоб
// здесь настоящий: если бы формат ломался при проходе через сервер (например
// на длине или на кодировке), это осталось бы незамеченным.
//
// Argon2id есть только в sumo-сборке libsodium — в обычной crypto_pwhash нет.
const sodiumSumo = require_("libsodium-wrappers-sumo");
await sodiumSumo.ready;
const cryptoSumo = createCrypto(sodiumSumo);

const PASSPHRASE = "четыре несвязанных слова подряд";
const history = JSON.stringify({ v: 1, createdAt: Date.now(), messages: [{ text: "привет, копия" }], contacts: [] });
const blob = JSON.stringify(cryptoSumo.encryptBackup(history, PASSPHRASE));

alice.received = alice.received.filter((m) => m.type !== "backup.ok");
alice.send("backup.put", { blob });
const put = await alice.wait("backup.ok");
check("копия принята сервером", put.payload.sizeBytes === Buffer.byteLength(blob, "utf-8"), String(put.payload.sizeBytes));

alice.received = alice.received.filter((m) => m.type !== "backup.info.ok");
alice.send("backup.info", {});
const info = await alice.wait("backup.info.ok");
check("сведения о копии без выгрузки блоба", info.payload.updatedAt > 0 && info.payload.sizeBytes > 0);

alice.received = alice.received.filter((m) => m.type !== "backup.blob");
alice.send("backup.get", {});
const got = await alice.wait("backup.blob");
check("копия вернулась байт в байт", got.payload.blob === blob);
check(
  "и расшифровалась своей фразой",
  cryptoSumo.decryptBackup(JSON.parse(got.payload.blob), PASSPHRASE) === history,
);
check(
  "чужой фразой не расшифровалась",
  cryptoSumo.decryptBackup(JSON.parse(got.payload.blob), "совершенно другая длинная фраза") === null,
);

// Копия — личная: у Боба своя, и она не может оказаться алисиной.
bobPhone2.received = bobPhone2.received.filter((m) => m.type !== "backup.blob");
bobPhone2.send("backup.get", {});
check("чужую копию не отдают", (await bobPhone2.wait("backup.blob")).payload.blob === null);

// Предел размера: без него один участник забил бы диск сервера, и сообщения
// перестали бы ходить у всех.
alice.received = alice.received.filter((m) => m.type !== "error");
alice.send("backup.put", { blob: "x".repeat(8 * 1024 * 1024 + 1) });
check("слишком большая копия отклонена", (await alice.wait("error", (m) => m.payload.code === "TOO_LARGE")).payload.code === "TOO_LARGE");

alice.received = alice.received.filter((m) => m.type !== "error");
alice.send("backup.put", { blob: "" });
check("пустая копия отклонена", (await alice.wait("error", (m) => m.payload.code === "EMPTY")).payload.code === "EMPTY");

// Отказ не должен затирать уже лежащую копию: иначе неудачная попытка сохранить
// новую версию оставляла бы человека вообще без копии.
alice.received = alice.received.filter((m) => m.type !== "backup.blob");
alice.send("backup.get", {});
check("прежняя копия цела после отказов", (await alice.wait("backup.blob")).payload.blob === blob);

alice.received = alice.received.filter((m) => m.type !== "backup.ok");
alice.send("backup.delete", {});
await alice.wait("backup.ok");
alice.received = alice.received.filter((m) => m.type !== "backup.info.ok");
alice.send("backup.info", {});
check("после удаления копии нет", (await alice.wait("backup.info.ok")).payload.updatedAt === null);

alice.ws.close();
bobPhone2.ws.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nИтог: ${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length === 0 ? 0 : 1);
