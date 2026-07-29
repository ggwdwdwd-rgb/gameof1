// Типы пакетов протокола (см. ARCHITECTURE.md, раздел 4).
// Этап 1 реализует: auth.challenge/response/ok/error, invite.redeem(.ok/.error),
// member.joined, ping/pong и generic-эхо остальных типов после аутентификации.

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

export interface InviteRedeemPayload {
  code: string;
  deviceId: string;
  displayName: string;
  identityPublicKey: string; // base64, Ed25519
  encryptionPublicKey: string; // base64, X25519
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
