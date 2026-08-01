import { db } from "./db/index.js";

export interface UserSummary {
  id: string;
  displayName: string;
  createdAt: number;
  devices: number;
  messages: number;
}

export interface RemovedUserStats {
  receipts: number;
  messages: number;
  keys: number;
  invites: number;
  devices: number;
}

/**
 * Кто «первый» — тот и распоряжается составом.
 *
 * Отдельной роли админа в базе нет и не нужно: система создаётся одним
 * человеком, который поднял сервер и выпустил первый код. Он же
 * зарегистрировался раньше всех, поэтому «самый ранний участник» — это
 * естественный и не требующий отдельной таблицы признак. Тот же приём уже
 * используется при выпуске инвайтов из CLI.
 */
export function adminUserId(): string | null {
  const row = db.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  return row?.id ?? null;
}

export function isAdmin(userId: string): boolean {
  return adminUserId() === userId;
}

export function listUsers(): UserSummary[] {
  return (
    db
      .prepare(
        `SELECT u.id, u.display_name, u.created_at,
                (SELECT COUNT(*) FROM devices d  WHERE d.user_id = u.id)      AS devices,
                (SELECT COUNT(*) FROM messages m WHERE m.from_user_id = u.id) AS messages
         FROM users u ORDER BY u.created_at ASC`,
      )
      .all() as { id: string; display_name: string; created_at: number; devices: number; messages: number }[]
  ).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    devices: row.devices,
    messages: row.messages,
  }));
}

export function userExists(userId: string): boolean {
  return db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId) !== undefined;
}

/** deviceId участника — нужны, чтобы разорвать его соединения после удаления. */
export function deviceIdsOf(userId: string): string[] {
  return (db.prepare("SELECT id FROM devices WHERE user_id = ?").all(userId) as { id: string }[]).map((d) => d.id);
}

/**
 * Полное удаление участника. Одно место и для CLI, и для WS-пакета
 * member.remove: два независимых удаления рано или поздно разошлись бы, а
 * оставленная ссылка на удалённого участника роняет запросы на foreign key.
 *
 * Одной транзакцией и в порядке зависимостей (foreign_keys = ON), иначе база
 * осталась бы в половинчатом состоянии.
 */
export const removeUser = db.transaction((userId: string): RemovedUserStats => {
  const receipts = db
    .prepare(
      "DELETE FROM message_receipts WHERE user_id = ? OR msg_id IN (SELECT id FROM messages WHERE from_user_id = ?)",
    )
    .run(userId, userId).changes;
  const messages = db.prepare("DELETE FROM messages WHERE from_user_id = ?").run(userId).changes;
  const keys = db.prepare("DELETE FROM group_key_versions WHERE created_by = ?").run(userId).changes;
  // Коды одноразовые, хранить их историю смысла нет.
  const invites = db.prepare("DELETE FROM invites WHERE created_by = ? OR used_by = ?").run(userId, userId).changes;
  const devices = db.prepare("DELETE FROM devices WHERE user_id = ?").run(userId).changes;
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  return { receipts, messages, keys, invites, devices };
});
