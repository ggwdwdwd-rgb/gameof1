import * as DocumentPicker from "expo-document-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { buildEnvelopeFromLocalFile, persistLocalFile, type LocalMediaMeta } from "./media";
import { withSystemPicker } from "../lock/systemPicker";
import { uuidv4 } from "../util/uuid";

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export interface PreparedMedia {
  localMeta: LocalMediaMeta;
  envelopeJson: string;
}

/** Фото из галереи со сжатием перед отправкой (см. жёсткие требования проекта). */
export async function pickAndCompressImage(): Promise<PreparedMedia | null> {
  // withSystemPicker — чтобы блокировка приложения не считала уход в системное
  // окно уходом человека и не спрашивала PIN после каждой отправки фото.
  const picked = await withSystemPicker(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return null;
    return ImagePicker.launchImageLibraryAsync({ quality: 0.9 });
  });
  if (picked === null || picked.canceled || !picked.assets[0]) return null;

  const manipulated = await ImageManipulator.manipulateAsync(
    picked.assets[0].uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG },
  );

  const localUri = persistLocalFile(manipulated.uri, `${uuidv4()}.jpg`);
  const localMeta: LocalMediaMeta = { localUri, mimeType: "image/jpeg", width: manipulated.width, height: manipulated.height };
  const envelopeJson = buildEnvelopeFromLocalFile(localUri, {
    mimeType: localMeta.mimeType,
    width: localMeta.width,
    height: localMeta.height,
  });
  return { localMeta, envelopeJson };
}

/** Произвольный файл до 25 МБ (см. жёсткие требования проекта). */
export async function pickFile(): Promise<PreparedMedia | { error: "TOO_LARGE" } | null> {
  const picked = await withSystemPicker(() => DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true }));
  if (picked.canceled || !picked.assets[0]) return null;

  const asset = picked.assets[0];
  if ((asset.size ?? 0) > MAX_FILE_SIZE_BYTES) return { error: "TOO_LARGE" };

  const extension = asset.name.includes(".") ? asset.name.slice(asset.name.lastIndexOf(".")) : "";
  const localUri = persistLocalFile(asset.uri, `${uuidv4()}${extension}`);
  const mimeType = asset.mimeType ?? "application/octet-stream";
  const localMeta: LocalMediaMeta = { localUri, mimeType, fileName: asset.name, sizeBytes: asset.size };
  const envelopeJson = buildEnvelopeFromLocalFile(localUri, {
    mimeType,
    fileName: asset.name,
    sizeBytes: asset.size,
  });
  return { localMeta, envelopeJson };
}

/** Разовая отправка геолокации кнопкой «я тут» — не отслеживание, один снимок координат. */
export async function getCurrentLocationOnce(): Promise<{ lat: number; lng: number } | null> {
  const position = await withSystemPicker(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    return Location.getCurrentPositionAsync({});
  });
  if (position === null) return null;
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}
