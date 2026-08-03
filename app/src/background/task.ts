import { dmChatId } from "../chat/chatId";
import { handleIncomingMessage, NOTIFICATIONS_SETTING, type ChatEvents } from "../context/AppContext";
import { getCrypto } from "../crypto/sodium";
import { deleteContactWithChat, listContacts, upsertContact, type Contact } from "../db/contacts";
import { getSetting, setSetting } from "../db/settings";
import { getSyncCursor, setSyncCursor } from "../db/syncState";
import { HISTORY_PAGE_LIMIT, WsClient } from "../net/wsClient";
import type { RosterMemberPayload } from "../net/protocol";
import { describeForNotification, showIncoming } from "../notify/notifications";
import { loadIdentity } from "../storage/identity";
import { Emitter } from "../util/emitter";
import { claimConnection, connectionOwner, onOwnerChange, releaseConnection } from "./owner";

/** Когда фоновая задача последний раз запускалась — видно в диагностике. */
export const BACKGROUND_RUN_SETTING = "background_last_run";

/**
 * Соединение и живые таймеры без экрана.
 *
 * Запускается службой переднего плана как headless-задача React Native — тем же
 * JS-бандлом, но без Activity. Делает две вещи, и вторая оказалась важнее
 * первой.
 *
 * 1. Держит соединение, когда экрана нет вовсе: смахнули приложение из недавних
 *    и система убила процесс, служба поднялась заново (START_STICKY), Activity
 *    не создавалась. Раньше в этот момент подключаться было некому.
 *
 * 2. Не даёт замереть таймерам JS. Это и было главной причиной «уведомления
 *    перестают приходить, когда приложение убрано». React Native останавливает
 *    отправку таймеров, как только Activity свёрнута или уничтожена:
 *    JavaTimerManager.onHostPause/onHostDestroy вызывают clearFrameCallback(),
 *    и setTimeout/setInterval не срабатывают. Пока сокет жив, сообщения ещё
 *    приходят — их приносит сетевой поток. Но стоит соединению оборваться (смена
 *    Wi-Fi на мобильную сеть, таймаут NAT, сон радиомодуля), и переподключение
 *    не наступает никогда: оно назначено через setTimeout. Проверка «живой ли
 *    сокет» пингами — тоже. Служба переднего плана держала процесс, а таймеры
 *    всё равно стояли.
 *
 *    Активная headless-задача этот механизм включает обратно:
 *    JavaTimerManager.onHeadlessJsTaskStart ставит frame callback снова, а
 *    onHeadlessJsTaskFinish — снимает, если активных задач больше нет. Поэтому
 *    задача НИКОГДА не завершается, пока работает служба: завершившись, она
 *    заморозила бы таймеры обратно.
 *
 * Соединение при этом строго одно (см. owner.ts): экран главнее, задача
 * подключается только когда экрана нет, и уступает, как только он появился, —
 * но продолжает жить, чтобы таймеры экрана работали и в фоне.
 */
export async function runBackgroundConnection(): Promise<void> {
  await setSetting(BACKGROUND_RUN_SETTING, String(Date.now())).catch(() => undefined);

  const identity = await loadIdentity();
  // Ключей нет — приложение ещё не настроено (идёт онбординг). Соединяться
  // нечем, но задачу не завершаем: её единственная работа в этом случае —
  // держать таймеры живыми.
  if (!identity) return never();

  const crypto = await getCrypto();

  // Бесконечно: занять соединение, когда свободно, и отдать экрану, когда он
  // появился. Выхода из цикла нет намеренно — см. пункт 2 в описании.
  for (;;) {
    await waitUntilFree();
    if (!claimConnection("background")) continue;
    try {
      // Контакты читаем из базы заново на каждый заход: пока соединение держал
      // экран, там могли появиться новые участники и свои названия контактов.
      // Без этого первый же roster затёр бы localName значением null — своё
      // название с сервера не приходит, и взять его больше негде.
      await holdConnection(identity, crypto, await listContacts());
    } finally {
      releaseConnection("background");
    }
  }
}

type Crypto = Awaited<ReturnType<typeof getCrypto>>;
type Identity = NonNullable<Awaited<ReturnType<typeof loadIdentity>>>;

/**
 * Держит соединение, пока его не забрал экран.
 *
 * Делает минимум: принимает сообщения, показывает уведомления, догоняет
 * пропущенную историю. Ни отправки, ни присутствия «в сети», ни квитанций
 * «прочитано» — человека у телефона нет.
 */
