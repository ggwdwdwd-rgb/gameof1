/** dm:<userA>:<userB> — id участников отсортированы, чтобы обе стороны получили один и тот же chatId. */
export function dmChatId(userIdA: string, userIdB: string): string {
  const [a, b] = [userIdA, userIdB].sort();
  return `dm:${a}:${b}`;
}

/** userId собеседника в личном чате. */
export function otherUserIdInDm(chatId: string, myUserId: string): string | null {
  if (!chatId.startsWith("dm:")) return null;
  const parts = chatId.split(":");
  if (parts.length !== 3) return null;
  return parts[1] === myUserId ? (parts[2] ?? null) : (parts[1] ?? null);
}
