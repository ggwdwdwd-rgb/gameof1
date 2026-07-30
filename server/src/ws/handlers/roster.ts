import { db } from "../../db/index.js";

export interface RosterMember {
  userId: string;
  deviceId: string;
  displayName: string;
  identityPublicKey: string;
  encryptionPublicKey: string;
  joinedAt: number;
}

interface RosterRow {
  user_id: string;
  device_id: string;
  display_name: string;
  identity_public_key: string;
  encryption_public_key: string;
  joined_at: number;
}

/**
 * Полный список активных (не отозванных) участников семьи, кроме самого
 * запросившего устройства. Нужен клиенту, который переподключился и мог
 * пропустить member.joined, разосланный, пока он был офлайн (см. ARCHITECTURE.md §4.8).
 */
export function getRosterExcluding(deviceId: string): RosterMember[] {
  const rows = db
    .prepare(
      `SELECT u.id AS user_id, d.id AS device_id, u.display_name, d.identity_public_key,
              d.encryption_public_key, d.created_at AS joined_at
       FROM devices d
       JOIN users u ON u.id = d.user_id
       WHERE d.revoked_at IS NULL AND d.id != ?
       ORDER BY d.created_at ASC`,
    )
    .all(deviceId) as RosterRow[];

  return rows.map((r) => ({
    userId: r.user_id,
    deviceId: r.device_id,
    displayName: r.display_name,
    identityPublicKey: r.identity_public_key,
    encryptionPublicKey: r.encryption_public_key,
    joinedAt: r.joined_at,
  }));
}
