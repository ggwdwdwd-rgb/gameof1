import { db } from "./db/index.js";

export interface UserSummary {
  id: string;
  displayName: string;
  createdAt: number;
  isAdmin: boolean;
  devices: number;
  messages: number;
}

export interface RemovedUserStats {
  /** Сколько связей в списках контактов пришлось убрать (в обе стороны). */
  contacts: number;
  receipts: number;
  messages: number;
  keys: number;
  invites: number;
  devices: number;
}

/**
 * Право распоряжаться составом — явный признак в базе (users.is_admin).
 *
 * Сначала он был неявным: админом считался первый зарегистрированный. Это
 * ломалось на самой частой операции — удалении своего же старого аккаунта после
 * переустановки приложения: права молча уходили к следующему по времени, то есть
 * к другому человеку, и вернуть их было нечем. Теперь признак назначается и
 * снимается командой (npm run set-admin), а не вычисляется из порядка.
 */
export function isAdmin(userId: string): boolean {
  const row = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as { is_admin: number } | undefined;
  if (row === undefined) return false;
  if (row.is_admin === 1) return true;
  // Страховка: если признака нет ни у кого (например, единственного админа
  // удалили из базы руками), возвращаемся к прежнему правилу — иначе система
  // осталась бы вообще без управления.
  return adminCount() === 0 && earliestUserId() === userId;
}

export function adminCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1").get() as { n: number };
  return row.n;
}

export function earliestUserId(): string | null {
  const row = db.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  return row?.id ?? null;
}

/** Назначение и снятие права. Возвращает false, если участника нет. */
export function setAdmin(userId: string, value: boolean): boolean {
  const result = db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(value ? 1 : 0, userId);
  return result.changes > 0;
}

/**
 * Первый участник в пустой системе становится главным автоматически.
 *
 * Вызывается при регистрации по инвайту: иначе в новой установке главного не
 * было бы вовсе, и назначить его можно было бы только из базы руками.
 */
export function grantAdminIfNobodyHasIt(userId: string): void {
  if (adminCount() === 0) setAdmin(userId, true);
}

export function listUsers(): UserSummary[] {
  return (
    db
      .prepare(
        `SELECT u.id, u.display_name, u.created_at, u.is_admin,
                (SELECT COUNT(*) FROM devices d  WHERE d.user_id = u.id)      AS devices,
                (SELECT COUNT(*) FROM messages m WHERE m.from_user_id = u.id) AS messages
         FROM users u ORDER BY u.created_at ASC`,
      )
      .all() as {
      id: string;
      display_name: string;
      created_at: number;
      is_admin: number;
      devices: number;
      messages: number;
    }[]
  ).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    isAdmin: row.is_admin === 1,
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
 * Оставит ли удаление этого участника систему без главного.
 *
 * Проверяется до удаления: система без управления — это тупик, из которого
 * выходят только правкой базы руками.
 */
export function wouldLeaveNoAdmin(userId: string): boolean {
  const row = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as { is_admin: number } | undefined;
  return row?.is_admin === 1 && adminCount() <= 1;
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
  // Связи в обе стороны: и его контакты, и он в чужих списках. Без этого
  // удаление падало с FOREIGN KEY constraint failed — внешние ключи в базе
  // включены, а таблица contacts появилась позже этой функции.
  const contacts = db
    .prepare("DELETE FROM contacts WHERE owner_id = ? OR contact_id = ?")
    .run(userId, userId).changes;
  // Резервная копия тоже ссылается на users — без её удаления транзакция падала
  // бы на внешнем ключе, как это уже было с контактами.
  db.prepare("DELETE FROM backups WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  return { receipts, messages, keys, invites, devices, contacts };
});
