import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "device_identity_v1";

/**
 * Всё, что относится к идентичности этого устройства — включая приватные
 * части обеих пар ключей (см. ARCHITECTURE.md §2.1). Никогда не покидает
 * expo-secure-store (Android Keystore) и не отправляется на сервер целиком.
 */
export interface DeviceIdentity {
  userId: string;
  deviceId: string;
  displayName: string;
  /**
   * Свой @тег — по нему человека находят другие.
   *
   * Может отсутствовать: аккаунты появились позже, и у тех, кто регистрировался
   * по одноразовому коду, тега нет, пока они его не зададут.
   */
  username?: string | null;
  /** Почта, которой человек входит. Нужна только чтобы показать её в настройках. */
  email?: string | null;
  serverUrl: string;
  identityPublicKey: string;
  identitySecretKey: string;
  encryptionPublicKey: string;
  encryptionSecretKey: string;
}

export async function loadIdentity(): Promise<DeviceIdentity | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as DeviceIdentity;
}

export async function saveIdentity(identity: DeviceIdentity): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(identity));
}

export async function clearIdentity(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
