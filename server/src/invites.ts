import { db } from "./db/index.js";
import { env } from "./env.js";
import { generateInviteCode } from "./util/inviteCode.js";

export interface CreatedInvite {
  code: string;
  qrPayload: string;
  expiresAt: number;
  ttlHours: number;
}

/**
 * Единственное место, где выпускаются инвайты — используется и CLI
 * (npm run invite:create), и приложением через WS-пакет invite.create.
 *
 * createdByUserId = null допустим: самый первый код выпускается, когда в
 * системе ещё нет ни одного пользователя.
 */
export function createInvite(createdByUserId: string | null, ttlHoursInput?: number): CreatedInvite {
  const ttlHours = ttlHoursInput && ttlHoursInput > 0 ? ttlHoursInput : env.defaultInviteTtlHours;
  const now = Date.now();
  const expiresAt = now + ttlHours * 60 * 60 * 1000;

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateInviteCode();
    // Коллизия почти невозможна, но код обязан быть уникальным (PRIMARY KEY).
    if (db.prepare("SELECT 1 FROM invites WHERE code = ?").get(code)) continue;
    db.prepare("INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
      code,
      createdByUserId,
      now,
      expiresAt,
    );
    return { code, qrPayload: `familymsg://invite/${code}`, expiresAt, ttlHours };
  }
  throw new Error("Не удалось сгенерировать уникальный код за 10 попыток");
}
