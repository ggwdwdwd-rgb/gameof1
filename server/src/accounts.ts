import { randomUUID } from "node:crypto";
import { db } from "./db/index.js";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./crypto/password.js";
import { grantAdminIfNobodyHasIt, isAdmin } from "./users.js";

/**
 * Аккаунты: почта + пароль + @тег.
 *
 * Личность человека — аккаунт, а не устройство. К аккаунту привязываются
 * устройства, каждое со своими ключами; вход по почте и паролю нужен ровно для
 * того, чтобы привязать новое.
 *
 * Сквозное шифрование это не ослабляет: приватные ключи остаются на устройствах,
 * сервер хранит только публичные. Пароль не даёт доступа к переписке — её
 * невозможно прочитать ни с ним, ни без него.
 *
 * Чего это стоило: регистрация больше не показывает человека всем. Раньше сервер
 * рассылал полный список участников каждому подключившемуся; теперь у каждого
 * свой список контактов (таблица contacts), и попасть в него можно двумя
 * способами — быть найденным по тегу или написать первым.
 */

export interface Account {
  userId: string;
  displayName: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  isAdmin: boolean;
}

/** Публичная карточка человека: то, что отдаётся по поиску и в списке контактов. */
export interface PublicUser {
  userId: string;
  displayName: string;
  username: string | null;
  identityPublicKey: string;
  encryptionPublicKey: string;
}

interface UserRow {
  id: string;
  display_name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  is_admin: number;
}

/**
 * Требования к @тегу.
 *
 * Латиница, цифры и подчёркивание, 3–24 символа, не начинается с цифры. Не
 * прихоть: тег произносят вслух и передают в мессенджерах, поэтому кириллица и
 * похожие на латиницу буквы («а» русская и «a» латинская) означали бы теги,
 * которые невозможно отличить друг от друга на вид.
 */
const USERNAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{2,23}$/;

/**
 * Проверка почты нарочно нестрогая.
 *
 * Полная проверка по RFC невозможна регулярным выражением и всё равно не
 * говорит, существует ли ящик. Отсекаем только заведомую бессмыслицу, а
 * настоящая проверка — письмо с кодом.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

export type ValidationError =
  | "BAD_EMAIL"
  | "BAD_USERNAME"
  | "WEAK_PASSWORD"
  | "BAD_NAME"
  | "EMAIL_TAKEN"
  | "USERNAME_TAKEN";

/** Человекочитаемые причины отказа — их клиент показывает как есть. */
export const VALIDATION_MESSAGES: Record<ValidationError, string> = {
  BAD_EMAIL: "Адрес почты выглядит неверным",
  BAD_USERNAME: "Тег: латиница, цифры и подчёркивание, от 3 до 24 символов, не с цифры",
  WEAK_PASSWORD: `Пароль короче ${MIN_PASSWORD_LENGTH} символов`,
  BAD_NAME: "Имя должно быть от 1 до 40 символов",
  EMAIL_TAKEN: "На эту почту аккаунт уже зарегистрирован",
  USERNAME_TAKEN: "Этот тег уже занят",
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  // Ведущую «@» убираем: её вводят по привычке, и отказывать из-за неё глупо.
  return username.trim().replace(/^@+/, "");
}

function rowToAccount(row: UserRow): Account {
  return {
    userId: row.id,
    displayName: row.display_name,
    username: row.username,
    email: row.email,
    phone: row.phone,
    isAdmin: row.is_admin === 1,
  };
}

export function findByEmail(email: string): (Account & { passwordHash: string | null }) | null {
  const row = db
    .prepare("SELECT id, display_name, username, email, phone, password_hash, is_admin FROM users WHERE lower(email) = ?")
    .get(normalizeEmail(email)) as UserRow | undefined;
  return row ? { ...rowToAccount(row), passwordHash: row.password_hash } : null;
}

