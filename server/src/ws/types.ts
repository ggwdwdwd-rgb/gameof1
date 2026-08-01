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
  limit?: number;
}

export interface MsgDeletePayload {
  msgId: string;
  chatId: string;
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
