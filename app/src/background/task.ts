import { dmChatId } from "../chat/chatId";
import { handleIncomingMessage, NOTIFICATIONS_SETTING, type ChatEvents } from "../context/AppContext";
import { getCrypto } from "../crypto/sodium";
import { deleteContactWithChat, listContacts, upsertContact, type Contact } from "../db/contacts";
import { getSetting } from "../db/settings";
import { getLastSyncedTs, setLastSyncedTs } from "../db/syncState";
import { HISTORY_PAGE_LIMIT, WsClient } from "../net/wsClient";
import type { RosterMemberPayload } from "../net/protocol";
import { describeForNotification, showIncoming } from "../notify/notifications";
import { loadIdentity } from "../storage/identity";
import { Emitter } from "../util/emitter";
import { claimConnection, connectionOwner, onOwnerChange, releaseConnection } from "./owner";

/**
 * Соединение без экрана.
 *
 * Запускается службой переднего плана как headless-задача React Native — тем же
 * JS-бандлом, но без Activity. Нужна ровно для одного случая: приложение
 * смахнули из списка недавних. Раньше в этот момент уносилась Activity, а с ней
 * и весь JS: служба жила, уведомление «на связи» висело, но соединения за ним
 * не было и сообщения не приходили.
 *
 * Делает минимум: подключается, разбирает список участников, принимает
 * сообщения и показывает уведомления. Ни присутствия, ни квитанций «прочитано»,
 * ни отправки — человека у телефона нет.
 *
 * Возвращает промис, который не разрешается: задача живёт, пока живёт служба.
 */
export async function runBackgroundConnection(): Promise<void> {
  const identity = await loadIdentity();
  // Ключей нет — приложение ещё не настроено, соединяться нечем.
  if (!identity) return;

  // Экран главнее: если приложение открыто, соединение уже держит AppProvider, и
  // второе с тем же deviceId сервер считает конкурирующим — они выбивали бы друг
  // друга.
  if (!claimConnection("background")) {
    await waitUntilFree();
    if (!claimConnection("background")) return;
  }

  const crypto = await getCrypto();
  const ws = new WsClient(identity.serverUrl, {
    kind: "device",
    deviceId: identity.deviceId,
    identitySecretKey: identity.identitySecretKey,
  });

  /**
   * Контакты держим в памяти этой задачи: их ключи нужны на каждое входящее
   * сообщение, а обращаться в sqlite за ними каждый раз незачем.
   */
  let contacts: Contact[] = [];
  // События разбора сообщений никто здесь не слушает: экранов нет. Emitter
  // всё равно нужен — его требует общий разбор входящего.
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
        ws.fetchHistory(chatId, await getLastSyncedTs(chatId));
      }
    })().catch((error: unknown) => {
      console.warn("фон: не удалось разобрать список участников", error);
    });
  });

  ws.events.on("msgDeliver", (payload) => {
    void (async () => {
      // Разрешение на уведомления читаем каждый раз: настройку могли поменять на
      // экране, а перезапускать задачу ради этого незачем.
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
        // более не про фон. Уведомления по истории тоже не показываем — иначе
        // после долгого офлайна прилетела бы сотня разом.
        await handleIncomingMessage(crypto, ws, identity, message, chatEvents, {
          skipAck: true,
          silent: true,
          contacts,
        });
      }
      if (maxTs === 0) return;
      const previous = await getLastSyncedTs(payload.chatId);
      await setLastSyncedTs(payload.chatId, maxTs);
      if (payload.messages.length >= HISTORY_PAGE_LIMIT && maxTs > previous) {
        ws.fetchHistory(payload.chatId, maxTs);
      }
    })().catch((error: unknown) => {
      console.warn("фон: не удалось разобрать историю", error);
    });
  });

  /**
   * Сообщаем серверу, что человека у телефона нет.
   *
   * Соединение из фона не означает «в сети»: приложение смахнули, экран не
   * показывается. Без этого собеседник видел бы «в сети» круглосуточно.
   */
  ws.events.on("state", (state) => {
    if (state === "connected") ws.setActive(false);
  });

  ws.connect();

  // Открыли приложение — отдаём соединение экрану и закрываем своё. Экран
  // подключится сам и заберёт всё, что мы не успели.
  return new Promise<void>((resolve) => {
    const off = onOwnerChange((owner) => {
      if (owner === "app") {
        off();
        ws.disconnect();
        releaseConnection("background");
        resolve();
      }
    });
  });
}

/** Ждёт, пока соединение освободится (экран закрылся). */
function waitUntilFree(): Promise<void> {
  return new Promise((resolve) => {
    if (connectionOwner() === null) {
      resolve();
      return;
    }
    const off = onOwnerChange((owner) => {
      if (owner === null) {
        off();
        resolve();
      }
    });
  });
}