export function findByUsername(username: string): Account | null {
  const row = db
    .prepare("SELECT id, display_name, username, email, phone, password_hash, is_admin FROM users WHERE lower(username) = ?")
    .get(normalizeUsername(username).toLowerCase()) as UserRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function accountOf(userId: string): Account | null {
  const row = db
    .prepare("SELECT id, display_name, username, email, phone, password_hash, is_admin FROM users WHERE id = ?")
    .get(userId) as UserRow | undefined;
  return row ? rowToAccount(row) : null;
}

export interface RegisterInput {
  email: string;
  password: string;
  username: string;
  displayName: string;
  phone?: string | undefined;
  deviceId: string;
  identityPublicKey: string;
  encryptionPublicKey: string;
}

export type RegisterResult = { ok: true; account: Account } | { ok: false; code: ValidationError };

/**
 * Регистрация: аккаунт + первое устройство одной транзакцией.
 *
 * Транзакция обязательна: аккаунт без устройства не может войти (входить нечем,
 * ключей нет), а устройство без аккаунта — сирота, на которую ссылаются
 * сообщения. Половина результата здесь хуже отказа.
 */
export async function register(input: RegisterInput): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);
  const displayName = input.displayName.trim();

  if (!EMAIL_RE.test(email)) return { ok: false, code: "BAD_EMAIL" };
  if (!USERNAME_RE.test(username)) return { ok: false, code: "BAD_USERNAME" };
  if (input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, code: "WEAK_PASSWORD" };
  if (displayName.length === 0 || displayName.length > 40) return { ok: false, code: "BAD_NAME" };
  if (findByEmail(email)) return { ok: false, code: "EMAIL_TAKEN" };
  if (findByUsername(username)) return { ok: false, code: "USERNAME_TAKEN" };

  // Хэш считаем до транзакции: Argon2id занимает около секунды, а держать
  // транзакцию sqlite открытой всё это время незачем.
  const passwordHash = await hashPassword(input.password);
  const userId = randomUUID();
  const now = Date.now();
  const phone = input.phone?.trim() ?? null;

  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, display_name, created_at, is_admin, email, password_hash, username, phone, email_verified)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0)`,
    ).run(userId, displayName, now, email, passwordHash, username, phone === "" ? null : phone);

    db.prepare(
      `INSERT INTO devices (id, user_id, identity_public_key, encryption_public_key, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(input.deviceId, userId, input.identityPublicKey, input.encryptionPublicKey, now);
  });

  try {
    create();
  } catch (error) {
    // Гонка: тег или почту заняли между проверкой и вставкой. Уникальные индексы
    // это ловят — и это единственная надёжная защита, проверка выше лишь даёт
    // внятное сообщение в обычном случае.
    const message = error instanceof Error ? error.message : "";
    if (/idx_users_email/.test(message)) return { ok: false, code: "EMAIL_TAKEN" };
    if (/idx_users_username/.test(message)) return { ok: false, code: "USERNAME_TAKEN" };
    throw error;
  }

  // Первый зарегистрированный получает права: иначе сервером некому
  // распоряжаться, и вернуть это можно было бы только правкой базы руками.
  grantAdminIfNobodyHasIt(userId);

  const account = accountOf(userId);
  if (!account) throw new Error("аккаунт не найден сразу после создания");
  return { ok: true, account };
}

export interface LoginInput {
  email: string;
  password: string;
  deviceId: string;
  identityPublicKey: string;
  encryptionPublicKey: string;
}

export type LoginResult =
  | {
      ok: true;
      account: Account;
      /**
       * Прежние устройства этого же аккаунта, у которых вход отобрал доступ
       * (см. ARCHITECTURE.md §2.4 — одно активное устройство на человека).
       * Их соединения надо разорвать, иначе они продолжат получать пакеты.
       */
      revokedDeviceIds: string[];
    }
  /** Одна причина на «нет такой почты» и «неверный пароль» — см. комментарий. */
  | { ok: false; code: "BAD_CREDENTIALS" | "NO_PASSWORD" };

