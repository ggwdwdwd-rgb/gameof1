import qrcodeTerminal from "qrcode-terminal";
import { runMigrations } from "../db/migrate.js";
import { db } from "../db/index.js";
import { createInvite } from "../invites.js";

runMigrations();

function parseTtlHours(): number | undefined {
  const arg = process.argv.find((a) => a.startsWith("--ttl="));
  if (!arg) return undefined;
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

const { code, expiresAt, ttlHours, qrPayload } = createInvite(earliestUserId(), parseTtlHours());

console.log("");
console.log(`Инвайт-код:   ${code}`);
console.log(`Действителен: ${ttlHours} ч. (до ${new Date(expiresAt).toLocaleString("ru-RU")})`);
console.log(`QR-содержимое: ${qrPayload}`);
console.log("");
qrcodeTerminal.generate(qrPayload, { small: true }, (qr) => console.log(qr));
console.log("Покажи QR или продиктуй код новому участнику. Код одноразовый.");
console.log("");
