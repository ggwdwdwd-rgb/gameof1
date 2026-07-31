import { db } from "../../db/index.js";

const MAX_NAME_LENGTH = 40;

/**
 * Меняет отображаемое имя участника.
 *
 * Возвращает сохранённое имя (уже обрезанное по краям) либо null, если имя не
 * годится. Имя — единственное, что сервер знает о человеке в открытом виде:
 * оно нужно, чтобы остальные видели, от кого сообщение, до расшифровки.
 */
export function updateDisplayName(userId: string, rawName: string): string | null {
  const displayName = typeof rawName === "string" ? rawName.trim() : "";
  if (displayName.length === 0 || displayName.length > MAX_NAME_LENGTH) return null;

  const result = db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, userId);
  if (result.changes === 0) return null;
  return displayName;
}
