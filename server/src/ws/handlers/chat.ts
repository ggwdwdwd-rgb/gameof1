import { db } from "../../db/index.js";

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

/** dm:<userA>:<userB> — id участников отсортированы лексикографически, см. ARCHITECTURE.md. */
function parseDmChatId(chatId: string): [string, string] | null {
  const parts = chatId.split(":");
  if (parts.length !== 3 || parts[0] !== "dm") return null;
  return [parts[1]!, parts[2]!];
}

// Групповых чатов в системе нет: только личные диалоги 1:1 (chatId вида dm:a:b).
export function isParticipant(chatId: string, userId: string): boolean {
  const dm = parseDmChatId(chatId);
  return dm !== null && dm.includes(userId);
}

/** userId получателей (без отправителя) для данного чата. */
export function recipientUserIds(chatId: string, fromUserId: string): string[] {
  const dm = parseDmChatId(chatId);
  if (!dm || !dm.includes(fromUserId)) return [];
  return dm.filter((id) => id !== fromUserId);
}

/** Активные deviceId получателей — на кого реально разослать WS-пакет (MVP: 0-1 устройство на человека). */
export function recipientDeviceIds(chatId: string, fromUserId: string): string[] {
  const userIds = recipientUserIds(chatId, fromUserId);
  return activeDeviceRows(userIds).map((d) => d.id);
}
