import { db } from "./db/index.js";

export interface DeviceSummary {
  id: string;
  userId: string;
  displayName: string;
  createdAt: number;
  revokedAt: number | null;
}

/**
 * Отзыв доступа устройства.
 *
 * Зачем отдельно от удаления участника: телефон потерян или украден, доступ
 * нужно закрыть сейчас, а переписку и самого человека сохранить. Удаление
 * участника уносит его сообщения у всех и превращает его в нового человека при
 * возвращении; отзыв устройства — обратимая мера.
 *
 * Чего отзыв не даёт: вернуться прежним устройством уже нельзя даже после
 * снятия отзыва, если ключи с телефона пропали — они хранятся только на нём.
 * Человек в этом случае регистрируется новым кодом и становится новым
 * участником.
 */
export function listDevices(): DeviceSummary[] {
  return (
    db
      .prepare(
        `SELECT d.id, d.user_id, u.display_name, d.created_at, d.revoked_at
         FROM devices d JOIN users u ON u.id = d.user_id
         ORDER BY d.created_at ASC`,
      )
      .all() as {
      id: string;
      user_id: string;
      display_name: string;
      created_at: number;
      revoked_at: number | null;
    }[]
  ).map((row) => ({
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }));
}

export function findDevice(deviceId: string): DeviceSummary | undefined {
  return listDevices().find((device) => device.id === deviceId);
}

/** Возвращает true, если состояние действительно изменилось. */
export function setDeviceRevoked(deviceId: string, revoked: boolean): boolean {
  const result = db
    .prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND (revoked_at IS NULL) = ?")
    .run(revoked ? Date.now() : null, deviceId, revoked ? 1 : 0);
  return result.changes > 0;
}

/** Активные устройства участника — чтобы не отобрать у себя последний доступ. */
export function activeDeviceCount(userId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM devices WHERE user_id = ? AND revoked_at IS NULL")
    .get(userId) as { n: number };
  return row.n;
}
