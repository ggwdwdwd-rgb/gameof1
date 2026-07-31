import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * Локальные уведомления о новых сообщениях.
 *
 * Именно локальные, не push: содержимое зашифровано и расшифровать его может
 * только само приложение, поэтому уведомление показывает клиент, когда получил
 * сообщение по своему WebSocket-соединению. Сервер о содержимом не знает и
 * ничего не рассылает.
 *
 * Важное ограничение: соединение живёт, пока Android не выгрузил процесс.
 * Свернутое приложение обычно живёт от нескольких минут до нескольких часов —
 * всё это время уведомления приходят. После выгрузки они появятся только при
 * следующем открытии Cry. Чтобы держать соединение всегда, нужен foreground
 * service с постоянным уведомлением — это отдельный шаг (см. ARCHITECTURE §7).
 */

/**
 * Совпадает с defaultChannel в app.json: канал в content указать нельзя, он
 * задаётся плагином на этапе сборки, а здесь мы только настраиваем его
 * важность и вибрацию.
 */
const CHANNEL_ID = "messages";

/** Внутри приложения баннер не показываем: сообщение и так видно в чате. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let channelReady = false;

/** Канал уведомлений Android: без него звук и важность не настроить. */
async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Сообщения",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200],
    lightColor: "#d97757",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  channelReady = true;
}

export type PermissionState = "granted" | "denied" | "undetermined";

export async function getPermissionState(): Promise<PermissionState> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "undetermined";
}

/** Спрашиваем разрешение только по действию пользователя — иначе отказ уже не переспросить. */
export async function requestPermission(): Promise<PermissionState> {
  await ensureChannel();
  const { status } = await Notifications.requestPermissionsAsync();
  if (status === "granted") return "granted";
  return status === "denied" ? "denied" : "undetermined";
}

export interface IncomingNotification {
  chatId: string;
  /** Имя отправителя — заголовок уведомления. */
  title: string;
  body: string;
}

/**
 * Показывает уведомление о новом сообщении. Уведомления одного чата
 * склеиваются по chatId, чтобы десять сообщений не превращались в десять
 * строк в шторке.
 */
export async function showIncoming(message: IncomingNotification): Promise<void> {
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: message.title,
      body: message.body,
      data: { chatId: message.chatId },
    },
    // null = показать немедленно.
    trigger: null,
    identifier: `chat-${message.chatId}`,
  });
}

/** Убираем уведомления чата, когда пользователь его открыл. */
export async function dismissChat(chatId: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(`chat-${chatId}`);
  } catch {
    // Уведомления могло уже не быть — это не ошибка.
  }
}

/** Текст уведомления по типу сообщения: содержимое вложений не раскрываем. */
export function describeForNotification(contentType: string, plaintext: string | null): string {
  switch (contentType) {
    case "text":
      return plaintext ?? "Новое сообщение";
    case "image":
      return "Фото";
    case "voice":
      return "Голосовое сообщение";
    case "file":
      return "Файл";
    case "location":
      return "Геолокация";
    default:
      return "Новое сообщение";
  }
}
