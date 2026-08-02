import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "app_lock_v1";

/**
 * Настройки блокировки приложения.
 *
 * Хранятся в expo-secure-store (Android Keystore), а не в локальной sqlite:
 * хэш кода не должен лежать в обычном файле рядом с перепиской. Сам PIN не
 * хранится нигде — только соль и Argon2id-хэш (см. packages/crypto/src/pin.ts).
 */
export interface LockConfig {
  salt: string;
  hash: string;
  /** Разрешено ли разблокировать отпечатком или лицом вместо кода. */
  biometrics: boolean;
  /**
   * Сколько секунд приложение может пробыть в фоне, не спрашивая код.
   *
   * Ноль означает «спрашивать сразу». Задержка нужна не для удобства: выбор
   * фото, файла или отправка «поделиться» уводят приложение в фон системным
   * окном, и без запаса код спрашивался бы после каждого такого действия.
   * Системные окна приложение и так отмечает отдельно (см. lock/systemPicker),
   * но список таких мест конечен, а окон в Android — нет.
   */
  graceSec: number;
}

export async function loadLockConfig(): Promise<LockConfig | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LockConfig>;
    if (typeof parsed.salt !== "string" || typeof parsed.hash !== "string") return null;
    return {
      salt: parsed.salt,
      hash: parsed.hash,
      biometrics: parsed.biometrics === true,
      graceSec: typeof parsed.graceSec === "number" ? parsed.graceSec : 60,
    };
  } catch {
    // Испорченная запись не должна запирать приложение навсегда: считаем, что
    // блокировки нет, и человек может настроить её заново.
    return null;
  }
}

export async function saveLockConfig(config: LockConfig): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(config));
}

export async function clearLockConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
