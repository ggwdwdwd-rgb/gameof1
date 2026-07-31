import type { Presence } from "../context/AppContext";

/**
 * Подпись под именем собеседника: «в сети» либо когда он был последний раз.
 * Пустая строка — когда не знаем ничего (например, сами не подключены).
 */
export function describePresence(presence: Presence | undefined): string {
  if (!presence) return "";
  if (presence.online) return "в сети";
  if (presence.lastSeenAt === null) return "";

  const seen = new Date(presence.lastSeenAt);
  const now = new Date();
  const minutesAgo = Math.floor((now.getTime() - seen.getTime()) / 60_000);

  if (minutesAgo < 1) return "был(а) только что";
  if (minutesAgo < 60) return `был(а) ${minutesAgo} мин назад`;

  const time = `${String(seen.getHours()).padStart(2, "0")}:${String(seen.getMinutes()).padStart(2, "0")}`;
  const sameDay =
    seen.getDate() === now.getDate() && seen.getMonth() === now.getMonth() && seen.getFullYear() === now.getFullYear();
  if (sameDay) return `был(а) в ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    seen.getDate() === yesterday.getDate() &&
    seen.getMonth() === yesterday.getMonth() &&
    seen.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return `был(а) вчера в ${time}`;

  return `был(а) ${seen.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "")}`;
}
