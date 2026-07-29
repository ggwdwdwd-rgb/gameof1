import "dotenv/config";

function requireNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Переменная окружения ${name} должна быть числом, получено: "${raw}"`);
  }
  return n;
}

export const env = {
  port: requireNumber("PORT", 8080),
  dbPath: process.env.DB_PATH ?? "./data/server.db",
  messageTtlDays: requireNumber("MESSAGE_TTL_DAYS", 14),
  defaultInviteTtlHours: requireNumber("DEFAULT_INVITE_TTL_HOURS", 24),
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;
