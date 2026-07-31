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
}

export interface AuthErrorPayload {
  code: "UNKNOWN_DEVICE" | "BAD_SIGNATURE" | "REVOKED";
}

export interface InviteRedeemOkPayload {
  userId: string;
}

export interface InviteRedeemErrorPayload {
  code: "NOT_FOUND" | "EXPIRED" | "USED";
}

export interface RosterMemberPayload {
  userId: string;
  deviceId: string;
  displayName: string;
  /** Есть ли у участника открытое соединение прямо сейчас. */
  online?: boolean;
  /** Когда он был на связи последний раз. */
  lastSeenAt?: number | null;
  identityPublicKey: string;
  encryptionPublicKey: string;
  joinedAt: number;
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

/** Сервер рассылает всем, когда участник сменил имя. */
export interface MemberUpdatedPayload {
  userId: string;
  displayName: string;
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
