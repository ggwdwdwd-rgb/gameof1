// Типы пакетов протокола — см. ARCHITECTURE.md, раздел 4 (и server/src/ws/types.ts,
// это тот же протокол, независимо продублированный на клиенте: делить один
// .ts-файл между Node-сервером и React Native приложением здесь не стоит того).

export interface Envelope<T = unknown> {
  v: 1;
  type: string;
  id: string;
  ts: number;
  payload: T;
}

export interface AuthChallengePayload {
  nonce: string;
}

export interface AuthOkPayload {
  userId: string;
  deviceId: string;
  serverTime: number;
  /**
   * Можно ли распоряжаться составом участников. Считает сервер (первый
   * зарегистрированный), клиент только показывает или скрывает кнопку —
   * проверка всё равно повторяется при самом удалении. Может отсутствовать:
   * старый сервер этого поля не присылал.
   */
  isAdmin?: boolean;
}

export interface AuthErrorPayload {
  code: "UNKNOWN_DEVICE" | "BAD_SIGNATURE" | "REVOKED";
}

export interface InviteRedeemOkPayload {
  userId: string;
  isAdmin?: boolean;
}

export interface InviteRedeemErrorPayload {
  code: "NOT_FOUND" | "EXPIRED" | "USED";
}

/** Ответ на регистрацию и на вход по почте: карточка своего аккаунта. */
export interface AccountOkPayload {
  userId: string;
  username: string | null;
  displayName: string;
  isAdmin?: boolean;
  serverTime?: number;
}

/** Отказ в регистрации или входе. message приходит от сервера готовым. */
export interface AccountErrorPayload {
  code: string;
  message: string;
}

/** Результат поиска: ровно один человек либо ничего. */
export interface UserFoundPayload {
  user: {
    userId: string;
    displayName: string;
    username: string | null;
    identityPublicKey: string;
    encryptionPublicKey: string;
  } | null;
}

/** Контакт добавлен — приходит и добавившему, и добавленному: связь взаимная. */
export interface ContactAddedPayload {
  user: {
    userId: string;
    displayName: string;
    username: string | null;
    identityPublicKey: string;
    encryptionPublicKey: string;
  };
  online?: boolean;
}

export interface UsernameOkPayload {
  username: string | null;
}

/** Почта и пароль привязаны к уже существующему участнику. */
export interface AccountClaimOkPayload {
  email: string | null;
  username: string | null;
  phone: string | null;
}

export interface RosterMemberPayload {
  userId: string;
  deviceId: string;
  displayName: string;
  /** @тег: по нему человека находят. null — аккаунт заведён до появления тегов. */
  username?: string | null;
  /** Есть ли у участника открытое соединение прямо сейчас. */
  online?: boolean;
  /** Когда он был на связи последний раз. */
  lastSeenAt?: number | null;
  identityPublicKey: string;
  encryptionPublicKey: string;
  joinedAt: number;
  /**
   * Доступ устройства отозван (потерянный телефон). Контакт и переписку клиент
   * сохраняет: отзыв обратим, а прежние сообщения расшифровываются его ключами.
   * Может отсутствовать: старый сервер этого поля не присылал.
   */
  revoked?: boolean;
}

export interface RosterSnapshotPayload {
  members: RosterMemberPayload[];
}

export interface MemberJoinedPayload extends RosterMemberPayload {}

export interface MsgSendPayload {
  clientMsgId: string;
  chatId: string;
  contentType: string;
  ciphertext: string;
  nonce: string;
  replyTo: string | null;
  ttlSec?: number;
}

export interface InviteCreatedPayload {
  code: string;
  qrPayload: string;
  expiresAt: number;
  ttlHours: number;
}

export interface MsgAcceptedPayload {
  clientMsgId: string;
  msgId: string;
  /** Нужен, чтобы обновить только тот экран, которого касается сообщение. */
  chatId: string;
  /**
   * Время, присвоенное сервером. Может отсутствовать: старый сервер его не
   * присылал, и тогда остаётся местное время отправителя.
   */
  ts?: number;
}

export interface MsgDeliverPayload {
  msgId: string;
  chatId: string;
  fromUserId: string;
  fromDeviceId: string;
  contentType: string;
  ciphertext: string;
  nonce: string;
  replyTo: string | null;
  ts: number;
  ttlExpiresAt: number;
}

export interface MsgAckPayload {
  msgId: string;
  chatId: string;
  status: "delivered" | "read";
}

export interface MsgAckRelayPayload {
  msgId: string;
  chatId: string;
  byUserId: string;
  status: "delivered" | "read";
  ts: number;
}

export interface ProfileUpdatePayload {
  displayName: string;
}

/** Сервер рассылает, когда участник появился в сети или ушёл из неё. */
export interface PresencePayload {
  userId: string;
  online: boolean;
  lastSeenAt: number | null;
}

/** Сервер рассылает контактам, когда участник сменил имя или @тег. */
export interface MemberUpdatedPayload {
  userId: string;
  displayName: string;
  username?: string | null;
}

/** Участника удалили из системы — его чат и переписку нужно убрать локально. */
export interface MemberRemovedPayload {
  userId: string;
}

/**
 * Доступ устройства отозван или возвращён.
 *
 * В отличие от member.removed переписку не трогаем: отзыв обратим, и старые
 * сообщения этого устройства расшифровываются его же ключами.
 */
export interface MemberRevokedPayload {
  userId: string;
  deviceId: string;
  revoked: boolean;
}

export interface TypingPayload {
  chatId: string;
  isTyping: boolean;
}

export interface TypingRelayPayload {
  chatId: string;
  fromUserId: string;
  isTyping: boolean;
}

export interface HistoryFetchPayload {
  chatId: string;
  sinceTs: number;
  limit?: number;
}

export interface HistoryPagePayload {
  chatId: string;
  messages: MsgDeliverPayload[];
  nextCursor: string | null;
}

export interface MsgDeletePayload {
  msgId: string;
  chatId: string;
}

export interface MsgDeletedPayload {
  msgId: string;
  chatId: string;
  byUserId: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
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
