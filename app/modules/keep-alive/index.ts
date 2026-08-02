import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

/**
 * Работа в фоне: постоянное уведомление, которое не даёт Android выгрузить
 * процесс приложения.
 *
 * Уведомления о сообщениях у нас локальные — их показывает сам клиент, получив
 * сообщение по своему WebSocket, потому что расшифровать содержимое может
 * только он. Пока процесс жив, всё работает; как только Android его выгружает,
 * соединение умирает. На телефонах с агрессивной экономией батареи это
 * происходит почти сразу после сворачивания — отсюда «уведомления приходят
 * только когда я в приложении».
 *
 * Служба переднего плана — единственный поддерживаемый Android способ этого не
 * допустить, и она обязана показывать видимое уведомление. Убрать его нельзя,
 * это требование системы.
 *
 * requireOptionalNativeModule, а не requireNativeModule: если нативная часть по
 * какой-то причине не собралась или не слинковалась, приложение обязано
 * работать как раньше, а не падать при запуске.
 */
interface KeepAliveNativeModule {
  start: (title: string, text: string) => void;
  stop: () => void;
  isRunning: () => boolean;
  isScreenOn: () => boolean;
}

const native =
  Platform.OS === "android" ? requireOptionalNativeModule<KeepAliveNativeModule>("KeepAlive") : null;

/** Доступна ли работа в фоне в этой сборке. */
export function isBackgroundModeAvailable(): boolean {
  return native !== null;
}

/**
 * Включает работу в фоне или обновляет подпись уже включённой.
 * Возвращает false, если нативной части нет.
 */
export function startBackgroundMode(title: string, text: string): boolean {
  if (!native) return false;
  try {
    native.start(title, text);
    return true;
  } catch (error) {
    console.warn("не удалось включить работу в фоне", error);
    return false;
  }
}

export function stopBackgroundMode(): void {
  if (!native) return;
  try {
    native.stop();
  } catch (error) {
    console.warn("не удалось выключить работу в фоне", error);
  }
}

export function isBackgroundModeRunning(): boolean {
  if (!native) return false;
  try {
    return native.isRunning();
  } catch {
    return false;
  }
}

/**
 * Включён ли экран телефона.
 *
 * Отдельно от «приложение свёрнуто»: с работой в фоне приложение живёт всегда,
 * а гашение экрана не обязательно приходит событием сворачивания. Без этой
 * проверки сообщения помечались прочитанными и человек показывался «в сети»,
 * пока телефон лежал с погашенным экраном.
 *
 * true, если ответить нечем: лучше вести себя как раньше, чем молча перестать
 * отправлять квитанции.
 */
export function isScreenOn(): boolean {
  if (!native?.isScreenOn) return true;
  try {
    return native.isScreenOn();
  } catch {
    return true;
  }
}
