// Типы пакетов протокола (см. ARCHITECTURE.md, раздел 4).

export interface Envelope<T = unknown> {
  v: 1;
  type: string;
  id: string;
  ts: number;
  payload: T;
}

export interface AuthResponsePayload {
  deviceId: string;
  signature: string; // base64
}

export interface InviteCreatePayload {
  ttlHours?: number;
}

/**
 * Регистрация аккаунта. Заменяет вход по одноразовому коду как основной путь.
 *
 * Ключи присылает клиент: сервер их не создаёт и не может — приватная часть
 * никогда не покидает телефон.
 */
export interface AuthRegisterPayload {
  email: string;
  password: string;
  username: string;
  displayName: string;
  phone?: string;
  deviceId: string;
  identityPublicKey: string; // base64, Ed25519
  encryptionPublicKey: string; // base64, X25519
}

/** Вход по почте и паролю: привязывает это устройство к существующему аккаунту. */
export interface AuthLoginPayload {
  email: string;
  password: string;
  deviceId: string;
  identityPublicKey: string;
  encryptionPublicKey: string;
}

/** Поиск человека по @тегу, почте или телефону — только точное совпадение. */
export interface UserSearchPayload {
  query: string;
}

/** Добавление найденного человека в контакты (связь сразу взаимная). */
export interface ContactAddPayload {
  userId: string;
}

/** Смена своего @тега. */
export interface UsernameSetPayload {
  username: string;
}

export interface InviteRedeemPayload {
  code: string;
  deviceId: string;
  displayName: string;
  identityPublicKey: string; // base64, Ed25519
  encryptionPublicKey: string; // base64, X25519
}

export interface MsgSendPayload {
  clientMsgId: string;
  chatId: string;
  contentType: string;
  ciphertext: string; // base64
  nonce: string; // base64
  replyTo: string | null;
  ttlSec?: number;
  /** Версия group_keys, которым зашифровано — только для chatId === group:family, см. ARCHITECTURE.md §4.6. */
  keyVersion?: number;
}

export interface MsgAckPayload {
  msgId: string;
  chatId: string;
  status: "delivered" | "read";
}

/** Сервер рассылает, когда участник появился в сети или ушёл из неё. */
export interface PresencePayload {
  userId: string;
  online: boolean;
  lastSeenAt: number | null;
}

export interface ProfileUpdatePayload {
  displayName: string;
}

export interface TypingPayload {
  chatId: string;
  isTyping: boolean;
}

export interface HistoryFetchPayload {
  chatId: string;
  sinceTs: number;
  /**
   * id последнего уже полученного сообщения — вторая половина курсора.
   *
   * Одного времени недостаточно: сообщения, отправленные пачкой, попадают в одну
   * миллисекунду, и если такая пара разрывается границей страницы, условие
   * `created_at > sinceTs` теряет остаток. На стресс-тесте из 212 сообщений так
   * пропадало одно — молча, без единой ошибки. С парой (время, id) порядок
   * строгий и пропустить нечего.
   *
   * Может отсутствовать: старый клиент его не присылает, тогда работает прежнее
   * сравнение только по времени.
   */
  sinceId?: string;
  limit?: number;
}

export interface MsgDeletePayload {
  msgId: string;
  chatId: string;
}

/**
 * Клиент сообщает, смотрит ли человек на телефон.
 *
 * До работы в фоне «в сети» = «есть соединение», и этого хватало: свёрнутое
 * приложение Android быстро выгружал, соединение рвалось. Со службой переднего
 * плана соединение живёт всегда, и открытый сокет перестал что-либо говорить о
 * человеке — он показывался в сети с погашенным экраном в кармане.
 */
export interface PresenceSetPayload {
  active: boolean;
}

/**
 * Отзыв и возврат доступа устройства. Разрешено только главному участнику.
 *
 * Отдельно от удаления участника: потерянный телефон нужно отключить сейчас, а
 * переписку и человека сохранить. Мера обратимая.
 */
export interface DeviceRevokePayload {
  deviceId: string;
  revoked: boolean;
}

/**
 * Загрузка резервной копии переписки.
 *
 * blob — зашифрованный кодовой фразой JSON. Сервер его не разбирает и прочитать
 * не может: фраза никуда не отправляется.
 */
export interface BackupPutPayload {
  blob: string;
}

/** Удаление участника из системы. Разрешено только первому зарегистрированному. */
export interface MemberRemovePayload {
  userId: string;
}

export function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.type === "string" &&
    typeof v.id === "string" &&
    typeof v.ts === "number" &&
    typeof v.payload === "object" &&
    v.payload !== null
  );
}
