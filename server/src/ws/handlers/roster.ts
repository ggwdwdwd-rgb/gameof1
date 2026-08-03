import { db } from "../../db/index.js";
import { isUserOnline } from "../registry.js";

export interface RosterMember {
  userId: string;
  deviceId: string;
  displayName: string;
  /** @тег: по нему человека находят. null — аккаунт заведён до появления тегов. */
  username: string | null;
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
  username: string | null;
  last_seen_at: number | null;
  identity_public_key: string;
  encryption_public_key: string;
  joined_at: number;
  revoked_at: number | null;
}

/**
 * Список контактов участника — то, что клиент получает при подключении.
 *
 * Раньше это был roster «все участники сервера»: каждый подключившийся получал
 * полный список всех, кто когда-либо зарегистрировался. С аккаунтами и свободной
 * регистрацией так нельзя — незнакомый человек, создавший аккаунт, оказался бы в
 * списке у всех. Теперь список берётся из таблицы contacts: он свой у каждого, и
 * попасть в него можно только двумя способами — быть найденным по тегу или
 * написать первым.
 *
 * Отозванные устройства из списка не исключаются — приходят с признаком revoked.
 * Клиент удаляет контакты, которых в списке нет, вместе с перепиской, поэтому
 * скрытие отозванных стирало бы переписку у всех остальных. Их публичные ключи к
 * тому же нужны, чтобы расшифровывать прежние сообщения.
 *
 * `exceptDeviceId` — устройство, которое спрашивает: свои собственные записи
 * человеку не нужны.
 */
export function getContactsFor(userId: string, exceptDeviceId: string): RosterMember[] {
  const rows = db
    .prepare(
      `SELECT u.id AS user_id, d.id AS device_id, u.display_name, u.username, u.last_seen_at,
              d.identity_public_key, d.encryption_public_key, d.created_at AS joined_at, d.revoked_at
       FROM contacts c
       JOIN users u ON u.id = c.contact_id
       JOIN devices d ON d.user_id = u.id
       WHERE c.owner_id = ? AND d.id != ?
       -- Действующее устройство идёт последним: клиент хранит один контакт на
       -- участника, и побеждает запись, пришедшая позже.
       ORDER BY (d.revoked_at IS NULL) ASC, d.created_at ASC`,
    )
    .all(userId, exceptDeviceId) as RosterRow[];

  return rows.map((r) => ({
    userId: r.user_id,
    deviceId: r.device_id,
    displayName: r.display_name,
    username: r.username,
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
