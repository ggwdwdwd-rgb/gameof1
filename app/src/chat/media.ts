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

/**
 * Расширение по mime-типу. Без него Android не понимает, что за файл: и
 * сохранение фото в галерею, и воспроизведение голосового, и «поделиться»
 * молча не работали, потому что входящие файлы лежали под именем msgId вообще
 * без расширения.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

export function extensionFor(mimeType: string, fileName?: string): string {
  const known = EXTENSION_BY_MIME[mimeType.toLowerCase()];
  if (known) return known;
  // У произвольного файла берём расширение из его имени.
  const fromName = fileName?.match(/\.([a-zA-Z0-9]{1,8})$/);
  if (fromName) return fromName[1]!.toLowerCase();
  return "bin";
}

/** Имя файла в хранилище: стабильный идентификатор плюс расширение по типу. */
export function localFileName(stableName: string, mimeType: string, fileName?: string): string {
  return `${stableName}.${extensionFor(mimeType, fileName)}`;
}

/** Метка времени для имени файла в галерее: 2026-07-31_18-40-12. */
function galleryStamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

/**
 * Копия файла в кэше под именем, пригодным для галереи.
 *
 * Зачем копия: MediaLibrary берёт имя и тип создаваемого снимка из имени
 * исходного файла. У нас файлы называются по msgId — в «Фото» появлялись бы
 * строки вида 7f3c9e2a…, а у полученных до появления extensionFor файлов
 * расширения нет вообще, и Android не понимает, что это картинка.
 */
export function prepareForGallery(localUri: string, mimeType?: string): File {
  const source = new File(localUri);
  // Расширение самого файла надёжнее mime-типа: файл уже лежит на диске,
  // а mimeType в это место может и не дойти.
  const own = source.extension.replace(/^\./, "").toLowerCase();
  const extension = own !== "" ? own : extensionFor(mimeType ?? "image/jpeg");
  const dest = new File(Paths.cache, `Cry_${galleryStamp(new Date())}.${extension}`);
  if (dest.exists) dest.delete();
  source.copySync(dest);
  return dest;
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
  const dest = new File(mediaDirectory(), localFileName(stableName, envelope.mimeType, envelope.fileName));
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