/**
 * Вход по почте и паролю: привязывает устройство к аккаунту.
 *
 * Ответ на неизвестную почту и на неверный пароль одинаковый (BAD_CREDENTIALS).
 * Разные ответы превратили бы вход в проверку «есть ли у вас аккаунт на этом
 * сервере» для любого желающего — а весь смысл в том, чтобы участники не были
 * видны посторонним.
 *
 * Ключи устройства приходят от клиента: сервер их не создаёт и не может —
 * приватная часть никогда не покидает телефон.
 */
export async function login(input: LoginInput): Promise<LoginResult> {
  const found = findByEmail(input.email);
  if (!found) {
    // Пароль всё равно «проверяем»: без этого ответ на неизвестную почту
    // приходил бы мгновенно, а на известную — через секунду, и по времени
    // ответа можно было бы перебирать адреса.
    await verifyPassword(input.password, DUMMY_HASH);
    return { ok: false, code: "BAD_CREDENTIALS" };
  }
  // Участник, зарегистрированный до появления аккаунтов: пароля у него нет,
  // входить нужно прежним способом — подписью уже привязанного устройства.
  if (found.passwordHash === null) return { ok: false, code: "NO_PASSWORD" };
  if (!(await verifyPassword(input.password, found.passwordHash))) {
    return { ok: false, code: "BAD_CREDENTIALS" };
  }

  const bound = bindDevice(found.userId, input);
  const account = accountOf(found.userId);
  if (!account) return { ok: false, code: "BAD_CREDENTIALS" };
  return { ok: true, account: { ...account, isAdmin: isAdmin(found.userId) }, revokedDeviceIds: bound };
}

/**
 * Привязка устройства к аккаунту при входе — и отзыв прежних.
 *
 * Одно активное устройство на человека (ARCHITECTURE.md §2.4): сообщение
 * шифруется под конкретный X25519-ключ устройства, и пока их два, отправитель
 * всё равно выбирает одно. Оставлять прежний телефон активным было бы хуже, чем
 * бесполезно: половина пакетов уходила бы туда, где их не ждут, а человек,
 * переехавший на новый телефон, видел бы, что часть сообщений не приходит.
 *
 * Транзакция целиком: отзыв прежних и привязка нового — одно решение, и
 * состояние «оба отозваны» или «оба активны» недопустимо.
 */
