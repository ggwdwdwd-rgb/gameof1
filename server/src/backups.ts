import { db } from "./db/index.js";

/**
 * Хранилище резервных копий переписки.
 *
 * Для сервера копия — непрозрачный блоб: она зашифрована кодовой фразой, которая
 * никуда не отправляется (см. packages/crypto/src/backup.ts). Сервер её не
 * читает, не разбирает и прочитать не может — тот же принцип, что с сообщениями.
 *
 * Одна копия на участника: история версий не нужна, а место на VPS конечно.
 */

/**
 * Предел размера копии.
 *
 * Восемь мегабайт — это очень много текста (переписка на десятки тысяч
 * сообщений) и заведомо мало для того, чтобы кто-то устроил из бэкапов
 * файлохранилище. Без предела один участник мог бы забить диск сервера, и
 * перестали бы работать сообщения у всех.
 *
 * Медиа в копию не попадает намеренно — только текст и метаданные, см. клиент.
 */
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

export interface BackupInfo {
  sizeBytes: number;
  updatedAt: number;
}

export type PutBackupResult = { ok: true; info: BackupInfo } | { ok: false; code: "TOO_LARGE" | "EMPTY" };

export function putBackup(userId: string, blob: string): PutBackupResult {
  if (blob.length === 0) return { ok: false, code: "EMPTY" };
  // Байты, а не символы: в UTF-8 кириллица занимает по два, и предел в символах
  // означал бы вдвое больший расход диска, чем ожидается.
  const sizeBytes = Buffer.byteLength(blob, "utf-8");
  if (sizeBytes > MAX_BACKUP_BYTES) return { ok: false, code: "TOO_LARGE" };

  const now = Date.now();
  db.prepare(
    `INSERT INTO backups (user_id, blob, size_bytes, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       blob = excluded.blob,
       size_bytes = excluded.size_bytes,
       updated_at = excluded.updated_at`,
  ).run(userId, blob, sizeBytes, now);

  return { ok: true, info: { sizeBytes, updatedAt: now } };
}

/** null — копии нет. */
export function getBackup(userId: string): { blob: string; info: BackupInfo } | null {
  const row = db
    .prepare("SELECT blob, size_bytes, updated_at FROM backups WHERE user_id = ?")
    .get(userId) as { blob: string; size_bytes: number; updated_at: number } | undefined;
  if (!row) return null;
  return { blob: row.blob, info: { sizeBytes: row.size_bytes, updatedAt: row.updated_at } };
}

/** Сведения без самого блоба — чтобы показать «последняя копия: …» без её выгрузки. */
export function backupInfo(userId: string): BackupInfo | null {
  const row = db
    .prepare("SELECT size_bytes, updated_at FROM backups WHERE user_id = ?")
    .get(userId) as { size_bytes: number; updated_at: number } | undefined;
  return row ? { sizeBytes: row.size_bytes, updatedAt: row.updated_at } : null;
}

export function deleteBackup(userId: string): boolean {
  return db.prepare("DELETE FROM backups WHERE user_id = ?").run(userId).changes > 0;
}
