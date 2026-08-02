import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import { grantAdminIfNobodyHasIt } from "../../users.js";
import type { InviteRedeemPayload } from "../types.js";

interface InviteRow {
  code: string;
  expires_at: number;
  used_at: number | null;
}

export type InviteRedeemResult =
  | { ok: true; userId: string }
  | { ok: false; code: "NOT_FOUND" | "EXPIRED" | "USED" };

export function handleInviteRedeem(payload: InviteRedeemPayload): InviteRedeemResult {
  const invite = db
    .prepare("SELECT code, expires_at, used_at FROM invites WHERE code = ?")
    .get(payload.code) as InviteRow | undefined;

  if (!invite) return { ok: false, code: "NOT_FOUND" };
  if (invite.used_at !== null) return { ok: false, code: "USED" };
  if (invite.expires_at < Date.now()) return { ok: false, code: "EXPIRED" };

  const userId = randomUUID();
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)").run(
      userId,
      payload.displayName,
      now,
    );
    db.prepare(
      `INSERT INTO devices (id, user_id, identity_public_key, encryption_public_key, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(payload.deviceId, userId, payload.identityPublicKey, payload.encryptionPublicKey, now);
    db.prepare("UPDATE invites SET used_at = ?, used_by = ? WHERE code = ?").run(now, userId, payload.code);
  });
  tx();

  // Самый первый участник в пустой системе становится главным: иначе назначить
  // его было бы нечем, кроме правки базы руками.
  grantAdminIfNobodyHasIt(userId);

  return { ok: true, userId };
}
