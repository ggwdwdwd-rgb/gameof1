import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Отпечаток или лицо — через requireOptionalNativeModule, а не обычным
 * импортом expo-local-authentication.
 *
 * Обычный импорт этого модуля бросает исключение сразу при загрузке, если
 * нативной части в сборке нет. А экран блокировки импортируется из App.tsx
 * безусловно — то есть приложение падало бы при запуске целиком, ещё до
 * соединения с сервером, на любой сборке без нового нативного модуля (например,
 * старый dev-client APK с новым JS-бандлом). Ровно эта ловушка уже была с
 * expo-application, и цена ошибки здесь выше: не «нет строчки в настройках», а
 * «приложение не открывается и сообщения не идут».
 */
interface LocalAuthenticationModule {
  hasHardwareAsync(): Promise<boolean>;
  isEnrolledAsync(): Promise<boolean>;
  authenticateAsync(options: {
    promptMessage?: string;
    cancelLabel?: string;
    disableDeviceFallback?: boolean;
  }): Promise<{ success: boolean }>;
}

const native = requireOptionalNativeModule<LocalAuthenticationModule>("ExpoLocalAuthentication");

/** Есть ли в этой сборке нативная часть вообще. */
export function isBiometricsSupported(): boolean {
  return native !== null;
}

/** Есть ли датчик И заведён ли на телефоне отпечаток или лицо. */
export async function isBiometricsUsable(): Promise<boolean> {
  if (!native) return false;
  try {
    const [hardware, enrolled] = await Promise.all([native.hasHardwareAsync(), native.isEnrolledAsync()]);
    return hardware && enrolled;
  } catch {
    return false;
  }
}

/** true — проверка пройдена. Отказ, отмена и любая ошибка дают false. */
export async function authenticateWithBiometrics(): Promise<boolean> {
  if (!native) return false;
  try {
    const result = await native.authenticateAsync({
      promptMessage: "Разблокировать Cry",
      cancelLabel: "Ввести код",
      // Системный PIN телефона как замена отпечатку не годится: человек, у
      // которого телефон уже разблокирован, прошёл бы такую проверку сразу.
      disableDeviceFallback: true,
    });
    return result.success;
  } catch {
    return false;
  }
}
