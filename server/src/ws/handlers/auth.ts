import { db } from "../../db/index.js";
import { verifyChallengeSignature } from "../../crypto/verify.js";

interface DeviceRow {
  id: string;
  user_id: string;
  identity_public_key: string;
  revoked_at: number | null;
}

export type AuthResult =
  | { ok: true; userId: string; deviceId: string }
  | { ok: false; code: "UNKNOWN_DEVICE" | "BAD_SIGNATURE" | "REVOKED" };

export async function handleAuthResponse(
  deviceId: string,
  signatureB64: string,
  nonceB64: string,
): Promise<AuthResult> {
  const device = db
    .prepare("SELECT id, user_id, identity_public_key, revoked_at FROM devices WHERE id = ?")
    .get(deviceId) as DeviceRow | undefined;

  if (!device) return { ok: false, code: "UNKNOWN_DEVICE" };
  if (device.revoked_at !== null) return { ok: false, code: "REVOKED" };

  const valid = await verifyChallengeSignature(device.identity_public_key, nonceB64, signatureB64);
  if (!valid) return { ok: false, code: "BAD_SIGNATURE" };

  return { ok: true, userId: device.user_id, deviceId: device.id };
}
