import { db } from "../../db/index.js";

export const GROUP_CHAT_ID = "group:family";

interface DeviceRow {
  id: string;
  user_id: string;
}

function activeDeviceRows(userIds: string[]): DeviceRow[] {
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => "?").join(",");
  return db
    .prepare(`SELECT id, user_id FROM devices WHERE revoked_at IS NULL AND user_id IN (${placeholders})`)
    .all(...userIds) as DeviceRow[];
}

function allActiveUserIds(excludingUserId: string): string[] {
  const rows = db.prepare("SELECT DISTINCT user_id FROM devices WHERE revoked_at IS NULL").all() as {
    user_id: string;
  }[];
  return rows.map((r) => r.user_id).filter((id) => id !== excludingUserId);
}

/** dm:<userA>:<userB> — id участников отсортированы лексикографически, см. ARCHITECTURE.md. */
function parseDmChatId(chatId: string): [string, string] | null {
  const parts = chatId.split(":");
  if (parts.length !== 3 || parts[0] !== "dm") return null;
  return [parts[1]!, parts[2]!];
}

export function isParticipant(chatId: string, userId: string): boolean {
  if (chatId === GROUP_CHAT_ID) return true;
  const dm = parseDmChatId(chatId);
  return dm !== null && (dm[0] === userId || dm[1] === userId);
}

/** userId получателей (без отправителя) для данного чата. */
export function recipientUserIds(chatId: string, fromUserId: string): string[] {
  if (chatId === GROUP_CHAT_ID) return allActiveUserIds(fromUserId);
  const dm = parseDmChatId(chatId);
  if (!dm || !dm.includes(fromUserId)) return [];
  return dm.filter((id) => id !== fromUserId);
}

/** Активные deviceId получателей — на кого реально разослать WS-пакет (MVP: 0-1 устройство на человека). */
export function recipientDeviceIds(chatId: string, fromUserId: string): string[] {
  const userIds = recipientUserIds(chatId, fromUserId);
  return activeDeviceRows(userIds).map((d) => d.id);
}