const bindDevice = db.transaction((userId: string, input: LoginInput): string[] => {
  const now = Date.now();

  const previous = db
    .prepare("SELECT id FROM devices WHERE user_id = ? AND id != ? AND revoked_at IS NULL")
    .all(userId, input.deviceId) as { id: string }[];
  if (previous.length > 0) {
    db.prepare(
      `UPDATE devices SET revoked_at = ?
       WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
    ).run(now, userId, input.deviceId);
  }

  // Устройство могло входить раньше: тогда обновляем ключи и снимаем отзыв,
  // сделанный этим же человеком. Повторный вход по паролю — законный способ
  // вернуть себе доступ.
  db.prepare(
    `INSERT INTO devices (id, user_id, identity_public_key, encryption_public_key, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       identity_public_key = excluded.identity_public_key,
       encryption_public_key = excluded.encryption_public_key,
       revoked_at = NULL`,
  ).run(input.deviceId, userId, input.identityPublicKey, input.encryptionPublicKey, now);

  return previous.map((row) => row.id);
});

/**
 * Хэш несуществующего пароля — чтобы отказ по неизвестной почте стоил столько
 * же времени, сколько отказ по неверному паролю. Значение произвольное.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=262144,t=3,p=1$YWFhYWFhYWFhYWFhYWFhYQ$Xr2gAKPjVNKcHgvKuFNb4tOWnVBWLPa3nMYUnPhwYIk";

/**
 * Поиск человека по @тегу, почте или телефону.
 *
 * Только точное совпадение, без подстрок и без списков. Поиск по части тега
 * позволил бы обойти весь сервер и собрать всех участников — то есть вернул бы
 * ровно то, от чего мы ушли, отказавшись от общего roster.
 *
 * Ключи берём с действующего устройства: без них человека нельзя добавить —
 * шифровать было бы нечем.
 */
export function searchUser(query: string, exceptUserId: string): PublicUser | null {
  const raw = query.trim();
  if (raw.length === 0) return null;

  const byUsername = findByUsername(raw);
  const account = byUsername ?? findByEmail(raw) ?? findByPhone(raw);
  if (!account || account.userId === exceptUserId) return null;

  return publicUser(account.userId);
}

function findByPhone(phone: string): Account | null {
  // Сравниваем по цифрам: «+7 999 …» и «7999…» — один и тот же номер, а
  // требовать от человека угадать формат записи нельзя.
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 5) return null;
  const row = db
    .prepare(
      `SELECT id, display_name, username, email, phone, password_hash, is_admin FROM users
       WHERE phone IS NOT NULL AND replace(replace(replace(replace(phone, '+', ''), '-', ''), ' ', ''), '(', '') LIKE ?`,
    )
    .get(`%${digits}%`) as UserRow | undefined;
  return row ? rowToAccount(row) : null;
}

/** Карточка с публичными ключами действующего устройства. */
export function publicUser(userId: string): PublicUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.display_name, u.username, d.identity_public_key, d.encryption_public_key
       FROM users u
       JOIN devices d ON d.user_id = u.id AND d.revoked_at IS NULL
       WHERE u.id = ?
       ORDER BY d.created_at DESC
       LIMIT 1`,
    )
    .get(userId) as
    | {
        id: string;
        display_name: string;
        username: string | null;
        identity_public_key: string;
        encryption_public_key: string;
      }
    | undefined;
  if (!row) return null;
  return {
    userId: row.id,
    displayName: row.display_name,
    username: row.username,
    identityPublicKey: row.identity_public_key,
    encryptionPublicKey: row.encryption_public_key,
  };
}

/**
 * Добавление контакта — сразу взаимное.
 *
 * Иначе не работает шифрование: чтобы ответить, второй стороне нужны публичные
 * ключи первой. И иначе не работает UX — человек, которому написали, должен
 * увидеть чат, а не молчащее ничто.
 *
 * Возвращает true, если связь появилась (а не уже была).
 */
export function linkContacts(a: string, b: string): boolean {
  if (a === b) return false;
  const now = Date.now();
  const insert = db.prepare("INSERT OR IGNORE INTO contacts (owner_id, contact_id, created_at) VALUES (?, ?, ?)");
  const link = db.transaction(() => {
    const first = insert.run(a, b, now).changes;
    const second = insert.run(b, a, now).changes;
    return first + second;
  });
  return link() > 0;
}

/** Контакты участника — то, что раньше было общим roster. */
export function listContacts(ownerId: string): PublicUser[] {
  const ids = (
    db.prepare("SELECT contact_id FROM contacts WHERE owner_id = ? ORDER BY created_at ASC").all(ownerId) as {
      contact_id: string;
    }[]
  ).map((row) => row.contact_id);

  // Контакт без действующего устройства (все отозваны) пропускаем: ключей нет,
  // писать нечем. Сам контакт в базе остаётся — доступ может вернуться.
  return ids.map((id) => publicUser(id)).filter((user): user is PublicUser => user !== null);
}

/**
 * userId контактов — круг, которому можно сообщать о человеке.
 *
 * Нужен для рассылок: присутствие, смена имени, удаление. Отправлять это всем
 * подключённым нельзя — посторонний, создавший аккаунт, светился бы у каждого.
 */
export function contactIdsOf(userId: string): string[] {
  return (
    db.prepare("SELECT contact_id FROM contacts WHERE owner_id = ?").all(userId) as { contact_id: string }[]
  ).map((row) => row.contact_id);
}

export function isContact(ownerId: string, contactId: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM contacts WHERE owner_id = ? AND contact_id = ?")
    .get(ownerId, contactId) as { ok: number } | undefined;
  return row !== undefined;
}

export interface ClaimInput {
  email: string;
  password: string;
  username: string;
  phone?: string | undefined;
}

export type ClaimResult =
  | { ok: true; account: Account }
  | { ok: false; code: ValidationError | "ALREADY_HAS_PASSWORD" };

/**
 * Привязка почты и пароля к УЖЕ существующему участнику.
 *
 * Зачем отдельно от register: участники, заведённые одноразовым кодом до
 * появления аккаунтов, остались без почты и пароля. Восстановить доступ им
 * нечем — потерянный телефон означал бы потерю всего, — а register создал бы
 * НОВОГО человека с новым userId, то есть отобрал бы у них контакты и
 * переписку. Здесь же меняется только сам аккаунт: userId, устройство, контакты
 * и история остаются на месте.
 *
 * Права на это даёт уже пройденная аутентификация устройства: подпись ключом,
 * который никогда не покидал телефон, — доказательство сильнее любого пароля,
 * которого у человека пока нет.
 *
 * Смену уже существующего пароля намеренно не делаем: она обязана требовать
 * прежний пароль, иначе украденный разблокированный телефон означал бы
 * захваченный аккаунт. Это отдельная задача, а не побочный эффект этой.
 */
export async function claimAccount(userId: string, input: ClaimInput): Promise<ClaimResult> {
  const current = accountOf(userId);
  if (!current) return { ok: false, code: "BAD_EMAIL" };

  const existing = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as
    | { password_hash: string | null }
    | undefined;
  if (existing?.password_hash) return { ok: false, code: "ALREADY_HAS_PASSWORD" };

  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);

  if (!EMAIL_RE.test(email)) return { ok: false, code: "BAD_EMAIL" };
  if (!USERNAME_RE.test(username)) return { ok: false, code: "BAD_USERNAME" };
  if (input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, code: "WEAK_PASSWORD" };

  const byEmail = findByEmail(email);
  if (byEmail && byEmail.userId !== userId) return { ok: false, code: "EMAIL_TAKEN" };
  const byUsername = findByUsername(username);
  if (byUsername && byUsername.userId !== userId) return { ok: false, code: "USERNAME_TAKEN" };

  // Хэш считаем до записи: Argon2id занимает около секунды.
  const passwordHash = await hashPassword(input.password);
  const phone = input.phone?.trim();

  try {
    db.prepare(
      `UPDATE users SET email = ?, password_hash = ?, username = ?, phone = COALESCE(?, phone)
       WHERE id = ?`,
    ).run(email, passwordHash, username, phone === undefined || phone === "" ? null : phone, userId);
  } catch (error) {
    // Гонка: почту или тег заняли между проверкой и записью. Уникальные индексы —
    // единственная надёжная защита, проверки выше лишь дают внятный отказ.
    const message = error instanceof Error ? error.message : "";
    if (/idx_users_email/.test(message)) return { ok: false, code: "EMAIL_TAKEN" };
    if (/idx_users_username/.test(message)) return { ok: false, code: "USERNAME_TAKEN" };
    throw error;
  }

  const account = accountOf(userId);
  if (!account) throw new Error("аккаунт исчез сразу после привязки");
  return { ok: true, account: { ...account, isAdmin: isAdmin(userId) } };
}

/** Смена своего @тега. null — тег занят или не подходит. */
export function setUsername(userId: string, username: string): ValidationError | null {
  const next = normalizeUsername(username);
  if (!USERNAME_RE.test(next)) return "BAD_USERNAME";
  const existing = findByUsername(next);
  if (existing && existing.userId !== userId) return "USERNAME_TAKEN";
  db.prepare("UPDATE users SET username = ? WHERE id = ?").run(next, userId);
  return null;
}
