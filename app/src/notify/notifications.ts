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

/**
 * Баннер показываем всегда.
 *
 * Раньше здесь стояло shouldShowBanner: false — «внутри приложения сообщение и
 * так видно в чате». Но обработчик срабатывает и когда приложение просто
 * открыто на другом экране, и уведомление в этом случае молча уходило в шторку.
 * Решает, показывать ли уведомление вообще, сторона отправки (AppContext): для
 * открытого чата оно не создаётся.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
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
    trigger: immediateTrigger(),
    identifier: notificationId(message.chatId),
  });
}

/**
 * Идентификатор уведомления из chatId.
 *
 * chatId выглядит как dm:<uuid>:<uuid> — с двоеточиями. Идентификатор уходит в
 * нативный слой как ключ, и полагаться на то, что двоеточия там всюду
 * безобидны, не стоит: проверить это на устройстве я не могу, а цена ошибки —
 * молчащие уведомления. Оставляем только буквы, цифры и дефис.
 */
function notificationId(chatId: string): string {
  return `chat-${chatId.replace(/[^A-Za-z0-9-]/g, "-")}`;
}

/**
 * «Показать немедленно» для нашего канала.
 *
 * trigger: null тоже показывает сразу, но канал тогда берётся тот, что задал
 * плагин на этапе сборки. Указываем его явно — иначе уведомление могло уйти в
 * канал с низкой важностью, где Android не показывает баннер, а тихо кладёт
 * строку в шторку. Канал — единственное место, где на Android настраиваются
 * звук и важность, в content его передать нельзя.
 */
function immediateTrigger(): Notifications.NotificationTriggerInput {
  return Platform.OS === "android" ? { channelId: CHANNEL_ID } : null;
}

/**
 * Пробное уведомление из настроек.
 *
 * Нужно, чтобы проверять уведомления не «напиши мне кто-нибудь», а одной
 * кнопкой: сразу видно, дошло ли разрешение, создан ли канал и не выключены ли
 * уведомления в системе.
 */
export async function showTest(): Promise<void> {
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    content: { title: "Cry", body: "Уведомления работают." },
    trigger: immediateTrigger(),
    identifier: "test",
  });
}

/** Убираем уведомления чата, когда пользователь его открыл. */
export async function dismissChat(chatId: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(notificationId(chatId));
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
