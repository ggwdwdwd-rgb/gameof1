import { db } from "../../db/index.js";
import { isUserOnline } from "../registry.js";

export interface RosterMember {
  userId: string;
  deviceId: string;
  displayName: string;
  identityPublicKey: string;
  encryptionPublicKey: string;
  joinedAt: number;
  /** Есть ли у участника прямо сейчас открытое соединение. */
  online: boolean;
  /** Когда он был на связи последний раз; null — ни разу с момента появления поля. */
  lastSeenAt: number | null;
  /** Доступ устройства отозван: писать ему нельзя, но контакт и переписку клиент сохраняет. */
  revoked: boolean;
}

interface RosterRow {
  user_id: string;
  device_id: string;
  display_name: string;
  last_seen_at: number | null;
  identity_public_key: string;
  encryption_public_key: string;
  joined_at: number;
  revoked_at: number | null;
}

/**
 * Полный список участников семьи, кроме самого запросившего устройства. Нужен
 * клиенту, который переподключился и мог пропустить member.joined, разосланный,
 * пока он был офлайн (см. ARCHITECTURE.md §4.8).
 *
 * Отозванные устройства тоже попадают в список — с признаком revoked. Раньше
 * они отсюда исключались, и это стало опасным, когда клиент начал удалять
 * контакты, отсутствующие в roster: отзыв одного устройства стирал переписку с
 * этим человеком у всех остальных. Ключи отозванного устройства к тому же нужны,
 * чтобы расшифровывать его прежние сообщения.
 */
export function getRosterExcluding(deviceId: string): RosterMember[] {
  const rows = db
    .prepare(
      `SELECT u.id AS user_id, d.id AS device_id, u.display_name, u.last_seen_at,
              d.identity_public_key, d.encryption_public_key, d.created_at AS joined_at, d.revoked_at
       FROM devices d
       JOIN users u ON u.id = d.user_id
       WHERE d.id != ?
       -- Действующее устройство идёт последним: клиент хранит один контакт на
       -- участника, и побеждает запись, пришедшая позже.
       ORDER BY (d.revoked_at IS NULL) ASC, d.created_at ASC`,
    )
    .all(deviceId) as RosterRow[];

  return rows.map((r) => ({
    userId: r.user_id,
    deviceId: r.device_id,
    displayName: r.display_name,
    identityPublicKey: r.identity_public_key,
    encryptionPublicKey: r.encryption_public_key,
    joinedAt: r.joined_at,
    // «В сети сейчас» берём из реестра соединений, а не из базы: флаг в базе
    // соврал бы после перезапуска процесса.
    online: isUserOnline(r.user_id),
    lastSeenAt: r.last_seen_at,
    revoked: r.revoked_at !== null,
  }));
}

/** Отметка «был на связи»: ставится при подключении и при отключении. */
export function touchLastSeen(userId: string): number {
  const now = Date.now();
  db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now, userId);
  return now;
}
