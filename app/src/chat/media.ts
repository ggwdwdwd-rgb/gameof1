import { Directory, File, Paths } from "expo-file-system";

/**
 * Медиа (фото/голос/файл) шифруются и передаются как обычный текстовый
 * контент — JSON-конверт с base64 данными внутри, зашифрованный тем же
 * crypto.encryptWithKey(string), что и текст (см. ARCHITECTURE.md §4.6 —
 * тот же приём уже используется для раздачи группового ключа).
 */
export interface MediaEnvelope {
  mimeType: string;
  dataBase64: string;
  fileName?: string;
  sizeBytes?: number;
  durationMs?: number;
  width?: number;
  height?: number;
}

/** То, что реально хранится в messages.plaintext локально — без самих байт, только ссылка на файл в песочнице приложения. */
export interface LocalMediaMeta {
  localUri: string;
  mimeType: string;
  fileName?: string;
  sizeBytes?: number;
  durationMs?: number;
  width?: number;
  height?: number;
}

function mediaDirectory(): Directory {
  const dir = new Directory(Paths.document, "media");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Копирует выбранный/записанный файл в постоянное хранилище приложения (кэш пикера/рекордера не гарантированно переживает перезапуск). */
export function persistLocalFile(sourceUri: string, stableName: string): string {
  const source = new File(sourceUri);
  const dest = new File(mediaDirectory(), stableName);
  if (dest.exists) dest.delete();
  source.copySync(dest);
  return dest.uri;
}

export function buildEnvelopeFromLocalFile(localUri: string, meta: Omit<LocalMediaMeta, "localUri">): string {
  const file = new File(localUri);
  const envelope: MediaEnvelope = { ...meta, dataBase64: file.base64Sync() };
  return JSON.stringify(envelope);
}

/** Разбирает пришедший конверт, пишет данные в постоянный файл и возвращает метаданные для локальной БД (без самих байт). */
export function saveIncomingEnvelope(envelopeJson: string, stableName: string): LocalMediaMeta {
  const envelope = JSON.parse(envelopeJson) as MediaEnvelope;
  const dest = new File(mediaDirectory(), stableName);
  if (dest.exists) dest.delete();
  dest.create({ intermediates: true });
  dest.write(envelope.dataBase64, { encoding: "base64" });
  return {
    localUri: dest.uri,
    mimeType: envelope.mimeType,
    fileName: envelope.fileName,
    sizeBytes: envelope.sizeBytes,
    durationMs: envelope.durationMs,
    width: envelope.width,
    height: envelope.height,
  };
}

export function parseLocalMediaMeta(plaintext: string | null): LocalMediaMeta | null {
  if (!plaintext) return null;
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as LocalMediaMeta).localUri === "string") {
      return parsed as LocalMediaMeta;
    }
    return null;
  } catch {
    return null;
  }
}

export function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
