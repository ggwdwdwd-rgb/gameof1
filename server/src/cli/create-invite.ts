import qrcodeTerminal from "qrcode-terminal";
import { runMigrations } from "../db/migrate.js";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { generateInviteCode } from "../util/inviteCode.js";

runMigrations();

function parseTtlHours(): number {
  const arg = process.argv.find((a) => a.startsWith("--ttl="));
  if (!arg) return env.defaultInviteTtlHours;
  const value = Number(arg.split("=")[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("--ttl должен быть положительным числом часов");
  }
  return value;
}

function earliestUserId(): string | null {
  const row = db.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get() as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

function insertUniqueInvite(ttlHours: number, createdBy: string | null): { code: string; expiresAt: number } {
  const now = Date.now();
  const expiresAt = now + ttlHours * 60 * 60 * 1000;

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateInviteCode();
    const existing = db.prepare("SELECT 1 FROM invites WHERE code = ?").get(code);
    if (existing) continue; // почти невозможно, но код должен быть точно уникален
    db.prepare(
      "INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(code, createdBy, now, expiresAt);
    return { code, expiresAt };
  }
  throw new Error("Не удалось сгенерировать уникальный код за 10 попыток");
}

const ttlHours = parseTtlHours();
const createdBy = earliestUserId();
const { code, expiresAt } = insertUniqueInvite(ttlHours, createdBy);
const qrPayload = `familymsg://invite/${code}`;

console.log("");
console.log(`Инвайт-код:   ${code}`);
console.log(`Действителен: ${ttlHours} ч. (до ${new Date(expiresAt).toLocaleString("ru-RU")})`);
console.log(`QR-содержимое: ${qrPayload}`);
console.log("");
qrcodeTerminal.generate(qrPayload, { small: true }, (qr) => console.log(qr));
console.log("Покажи QR или продиктуй код новому участнику. Код одноразовый.");
console.log("");