function holdConnection(identity: Identity, crypto: Crypto, known: Contact[]): Promise<void> {
  const ws = new WsClient(identity.serverUrl, {
    kind: "device",
    deviceId: identity.deviceId,
    identitySecretKey: identity.identitySecretKey,
  });

  /**
   * Контакты держим в памяти: их ключи нужны на каждое входящее сообщение, а
   * обращаться за ними в sqlite каждый раз незачем.
   */
  let contacts: Contact[] = known;
  // Событий разбора здесь никто не слушает — экранов нет. Emitter всё равно
  // нужен: его требует общий разбор входящего.
  const chatEvents = new Emitter<ChatEvents>();

  ws.events.on("roster", (payload) => {
    void (async () => {
      const next: Contact[] = [];
      for (const member of payload.members as RosterMemberPayload[]) {
        const previous = contacts.find((c) => c.userId === member.userId);
        const contact: Contact = {
          userId: member.userId,
          deviceId: member.deviceId,
          displayName: member.displayName,
          // localName задаётся на этом устройстве и с сервера не приходит —
          // затирать его нельзя.
          localName: previous?.localName ?? null,
          identityPublicKey: member.identityPublicKey,
          encryptionPublicKey: member.encryptionPublicKey,
          fingerprint: crypto.computeFingerprint(member.identityPublicKey),
          isRevoked: member.revoked ?? previous?.isRevoked ?? false,
        };
        await upsertContact(contact);
        next.push(contact);
      }
      // Один контакт на участника, побеждает пришедший позже: сервер отдаёт
      // действующее устройство последним, а отозванное — раньше.
      contacts = [...new Map(next.map((c) => [c.userId, c])).values()];

      // Участников, которых на сервере больше нет, убираем и здесь: иначе после
      // возврата в приложение чат с удалённым всплыл бы снова.
      const stillThere = new Set(contacts.map((c) => c.userId));
      for (const stored of await listContacts()) {
        if (stillThere.has(stored.userId)) continue;
        await deleteContactWithChat(stored.userId, dmChatId(identity.userId, stored.userId));
      }

      // Догоняем то, что пришло, пока соединения не было.
      for (const contact of contacts) {
        const chatId = dmChatId(identity.userId, contact.userId);
        ws.fetchHistory(chatId, await getSyncCursor(chatId));
      }
    })().catch((error: unknown) => {
      console.warn("фон: не удалось разобрать список участников", error);
    });
  });

  ws.events.on("msgDeliver", (payload) => {
    void (async () => {
      // Настройку читаем каждый раз: её могли поменять на экране, а
      // перезапускать задачу ради этого незачем.
      const notifications = (await getSetting(NOTIFICATIONS_SETTING)) !== "0";
      await handleIncomingMessage(crypto, ws, identity, payload, chatEvents, {
        contacts,
        // Экрана нет по определению — уведомление нужно всегда, кроме своих же
        // сообщений с другого устройства.
        notify:
          notifications && payload.fromUserId !== identity.userId
            ? (contentType, plaintext) => {
                const sender = contacts.find((c) => c.userId === payload.fromUserId);
                showIncoming({
                  chatId: payload.chatId,
                  title: sender ? (sender.localName ?? sender.displayName) : "Новое сообщение",
                  body: describeForNotification(contentType, plaintext),
                }).catch((error: unknown) => {
                  console.warn("фон: уведомление не показано", error);
                });
              }
            : undefined,
      });
    })().catch((error: unknown) => {
      console.warn("фон: сообщение не удалось сохранить", error);
    });
  });

  ws.events.on("historyPage", (payload) => {
    void (async () => {
      let maxTs = 0;
      for (const message of payload.messages) {
        maxTs = Math.max(maxTs, message.ts);
        // silent + skipAck: экрана нет, обновлять нечего, а «прочитано» тем
        // более не про фон. Уведомления по истории не показываем — иначе после
        // долгого офлайна прилетела бы сотня разом.
        await handleIncomingMessage(crypto, ws, identity, message, chatEvents, {
          skipAck: true,
          silent: true,
          contacts,
        });
      }
      if (maxTs === 0) return;
      const previous = await getSyncCursor(payload.chatId);
      const last = payload.messages[payload.messages.length - 1];
      await setSyncCursor(payload.chatId, maxTs, last?.msgId ?? "");
      if (
        payload.messages.length >= HISTORY_PAGE_LIMIT &&
        (maxTs > previous.ts || (last !== undefined && last.msgId !== previous.id))
      ) {
        ws.fetchHistory(payload.chatId, { ts: maxTs, id: last?.msgId ?? null });
      }
    })().catch((error: unknown) => {
      console.warn("фон: не удалось разобрать историю", error);
    });
  });

  /**
   * Сообщаем серверу, что человека у телефона нет.
   *
   * Соединение из фона не означает «в сети»: приложение убрано, экран не
   * показывается. Без этого собеседник видел бы «в сети» круглосуточно.
   */
  ws.events.on("state", (state) => {
    if (state === "connected") ws.setActive(false);
  });

  ws.connect();

  return new Promise<void>((resolve) => {
    const off = onOwnerChange((owner) => {
      if (owner !== "app") return;
      off();
      // Своё соединение закрываем: экран подключится сам и заберёт всё, что мы
      // не успели.
      ws.disconnect();
      resolve();
    });
  });
}

/** Ждёт, пока соединение освободится (экран закрылся или его ещё не было). */
function waitUntilFree(): Promise<void> {
  return new Promise((resolve) => {
    if (connectionOwner() === null) {
      resolve();
      return;
    }
    const off = onOwnerChange((owner) => {
      if (owner !== null) return;
      off();
      resolve();
    });
  });
}

/**
 * Промис, который не разрешается никогда.
 *
 * Нужен, чтобы задача осталась активной: пока она активна, React Native не
 * замораживает таймеры (см. описание сверху).
 */
function never(): Promise<void> {
  return new Promise(() => undefined);
}
