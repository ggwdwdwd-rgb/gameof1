import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { createCrypto } from "@family-messenger/crypto";
import { getCrypto } from "../crypto/sodium";
import {
  deleteContactWithChat,
  listContacts,
  setContactLocalName,
  setContactRevoked,
  upsertContact,
  type Contact,
} from "../db/contacts";
import {
  hardDeleteMessage,
  insertMessage,
  listMessagesForChat,
  markChatRead,
  markMessageDeleted,
  messageExists,
  updateMessageStatus,
  updateMessageTime,
  type LocalMessage,
} from "../db/messages";
import { listPendingAcks, queueAck, removePendingAck } from "../db/pendingAcks";
import { getSetting, setSetting } from "../db/settings";
import { getSyncCursor, setSyncCursor } from "../db/syncState";
import {
  describeForNotification,
  dismissChat,
  getPermissionState,
  requestPermission,
  showIncoming,
} from "../notify/notifications";
import { decryptDeliveredMessage, encryptForChat } from "../chat/encryption";
import { dmChatId } from "../chat/chatId";
import { claimConnection, connectionOwner, releaseConnection } from "../background/owner";
import { isBiometricsSupported } from "../lock/biometrics";
import { isAppLocked } from "../lock/lockState";
import { saveIncomingEnvelope, type LocalMediaMeta } from "../chat/media";
import { HISTORY_PAGE_LIMIT, WsClient, type ConnectionFailure, type ConnectionState } from "../net/wsClient";
import type { InviteCreatedPayload, MsgDeliverPayload, RosterMemberPayload } from "../net/protocol";
import { saveIdentity } from "../storage/identity";
import type { DeviceIdentity } from "../storage/identity";
import {
  isBackgroundModeAvailable,
  isBackgroundModeRunning,
  isScreenOn,
  startBackgroundMode,
  stopBackgroundMode,
} from "../../modules/keep-alive";
import { Emitter } from "../util/emitter";
import { uuidv4 } from "../util/uuid";

type Crypto = ReturnType<typeof createCrypto>;

const MEDIA_CONTENT_TYPES = new Set(["image", "voice", "file"]);

/** Собеседник считается печатающим не дольше этого времени — страховка от «зависшего» индикатора. */
const TYPING_EXPIRY_MS = 6_000;

export const NOTIFICATIONS_SETTING = "notifications_enabled";
/**
 * Отметка «выбор сделал человек».
 *
 * Нужна, чтобы отличить осознанное «выключить» от "0", которое записала одна
 * из прошлых сборок: она сохраняла "0" при отказе в разрешении и больше ничего
 * не проверяла. У всех, кто ту сборку успел поставить, в настройках так и лежит
 * "0" — и любое исправление логики их бы не спасло, потому что значение
 * выглядит как решение пользователя. Отметку прошлые сборки не писали никогда,
 * поэтому "0" без неё — точно не выбор человека.
 */
const NOTIFICATIONS_CHOSEN_SETTING = "notifications_chosen";
/**
 * Работа в фоне. По умолчанию включена: без неё уведомления приходят только
 * пока приложение открыто, а это ровно то, чего от мессенджера не ждут.
 * Выключается тем же переключателем в настройках.
 */
const BACKGROUND_SETTING = "background_enabled";

/** Сколько ждём готовности соединения там, где без сервера операция невозможна (создание инвайта). */
const WAIT_READY_MS = 10_000;

export interface ChatEvents extends Record<string, (...args: never[]) => void> {
  messageInserted: (chatId: string) => void;
  // chatId обязателен: без него каждый экран перечитывал свою переписку на
  // любое изменение статуса в любом чате.
  messageStatusChanged: (chatId: string, clientMsgId: string) => void;
  typingChanged: (chatId: string, fromUserId: string, isTyping: boolean) => void;
}

export type SendResult =
  | { ok: true }
  /** detail заполняется у FAILED: там текст настоящей ошибки. */
  | { ok: false; reason: "NO_CONTACT" | "NOT_READY" | "CRYPTO_FAILED" | "FAILED"; detail?: string };

export type CreateInviteResult =
  | { ok: true; invite: InviteCreatedPayload }
  /** detail — конкретная причина отказа соединения, если она известна. */
  | { ok: false; reason: "OFFLINE" | "TIMEOUT" | "SERVER_OUTDATED"; detail?: string };

/** Человекочитаемая причина отказа + что делать. Пустая строка = проблема не в аутентификации. */
export function describeFailure(failure: ConnectionFailure | null): string {
  if (!failure) return "";
  if (failure.kind === "fatal") return `Приложение не смогло запуститься: ${failure.detail}`;
  if (failure.kind === "network") return `Сервер недоступен (${failure.detail}).`;
  switch (failure.code) {
    case "UNKNOWN_DEVICE":
      return "Сервер не знает это устройство. Обычно это значит, что база сервера была пересоздана — нужен новый код приглашения и повторная регистрация в приложении.";
    case "REVOKED":
      return "Доступ этого устройства отозван на сервере.";
    case "BAD_SIGNATURE":
      return "Сервер не принял подпись устройства — ключи повреждены, нужна повторная регистрация по новому коду.";
    default:
      return `Сервер отказал в аутентификации (${failure.code}).`;
  }
}

/** Данные, которые меняются во время работы, — на них перерисовываются экраны. */
interface AppContextData {
  identity: DeviceIdentity;
  connectionState: ConnectionState;
  connectionFailure: ConnectionFailure | null;
  contacts: Contact[];
  /** Присутствие по userId: online сейчас и когда был последний раз. */
  presence: ReadonlyMap<string, Presence>;
  chatEvents: Emitter<ChatEvents>;
  myFingerprint: string;
  /** Показывать ли уведомления о сообщениях, пришедших пока приложение свёрнуто. */
  notificationsEnabled: boolean;
  /** Имя, которым участника видят остальные (может измениться без перезапуска). */
  displayName: string;
  /** Свой @тег — его показывают, чтобы человек мог им поделиться. */
  username: string | null;
  /**
   * Можно ли распоряжаться составом. Приходит от сервера (первый
   * зарегистрированный участник) — клиент только показывает кнопку.
   */
  isAdmin: boolean;
  /** Включена ли работа в фоне (постоянное уведомление). */
  backgroundEnabled: boolean;
  /** Есть ли поддержка работы в фоне в этой сборке приложения. */
  backgroundAvailable: boolean;
}

/** Действия: их идентичность не меняется, поэтому эффекты экранов стабильны. */
interface AppActions {
  sendText: (chatId: string, text: string, replyTo?: string | null) => Promise<SendResult>;
  sendMedia: (
    chatId: string,
    contentType: "image" | "voice" | "file",
    envelopeJson: string,
    localMeta: LocalMediaMeta,
    replyTo?: string | null,
  ) => Promise<SendResult>;
  sendLocation: (chatId: string, lat: number, lng: number, replyTo?: string | null) => Promise<SendResult>;
  deleteMessage: (msgId: string, chatId: string) => Promise<void>;
  /** Помечает чат прочитанным и подтверждает серверу только реально изменившиеся сообщения. */
  markChatRead: (chatId: string) => Promise<void>;
  setTyping: (chatId: string, isTyping: boolean) => void;
  loadMessages: (chatId: string) => Promise<LocalMessage[]>;
  createInvite: () => Promise<CreateInviteResult>;
  reconnect: () => void;
  /** Смена своего имени: локально, на сервере и у остальных участников. */
  renameSelf: (displayName: string) => Promise<boolean>;
  /** Своё название контакта — только на этом устройстве, никуда не отправляется. */
  renameContact: (userId: string, localName: string | null) => Promise<void>;
  /** Включение и выключение уведомлений о новых сообщениях. */
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  /** Включение и выключение работы в фоне (постоянного уведомления). */
  setBackgroundEnabled: (enabled: boolean) => Promise<void>;
  /** Какой чат открыт на экране: для него уведомление не показываем. */
  setActiveChat: (chatId: string | null) => void;
  /** Удаление участника из системы — доступно только админу. */
  removeMember: (userId: string) => Promise<{ ok: true } | { ok: false; detail: string }>;
  /** Отзыв и возврат доступа устройства (потерянный телефон) — только админу. */
  revokeDevice: (userId: string, revoked: boolean) => Promise<{ ok: true } | { ok: false; detail: string }>;
  /** Поиск человека по @тегу, почте или телефону. null — никого не нашли. */
  findUser: (query: string) => Promise<FoundUser | null>;
  /** Добавление найденного человека в контакты (связь сразу взаимная). */
  addContact: (user: FoundUser) => Promise<{ ok: true } | { ok: false; detail: string }>;
  /** Смена своего @тега. */
  changeUsername: (username: string) => Promise<{ ok: true } | { ok: false; detail: string }>;
  /** Самопроверка отправки по шагам — см. runSelfTest. */
  selfTest: () => Promise<SelfTestStep[]>;
}

/** Найденный по тегу человек — то, что нужно, чтобы его добавить. */
export interface FoundUser {
  userId: string;
  displayName: string;
  username: string | null;
  identityPublicKey: string;
  encryptionPublicKey: string;
}

/** Один шаг самопроверки: что проверяли, получилось ли и подробности. */
export interface SelfTestStep {
  name: string;
  ok: boolean;
  detail: string;
}

type AppContextValue = AppContextData & AppActions;

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp() вызван вне AppProvider");
  return ctx;
}

/** localName берём из уже известного контакта: он локальный и с сервера не приходит. */
function contactFromRoster(crypto: Crypto, member: RosterMemberPayload, previous?: Contact): Contact {
  return {
    userId: member.userId,
    deviceId: member.deviceId,
    displayName: member.displayName,
    // Тег может не прийти (старый сервер) — прежний тогда важнее пустоты.
    username: member.username ?? previous?.username ?? null,
    localName: previous?.localName ?? null,
    identityPublicKey: member.identityPublicKey,
    encryptionPublicKey: member.encryptionPublicKey,
    fingerprint: crypto.computeFingerprint(member.identityPublicKey),
    // Поля может не быть: старый сервер его не присылает, а memberUpdated
    // собирает member вручную. В обоих случаях прежнее значение важнее
    // выдуманного false — иначе смена имени снимала бы отзыв.
    isRevoked: member.revoked ?? previous?.isRevoked ?? false,
  };
}

/** Кто сейчас в сети и когда был последний раз. */
export interface Presence {
  online: boolean;
  lastSeenAt: number | null;
}

export function AppProvider({
  identity,
  children,
}: {
  identity: DeviceIdentity;
  children: React.ReactNode;
}): React.ReactElement {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [connectionFailure, setConnectionFailure] = useState<ConnectionFailure | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [myFingerprint, setMyFingerprint] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [displayName, setDisplayName] = useState(identity.displayName);
  /** Свой @тег: по нему тебя находят другие. */
  const [username, setUsername] = useState<string | null>(identity.username ?? null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  /**
   * Присутствие не храним в локальной базе: оно живёт только пока есть
   * соединение, и после перезапуска всё равно приходит заново в roster.
   */
  const [presence, setPresence] = useState<ReadonlyMap<string, Presence>>(new Map());
  /** Свёрнуто приложение или нет. */
  const appActiveRef = useRef(true);
  /** Чат, открытый прямо сейчас: только для него уведомление лишнее. */
  const activeChatRef = useRef<string | null>(null);
  const notificationsRef = useRef(false);
  const backgroundRef = useRef(false);
  /** Что об активности уже сказано серверу — чтобы не повторять один и тот же пакет. */
  const lastReportedActiveRef = useRef(true);
  const cryptoRef = useRef<Crypto | null>(null);
  const wsRef = useRef<WsClient | null>(null);
  const contactsRef = useRef<Contact[]>([]);
  const chatEvents = useMemo(() => new Emitter<ChatEvents>(), []);

  /**
   * Приводит службу переднего плана в соответствие с настройкой и состоянием
   * связи. Вызывается и при изменении настройки, и на каждое изменение
   * состояния соединения — подпись в постоянном уведомлении должна говорить
   * правду, иначе оно вводит в заблуждение хуже, чем его отсутствие.
   */
  /**
   * Сообщает серверу, смотрит ли человек на телефон.
   *
   * Раньше «в сети» вычислялось из наличия соединения, и этого хватало:
   * свёрнутое приложение Android быстро выгружал. Со службой переднего плана
   * соединение живёт всегда, и без явного сообщения человек висел бы «в сети» с
   * телефоном в кармане.
   */
  const reportActivity = useCallback((): void => {
    // Запертое приложение — не «в сети»: человек к переписке не подошёл, даже
    // если экран горит. Сходится это за 15 секунд, по тому же интервалу, что и
    // остальные изменения активности, — отдельного события разблокировки здесь
    // не хватало бы только для мгновенности.
    const active = appActiveRef.current && isScreenOn() && !isAppLocked();
    if (active === lastReportedActiveRef.current) return;
    if (wsRef.current?.setActive(active) === true) lastReportedActiveRef.current = active;
  }, []);

  const applyBackgroundMode = useCallback((connected: boolean): void => {
    if (!backgroundRef.current) return;
    // Начиная с Android 12 запустить службу переднего плана из фона нельзя —
    // система бросает исключение. Пока приложение открыто, запуск разрешён;
    // уже запущенной службе можно обновлять подпись и из фона.
    if (!appActiveRef.current && !isBackgroundModeRunning()) return;
    startBackgroundMode("Cry", connected ? "На связи — сообщения дойдут" : "Нет соединения, переподключаюсь");
  }, []);

  /**
   * Отмечает чат прочитанным — но только если человек действительно смотрит на
   * экран.
   *
   * Проверка активности обязательна. С работой в фоне экран чата остаётся
   * смонтированным после сворачивания приложения, и каждое пришедшее сообщение
   * тут же помечалось прочитанным: у собеседника появлялись две галочки, хотя
   * сообщение никто не видел. До работы в фоне это почти не проявлялось —
   * процесс успевали выгрузить.
   */
  const markChatReadIfVisible = useCallback(
    async (chatId: string): Promise<void> => {
      // Погашенный экран — это не «прочитано», даже если приложение формально
      // активно: событие сворачивания при гашении приходит не на всех
      // прошивках, поэтому спрашиваем состояние экрана напрямую. Экран
      // блокировки — то же самое: приложение активно, экран включён, но чат под
      // ним перекрыт и никто его не читает.
      if (!appActiveRef.current || !isScreenOn() || isAppLocked()) return;

      // Уведомления этого чата больше не нужны — пользователь его открыл.
      void dismissChat(chatId);

      const changed = await markChatRead(chatId, identity.userId);
      if (changed.length === 0) return;

      // Локально помечаем всегда, чтобы счётчик непрочитанного гас сразу при
      // открытии чата. Квитанции, которые не ушли (нет связи), кладём в
      // очередь и досылаем при подключении — иначе у собеседника сообщение
      // навсегда осталось бы «доставлено» вместо «прочитано».
      const ws = wsRef.current;
      for (const msgId of changed) {
        if (!ws?.ackMessage(msgId, chatId, "read")) {
          await queueAck({ msgId, chatId, status: "read" });
        }
      }
      chatEvents.emit("messageStatusChanged", chatId, changed[0]!);
    },
    [identity.userId, chatEvents],
  );

  useEffect(() => {
    let cancelled = false;
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

    // catch обязателен: без него исключение здесь (например, из проверки сборки
    // libsodium) уходило в unhandled rejection, ws.connect() не вызывался
    // никогда, и приложение просто оставалось «без соединения» без объяснений.
    void (async () => {
      const crypto = await getCrypto();
      if (cancelled) return;
      cryptoRef.current = crypto;
      setMyFingerprint(crypto.computeFingerprint(identity.identityPublicKey));

      // Только чтение сохранённых настроек — ничего интерактивного. Всё
      // остальное про уведомления вынесено в отдельную задачу после
      // ws.connect() (см. комментарий там же).
      const stored = await getSetting(NOTIFICATIONS_SETTING);
      const chosenByUser = (await getSetting(NOTIFICATIONS_CHOSEN_SETTING)) === "1";
      // Работа в фоне по умолчанию включена: без неё уведомления приходят
      // только пока приложение открыто.
      const backgroundOn = (await getSetting(BACKGROUND_SETTING)) !== "0";
      backgroundRef.current = backgroundOn;
      if (!cancelled) setBackgroundEnabled(backgroundOn);
      notificationsRef.current = stored === "1";
      if (!cancelled) setNotificationsEnabled(stored === "1");

      const storedContacts = await listContacts();
      if (cancelled) return;
      contactsRef.current = storedContacts;
      setContacts(storedContacts);

      const ws = new WsClient(identity.serverUrl, {
        kind: "device",
        deviceId: identity.deviceId,
        identitySecretKey: identity.identitySecretKey,
      });
      wsRef.current = ws;

      ws.events.on("state", (state) => {
        setConnectionState(state);
        applyBackgroundMode(state === "connected");
        if (state !== "connected") {
          // Без соединения мы не знаем, кто в сети: показывать прежнее «в сети»
          // было бы обманом. Время последнего появления при этом сохраняем.
          setPresence((prev) => new Map([...prev].map(([id, p]) => [id, { ...p, online: false }])));
          return;
        }
        setConnectionFailure(null);
        // После переподключения сервер считает устройство активным — если это
        // не так, поправляем сразу.
        lastReportedActiveRef.current = true;
        reportActivity();
        // Квитанции, не ушедшие из-за отсутствия связи, досылаем один раз при
        // подключении. Повторять их постоянно нельзя — именно это раньше и
        // создавало поток лишних пакетов.
        void (async () => {
          for (const ack of await listPendingAcks()) {
            if (ws.ackMessage(ack.msgId, ack.chatId, ack.status)) await removePendingAck(ack.msgId);
          }
        })();
      });
      ws.events.on("failure", setConnectionFailure);
      // Права приходят от сервера при каждом подключении: состав участников
      // мог измениться, и «первым» после удаления может стать другой человек.
      ws.events.on("authOk", (payload) => setIsAdmin(payload.isAdmin === true));
      ws.events.on("inviteOk", (payload) => setIsAdmin(payload.isAdmin === true));

      async function upsertAndTrack(member: RosterMemberPayload): Promise<Contact> {
        const contact = contactFromRoster(crypto, member, contactsRef.current.find((c) => c.userId === member.userId));
        await upsertContact(contact);
        // Ссылку обновляем синхронно, не дожидаясь перерисовки: сразу после
        // roster идёт запрос истории, и её расшифровка использует именно этот
        // список. Через setContacts он появился бы позже — и сообщения легли бы
        // в базу нерасшифрованными навсегда.
        contactsRef.current = [...contactsRef.current.filter((c) => c.userId !== contact.userId), contact];
        setContacts(contactsRef.current);
        return contact;
      }

      /**
       * Разбор roster обязан жаловаться, если сломался.
       *
       * Здесь начинается вся работа после подключения: без контактов нечем
       * шифровать (отправка отвечает NO_CONTACT) и нечем расшифровывать
       * входящее, а история даже не запрашивается. Раньше исключение из этого
       * обработчика уходило в никуда, и получалось худшее из состояний:
       * «на связи», но ничего не работает и никаких следов причины.
       */
      ws.events.on("roster", (payload) => {
        void (async () => {
          for (const member of payload.members) {
            await upsertAndTrack(member);
          }

          /**
           * Участники, которых на сервере больше нет, удаляются и локально.
           *
           * roster — полный список остальных участников, то есть единственный
           * источник правды. Раньше контакты только добавлялись: удалённый на
           * сервере человек оставался в списке чатов навсегда. Обычный случай —
           * переустановка приложения: она заводит новые ключи, то есть нового
           * участника, а прежний «я» остаётся мёртвым чатом, писать в который
           * бессмысленно.
           */
          const stillThere = new Set(payload.members.map((m) => m.userId));
          const gone = contactsRef.current.filter((c) => !stillThere.has(c.userId));
          if (gone.length > 0) {
            for (const contact of gone) {
              await deleteContactWithChat(contact.userId, dmChatId(identity.userId, contact.userId));
            }
            contactsRef.current = contactsRef.current.filter((c) => stillThere.has(c.userId));
            setContacts(contactsRef.current);
            setPresence((prev) => new Map([...prev].filter(([id]) => stillThere.has(id))));
          }
          // Снимок присутствия приходит вместе со списком участников.
          setPresence(
            new Map(
              payload.members.map((member) => [
                member.userId,
                { online: member.online === true, lastSeenAt: member.lastSeenAt ?? null },
              ]),
            ),
          );
          // Синхронизация истории по всем личным чатам после (пере)подключения.
          for (const member of payload.members) {
            const chatId = dmChatId(identity.userId, member.userId);
            ws.fetchHistory(chatId, await getSyncCursor(chatId));
          }
        })().catch((error: unknown) => {
          setConnectionFailure({
            kind: "fatal",
            detail: `не удалось разобрать список участников: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
      });

      ws.events.on("memberJoined", (member) => {
        void upsertAndTrack(member).catch((error: unknown) => {
          setConnectionFailure({
            kind: "fatal",
            detail: `не удалось сохранить участника: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
      });

      ws.events.on("presence", (payload) => {
        setPresence((prev) => {
          const next = new Map(prev);
          next.set(payload.userId, {
            online: payload.online,
            // При уходе сервер присылает время, при появлении — null: тогда
            // прежнее значение сохраняем, оно ещё может пригодиться.
            lastSeenAt: payload.lastSeenAt ?? prev.get(payload.userId)?.lastSeenAt ?? null,
          });
          return next;
        });
      });

      ws.events.on("memberUpdated", (payload) => {
        if (payload.userId === identity.userId) {
          setDisplayName(payload.displayName);
          return;
        }
        const existing = contactsRef.current.find((c) => c.userId === payload.userId);
        if (!existing) return;
        void upsertAndTrack({
          userId: existing.userId,
          deviceId: existing.deviceId,
          displayName: payload.displayName,
          // Тег приходит вместе с именем: сервер рассылает member.updated и при
          // его смене. undefined оставит прежний (см. contactFromRoster).
          ...(payload.username === undefined ? {} : { username: payload.username }),
          identityPublicKey: existing.identityPublicKey,
          encryptionPublicKey: existing.encryptionPublicKey,
          joinedAt: 0,
        });
      });

      /**
       * Участника удалили — убираем его и переписку с ним локально.
       *
       * То же самое делает сверка с roster при подключении, но событие приходит
       * сразу: чат исчезает у всех, кто в этот момент в приложении, а не после
       * следующего запуска.
       */
      ws.events.on("memberRemoved", (payload) => {
        void (async () => {
          await deleteContactWithChat(payload.userId, dmChatId(identity.userId, payload.userId));
          contactsRef.current = contactsRef.current.filter((c) => c.userId !== payload.userId);
          setContacts(contactsRef.current);
          setPresence((prev) => new Map([...prev].filter(([id]) => id !== payload.userId)));
          chatEvents.emit("messageInserted", dmChatId(identity.userId, payload.userId));
        })();
      });

      /**
       * Доступ устройства отозвали (или вернули).
       *
       * Переписку, в отличие от удаления участника, не трогаем: мера обратимая,
       * а старые сообщения расшифровываются ключами этого же устройства. Чат
       * остаётся на месте — только помечается и запрещает отправку.
       */
      ws.events.on("memberRevoked", (payload) => {
        void (async () => {
          const existing = contactsRef.current.find((c) => c.userId === payload.userId);
          if (!existing || existing.deviceId !== payload.deviceId) return;
          await setContactRevoked(payload.userId, payload.revoked);
          contactsRef.current = contactsRef.current.map((c) =>
            c.userId === payload.userId ? { ...c, isRevoked: payload.revoked } : c,
          );
          setContacts(contactsRef.current);
          // Отозванное устройство сервер отключает сразу, но пакет presence
          // придёт своим порядком — не ждём его, гасим «в сети» здесь.
          if (payload.revoked) {
            setPresence((prev) => {
              const next = new Map(prev);
              const before = prev.get(payload.userId);
              next.set(payload.userId, { online: false, lastSeenAt: before?.lastSeenAt ?? null });
              return next;
            });
          }
        })();
      });

      /**
       * Нас добавили в контакты — или мы добавили сами.
       *
       * Приходит обеим сторонам: связь взаимная. Для того, кого добавили, это
       * единственный способ узнать о человеке — общего списка участников больше
       * нет, и ключи для ответа приходят именно здесь.
       */
      ws.events.on("contactAdded", (payload) => {
        void upsertAndTrack({
          userId: payload.user.userId,
          deviceId: "",
          displayName: payload.user.displayName,
          username: payload.user.username,
          identityPublicKey: payload.user.identityPublicKey,
          encryptionPublicKey: payload.user.encryptionPublicKey,
          joinedAt: Date.now(),
        })
          .then(() => {
            if (payload.online === true) {
              setPresence((prev) => new Map(prev).set(payload.user.userId, { online: true, lastSeenAt: null }));
            }
            // Список чатов должен обновиться сразу: новый контакт — новый чат.
            chatEvents.emit("messageInserted", dmChatId(identity.userId, payload.user.userId));
          })
          .catch((error: unknown) => {
            setConnectionFailure({
              kind: "fatal",
              detail: `не удалось сохранить контакт: ${error instanceof Error ? error.message : String(error)}`,
            });
          });
      });

      ws.events.on("msgDeliver", (payload) => {
        void handleIncomingMessage(crypto, ws, identity, payload, chatEvents, {
          contacts: contactsRef.current,
          // Уведомление показываем для чужих сообщений всегда, кроме одного
          // случая: приложение открыто именно на этом чате — там сообщение и так
          // видно. Раньше условием было «только когда приложение свёрнуто», и
          // уведомления не появлялись, если человек в это время просто листал
          // список чатов.
          // Заперто — значит открытый чат перекрыт экраном блокировки, и
          // уведомление нужно: иначе о сообщении не узнать вовсе.
          notify:
            notificationsRef.current &&
            payload.fromUserId !== identity.userId &&
            !(appActiveRef.current && !isAppLocked() && activeChatRef.current === payload.chatId)
              ? (contentType, plaintext) => {
                  const sender = contactsRef.current.find((c) => c.userId === payload.fromUserId);
                  // catch обязателен: исключение отсюда ушло бы в unhandled
                  // rejection и молча потеряло не только уведомление, но и
                  // всякий след того, что оно вообще пыталось показаться.
                  showIncoming({
                    chatId: payload.chatId,
                    title: sender ? (sender.localName ?? sender.displayName) : "Новое сообщение",
                    body: describeForNotification(contentType, plaintext),
                  }).catch((error: unknown) => {
                    console.warn("уведомление не показано", error);
                  });
                }
              : undefined,
        }).catch((error: unknown) => {
          // Пришедшее сообщение, потерянное без следа, — это «сообщения не
          // идут» без единой зацепки. Показываем причину.
          setConnectionFailure({
            kind: "fatal",
            detail: `сообщение не удалось сохранить: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
      });

      ws.events.on("msgAccepted", (payload) => {
        void (async () => {
          const statusChanged = await updateMessageStatus(payload.clientMsgId, "sent");
          // Время выравниваем по серверному: только так порядок переписки
          // совпадает у обеих сторон (см. updateMessageTime).
          const timeChanged =
            payload.ts !== undefined && (await updateMessageTime(payload.clientMsgId, payload.ts));
          // Сдвиг времени меняет порядок в списке, поэтому это не «изменился
          // статус», а «список надо перечитать целиком».
          if (timeChanged) chatEvents.emit("messageInserted", payload.chatId);
          else if (statusChanged) chatEvents.emit("messageStatusChanged", payload.chatId, payload.clientMsgId);
        })();
      });

      ws.events.on("ackRelay", (payload) => {
        // msgId у нас всегда равен clientMsgId (сервер не меняет id).
        void updateMessageStatus(payload.msgId, payload.status).then((changed) => {
          if (changed) chatEvents.emit("messageStatusChanged", payload.chatId, payload.msgId);
        });
      });

      ws.events.on("typingRelay", (payload) => {
        chatEvents.emit("typingChanged", payload.chatId, payload.fromUserId, payload.isTyping);

        // Собственный таймер сброса: если собеседник закрыл приложение, не
        // отправив "перестал печатать", индикатор иначе остался бы навсегда.
        const key = `${payload.chatId}:${payload.fromUserId}`;
        const existing = typingTimers.get(key);
        if (existing) clearTimeout(existing);
        if (payload.isTyping) {
          typingTimers.set(
            key,
            setTimeout(() => {
              typingTimers.delete(key);
              chatEvents.emit("typingChanged", payload.chatId, payload.fromUserId, false);
            }, TYPING_EXPIRY_MS),
          );
        } else {
          typingTimers.delete(key);
        }
      });

      ws.events.on("msgDeleted", (payload) => {
        void markMessageDeleted(payload.msgId).then(() => {
          chatEvents.emit("messageInserted", payload.chatId);
        });
      });

      ws.events.on("historyPage", (payload) => {
        void (async () => {
          let maxTs = 0;
          let inserted = 0;
          for (const message of payload.messages) {
            maxTs = Math.max(maxTs, message.ts);
            // silent: страница истории — это до 200 сообщений, и событие на
            // каждое означало 200 полных перечитываний переписки подряд.
            // Сообщаем один раз, когда страница разобрана.
            if (await handleIncomingMessage(crypto, ws, identity, message, chatEvents, {
              skipAck: true,
              silent: true,
              contacts: contactsRef.current,
            })) {
              inserted += 1;
            }
          }
          if (inserted > 0) chatEvents.emit("messageInserted", payload.chatId);
          if (maxTs === 0) return;

          const previous = await getSyncCursor(payload.chatId);
          const last = payload.messages[payload.messages.length - 1];
          await setSyncCursor(payload.chatId, maxTs, last?.msgId ?? "");

          /**
           * Полная страница означает, что на сервере есть ещё — просим следующую
           * сразу.
           *
           * Раньше страница приходила одна: после долгого офлайна доезжало 200
           * сообщений, а остальные ждали следующего переподключения, которого при
           * живом соединении может не быть часами. nextCursor сервер не отдаёт,
           * поэтому курсор — время последнего сообщения страницы.
           *
           * Условие maxTs > previous обязательно: без него страница, целиком
           * состоящая из сообщений с одинаковым временем, запрашивалась бы по
           * кругу вечно (сервер отдаёт строго новее курсора).
           */
          // Полная страница означает «на сервере есть ещё». Условие про курсор
          // защищает от кругового запроса, если страница целиком оказалась из
          // сообщений с одним временем и тем же последним id.
          if (
            payload.messages.length >= HISTORY_PAGE_LIMIT &&
            (maxTs > previous.ts || (last !== undefined && last.msgId !== previous.id))
          ) {
            ws.fetchHistory(payload.chatId, { ts: maxTs, id: last?.msgId ?? null });
          }
        })();
      });

      // Экран забирает соединение себе: если его в этот момент держала
      // headless-задача службы, она закроет своё и уступит. Два соединения с
      // одним deviceId сервер считает конкурирующими и выбивают друг друга.
      claimConnection("app");
      ws.connect();

      /**
       * Уведомления настраиваем ПОСЛЕ connect и отдельной задачей.
       *
       * Здесь показывается системный диалог разрешения, то есть ожидание
       * человека. В общей цепочке инициализации это означало бы, что
       * ws.connect() ждёт, пока пользователь нажмёт кнопку в диалоге, а любая
       * ошибка отсюда уводила бы весь запуск в catch — и приложение оставалось
       * бы вообще без соединения, «сообщения не идут». Один раз я уже наступил
       * на это с проверкой сборки libsodium; ничего интерактивного и ничего
       * необязательного до connect быть не должно.
       *
       * Правило: "0", записанное человеком, уважаем. Во всех остальных случаях
       * включённость равна наличию системного разрешения — если разрешение
       * есть, уведомления работают, и искать выключатель не нужно.
       *
       * Прошлая версия записывала "0" сама при отказе в разрешении и больше
       * ничего не проверяла: один отказ (или диалог, закрытый мимо) навсегда
       * выключал уведомления, даже если разрешение потом выдали в настройках
       * телефона. Отсюда и было «пробное уведомление показывается, а на
       * сообщения не приходит»: выключатель молча стоял в «выкл». Такое "0"
       * отличается отсутствием отметки NOTIFICATIONS_CHOSEN_SETTING — её
       * прошлые сборки не писали, — и мы его не уважаем, а пересматриваем.
       */
      void (async () => {
        try {
          if (stored === "0" && chosenByUser) return; // выключено человеком

          const state =
            (await getPermissionState()) === "granted" ? "granted" : await requestPermission();

          const on = state === "granted";
          notificationsRef.current = on;
          if (!cancelled) setNotificationsEnabled(on);
          // Приводим сохранённое значение в соответствие: иначе после
          // перезапуска до этой задачи опять читалось бы старое "0".
          await setSetting(NOTIFICATIONS_SETTING, on ? "1" : "0");
        } catch (error) {
          console.warn("не удалось настроить уведомления", error);
        }
      })();
    })().catch((error: unknown) => {
      if (cancelled) return;
      const detail = error instanceof Error ? error.message : String(error);
      setConnectionFailure({ kind: "fatal", detail });
    });

    // Android рвёт сокеты у свёрнутых приложений, событие close при этом может
    // не прийти. Поэтому при каждом возврате в приложение проверяем связь и,
    // если её нет, переподключаемся сразу, не дожидаясь backoff-таймера.
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      appActiveRef.current = nextState === "active";
      reportActivity();
      if (nextState !== "active") return;
      const ws = wsRef.current;
      if (ws && !ws.isReady()) ws.forceReconnect();
      // Службу могли убить, пока приложение было свёрнуто. Возврат на экран —
      // единственный момент, когда её снова разрешено запустить.
      applyBackgroundMode(ws?.state === "connected");
      // Пока приложение было свёрнуто, «прочитано» не отправлялось. Если чат
      // открыт, человек видит его прямо сейчас — вот теперь и отмечаем.
      const openChat = activeChatRef.current;
      if (openChat !== null) void markChatReadIfVisible(openChat);
    });

    /**
     * Гашение экрана не на всех прошивках приходит событием сворачивания
     * приложения, а спросить состояние экрана можно только опросом. Раз в 15
     * секунд — дешёвый нативный вызов, зато «в сети» и квитанции перестают
     * врать, когда телефон просто лежит.
     */
    const activityTimer = setInterval(reportActivity, 15_000);

    return () => {
      cancelled = true;
      clearInterval(activityTimer);
      appStateSub.remove();
      for (const timer of typingTimers.values()) clearTimeout(timer);
      wsRef.current?.disconnect();
      // Отпускаем соединение: с этого момента его может занять headless-задача
      // службы переднего плана.
      releaseConnection("app");
    };
    // identity стабилен на весь жизненный цикл AppProvider — переавторизация не нужна
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions = useMemo<AppActions>(() => {
    /** Общая часть sendText/sendMedia/sendLocation: шифрование + локальная запись + отправка. */
    async function sendEncrypted(
      chatId: string,
      contentType: string,
      wireContent: string,
      localPlaintext: string,
      replyTo: string | null,
    ): Promise<SendResult> {
      const crypto = cryptoRef.current;
      const ws = wsRef.current;
      if (!crypto || !ws) return { ok: false, reason: "NOT_READY" };

      // Отозванные устройства исключаем: сервер им всё равно не доставит, а
      // отправка выглядела бы успешной. Экран чата строку ввода для них не
      // показывает — это второй заслон, на случай гонки с отзывом.
      const contactsByUserId = new Map(
        contactsRef.current.filter((c) => !c.isRevoked).map((c) => [c.userId, c]),
      );
      const encrypted = encryptForChat(crypto, identity, chatId, wireContent, contactsByUserId);
      if ("error" in encrypted) return { ok: false, reason: encrypted.error };

      const clientMsgId = uuidv4();

      // try вокруг записи и отправки: без него ошибка sqlite или сериализации
      // превращалась в отклонённый промис, который никто не ждёт. Наружу это
      // выглядело как «нажал отправить, и ничего не произошло» — без сообщения,
      // без пузыря, без следа.
      try {
        await insertMessage({
          id: clientMsgId,
          clientMsgId,
          chatId,
          fromUserId: identity.userId,
          contentType,
          plaintext: localPlaintext,
          replyTo,
          status: "pending",
          createdAt: Date.now(),
          deletedAt: null,
        });
        chatEvents.emit("messageInserted", chatId);

        await ws.sendMessage({
          clientMsgId,
          chatId,
          contentType,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          replyTo,
        });
      } catch (error) {
        return { ok: false, reason: "FAILED", detail: error instanceof Error ? error.message : String(error) };
      }

      // Сообщение уже в outbox и уйдёт при подключении, но ждать до 30 секунд
      // backoff незачем: если связи нет — пробуем подключиться немедленно.
      if (!ws.isReady()) ws.forceReconnect();
      return { ok: true };
    }

    return {
      sendText: (chatId, text, replyTo = null) => sendEncrypted(chatId, "text", text, text, replyTo),
      sendMedia: (chatId, contentType, envelopeJson, localMeta, replyTo = null) =>
        sendEncrypted(chatId, contentType, envelopeJson, JSON.stringify(localMeta), replyTo),
      sendLocation: (chatId, lat, lng, replyTo = null) => {
        const json = JSON.stringify({ lat, lng });
        return sendEncrypted(chatId, "location", json, json, replyTo);
      },
      async deleteMessage(msgId, chatId) {
        await markMessageDeleted(msgId);
        chatEvents.emit("messageInserted", chatId);
        wsRef.current?.deleteMessage(msgId, chatId);
      },
      markChatRead: markChatReadIfVisible,
      setTyping(chatId, isTyping) {
        wsRef.current?.sendTyping(chatId, isTyping);
      },
      loadMessages: (chatId) => listMessagesForChat(chatId),
      reconnect() {
        wsRef.current?.forceReconnect();
      },
      async renameSelf(nextName) {
        const trimmed = nextName.trim();
        if (trimmed.length === 0 || trimmed.length > 40) return false;

        const ws = wsRef.current;
        // Имя видят остальные, поэтому без связи менять его нельзя: иначе у
        // разных людей будут разные имена одного человека.
        if (!ws || !(await ws.waitUntilReady(WAIT_READY_MS)) || !ws.updateProfile(trimmed)) return false;

        // Локально сохраняем сразу: подтверждение придёт пакетом member.updated,
        // но ждать его на экране незачем.
        // В хранилище — чтобы имя сохранилось после перезапуска; в состояние —
        // чтобы экраны увидели его сразу. Сам объект identity не мутируем.
        await saveIdentity({ ...identity, displayName: trimmed });
        setDisplayName(trimmed);
        return true;
      },
      async renameContact(userId, localName) {
        const trimmed = localName?.trim() ?? "";
        const value = trimmed.length === 0 ? null : trimmed.slice(0, 40);
        await setContactLocalName(userId, value);
        contactsRef.current = contactsRef.current.map((c) => (c.userId === userId ? { ...c, localName: value } : c));
        setContacts(contactsRef.current);
      },
      async removeMember(userId) {
        const ws = wsRef.current;
        if (!ws || !(await ws.waitUntilReady(WAIT_READY_MS))) {
          return { ok: false, detail: "нет соединения с сервером" };
        }

        return new Promise((resolve) => {
          let settled = false;
          const finish = (result: { ok: true } | { ok: false; detail: string }): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            offRemoved();
            offError();
            resolve(result);
          };

          const timer = setTimeout(() => finish({ ok: false, detail: "сервер не ответил" }), 12_000);
          const offRemoved = ws.events.on("memberRemoved", (payload) => {
            if (payload.userId === userId) finish({ ok: true });
          });
          // Отказ разбираем по коду: «нельзя» и «старый сервер не знает такой
          // пакет» требуют разных объяснений.
          const offError = ws.events.on("errorPacket", (payload) => {
            if (payload.code === "UNKNOWN_TYPE") {
              finish({ ok: false, detail: "сервер устарел — обновите его" });
              return;
            }
            if (["NOT_ADMIN", "CANNOT_REMOVE_SELF", "NO_SUCH_USER"].includes(payload.code)) {
              finish({ ok: false, detail: payload.message });
            }
          });

          if (!ws.removeMember(userId)) finish({ ok: false, detail: "пакет не удалось отправить" });
        });
      },
      /**
       * Отзыв доступа устройства.
       *
       * Адресуемся по участнику, а не по устройству: в приложении видно людей, а
       * deviceId лежит в контакте. Ответом считаем member.revoked — сервер
       * рассылает его всем, включая того, кто попросил.
       */
      async revokeDevice(userId, revoked) {
        const contact = contactsRef.current.find((c) => c.userId === userId);
        if (!contact) return { ok: false, detail: "участник не найден" };

        const ws = wsRef.current;
        if (!ws || !(await ws.waitUntilReady(WAIT_READY_MS))) {
          return { ok: false, detail: "нет соединения с сервером" };
        }

        return new Promise((resolve) => {
          let settled = false;
          const finish = (result: { ok: true } | { ok: false; detail: string }): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            offRevoked();
            offError();
            resolve(result);
          };

          const timer = setTimeout(() => finish({ ok: false, detail: "сервер не ответил" }), 12_000);
          const offRevoked = ws.events.on("memberRevoked", (payload) => {
            if (payload.deviceId === contact.deviceId && payload.revoked === revoked) finish({ ok: true });
          });
          const offError = ws.events.on("errorPacket", (payload) => {
            if (payload.code === "UNKNOWN_TYPE") {
              finish({ ok: false, detail: "сервер устарел — обновите его" });
              return;
            }
            if (["NOT_ADMIN", "NO_SUCH_DEVICE", "CANNOT_REVOKE_SELF", "ALREADY_IN_STATE"].includes(payload.code)) {
              finish({ ok: false, detail: payload.message });
            }
          });

          if (!ws.revokeDevice(contact.deviceId, revoked)) {
            finish({ ok: false, detail: "пакет не удалось отправить" });
          }
        });
      },
      /**
       * Поиск человека по @тегу, почте или телефону.
       *
       * Сервер отвечает ровно одним результатом или ничем: поиск по части тега
       * позволил бы собрать всех участников, а этого в системе быть не должно.
       */
      async findUser(query) {
        const ws = wsRef.current;
        const trimmed = query.trim();
        if (trimmed.length === 0 || !ws || !(await ws.waitUntilReady(WAIT_READY_MS))) return null;

        return new Promise<FoundUser | null>((resolve) => {
          let settled = false;
          const finish = (result: FoundUser | null): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            offFound();
            offError();
            resolve(result);
          };
          const timer = setTimeout(() => finish(null), 12_000);
          const offFound = ws.events.on("userFound", (payload) => finish(payload.user));
          // Старый сервер не знает user.search и отвечает UNKNOWN_TYPE — без
          // этой ветки экран ждал бы таймаут молча.
          const offError = ws.events.on("errorPacket", (payload) => {
            if (payload.code === "UNKNOWN_TYPE") finish(null);
          });
          if (!ws.searchUser(trimmed)) finish(null);
        });
      },
      async addContact(user) {
        const ws = wsRef.current;
        if (!ws || !(await ws.waitUntilReady(WAIT_READY_MS))) {
          return { ok: false, detail: "нет соединения с сервером" };
        }

        return new Promise((resolve) => {
          let settled = false;
          const finish = (result: { ok: true } | { ok: false; detail: string }): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            offAdded();
            offError();
            resolve(result);
          };
          const timer = setTimeout(() => finish({ ok: false, detail: "сервер не ответил" }), 12_000);
          const offAdded = ws.events.on("contactAdded", (payload) => {
            if (payload.user.userId === user.userId) finish({ ok: true });
          });
          const offError = ws.events.on("errorPacket", (payload) => {
            if (payload.code === "UNKNOWN_TYPE") {
              finish({ ok: false, detail: "сервер устарел — обновите его" });
              return;
            }
            if (["CANNOT_ADD_SELF", "NO_SUCH_USER"].includes(payload.code)) {
              finish({ ok: false, detail: payload.message });
            }
          });
          if (!ws.addContact(user.userId)) finish({ ok: false, detail: "пакет не удалось отправить" });
        });
      },
      async changeUsername(next) {
        const ws = wsRef.current;
        if (!ws || !(await ws.waitUntilReady(WAIT_READY_MS))) {
          return { ok: false, detail: "нет соединения с сервером" };
        }

        return new Promise((resolve) => {
          let settled = false;
          const finish = (result: { ok: true } | { ok: false; detail: string }): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            offOk();
            offError();
            resolve(result);
          };
          const timer = setTimeout(() => finish({ ok: false, detail: "сервер не ответил" }), 12_000);
          const offOk = ws.events.on("usernameOk", (payload) => {
            setUsername(payload.username);
            // В identity тоже: тег показывается на экране контактов ещё до
            // подключения, из сохранённых данных.
            void saveIdentity({ ...identity, username: payload.username });
            finish({ ok: true });
          });
          const offError = ws.events.on("errorPacket", (payload) => {
            if (payload.code === "UNKNOWN_TYPE") {
              finish({ ok: false, detail: "сервер устарел — обновите его" });
              return;
            }
            if (["BAD_USERNAME", "USERNAME_TAKEN"].includes(payload.code)) {
              finish({ ok: false, detail: payload.message });
            }
          });
          if (!ws.setUsername(next.trim())) finish({ ok: false, detail: "пакет не удалось отправить" });
        });
      },
      async setNotificationsEnabled(enabled) {
        notificationsRef.current = enabled;
        setNotificationsEnabled(enabled);
        await setSetting(NOTIFICATIONS_SETTING, enabled ? "1" : "0");
        // Отметка обязательна: только она отличает выбор человека от значения,
        // записанного самим приложением (см. NOTIFICATIONS_CHOSEN_SETTING).
        await setSetting(NOTIFICATIONS_CHOSEN_SETTING, "1");
      },
      async setBackgroundEnabled(enabled) {
        backgroundRef.current = enabled;
        setBackgroundEnabled(enabled);
        await setSetting(BACKGROUND_SETTING, enabled ? "1" : "0");
        if (enabled) applyBackgroundMode(wsRef.current?.state === "connected");
        else stopBackgroundMode();
      },
      setActiveChat(chatId) {
        activeChatRef.current = chatId;
      },
      /**
       * Самопроверка отправки по шагам.
       *
       * Тот же путь, что у настоящего сообщения: крипто → соединение →
       * контакты → шифрование → запись в базу → ответ сервера. Нужна потому,
       * что «сообщения не идут» — это симптом сразу шести разных причин, и по
       * экрану они не отличаются. Ничего никому не отправляет: вместо msg.send
       * используется запрос истории, то есть проверяется тот же круг
       * «отправили пакет — сервер ответил», но без сообщения у собеседника.
       */
      async selfTest() {
        const steps: SelfTestStep[] = [];
        const add = (name: string, ok: boolean, detail = ""): void => {
          steps.push({ name, ok, detail });
        };

        const crypto = cryptoRef.current;
        add("Шифрование загружено", crypto !== null, crypto ? "" : "libsodium не инициализировался");

        const ws = wsRef.current;
        const ready = ws?.isReady() === true;
        add("Соединение с сервером", ready, ready ? "" : `состояние: ${ws?.state ?? "нет клиента"}`);

        const peers = contactsRef.current.filter((c) => !c.isRevoked);
        add("Участники получены", peers.length > 0, `известно: ${peers.length}`);

        // Уведомления сюда же: «не приходят» может означать и запрет системы, и
        // выключенный тумблер, а это разные действия.
        const permission = await getPermissionState();
        add(
          "Уведомления включены",
          notificationsRef.current && permission === "granted",
          `выключатель: ${notificationsRef.current ? "вкл" : "выкл"}, разрешение: ${permission}`,
        );

        // Работа в фоне: без неё уведомления приходят только пока приложение
        // открыто, и это отдельная причина от двух предыдущих.
        const bgAvailable = isBackgroundModeAvailable();
        add(
          "Работа в фоне",
          backgroundRef.current && bgAvailable && isBackgroundModeRunning(),
          !bgAvailable
            ? "нет в этой сборке — нужен новый APK"
            : `настройка: ${backgroundRef.current ? "вкл" : "выкл"}, служба: ${isBackgroundModeRunning() ? "работает" : "не запущена"}, соединение держит: ${connectionOwner() === "background" ? "фон" : connectionOwner() === "app" ? "экран" : "никто"}`,
        );

        // Нативные модули, добавленные позже сборки, — отдельная строка: их
        // отсутствие раньше валило приложение при запуске, а теперь просто
        // отключает функцию, и это должно быть видно, а не угадываться.
        add(
          "Нативные части на месте",
          isBackgroundModeAvailable() && isBiometricsSupported(),
          `фон: ${isBackgroundModeAvailable() ? "есть" : "нет"}, биометрия: ${isBiometricsSupported() ? "есть" : "нет"}${
            isBackgroundModeAvailable() && isBiometricsSupported() ? "" : " — нужен новый APK"
          }`,
        );

        const peer = peers[0];
        if (!crypto || !peer) return steps;

        const chatId = dmChatId(identity.userId, peer.userId);
        const encrypted = encryptForChat(crypto, identity, chatId, "самопроверка", new Map([[peer.userId, peer]]));
        add(
          "Сообщение шифруется",
          !("error" in encrypted),
          "error" in encrypted ? encrypted.error : `для ${peer.displayName}`,
        );

        // Запись и чтение назад — ровно то, что делает отправка перед уходом
        // пакета. Строку сразу удаляем, чтобы не оставлять мусор в переписке.
        const probeId = `selftest-${uuidv4()}`;
        try {
          await insertMessage({
            id: probeId,
            clientMsgId: probeId,
            chatId,
            fromUserId: identity.userId,
            contentType: "text",
            plaintext: "самопроверка",
            replyTo: null,
            status: "pending",
            createdAt: Date.now(),
            deletedAt: null,
          });
          const found = (await listMessagesForChat(chatId)).some((m) => m.id === probeId);
          add("Локальная база пишется", found, found ? "" : "запись не нашлась после вставки");
        } catch (error) {
          add("Локальная база пишется", false, error instanceof Error ? error.message : String(error));
        } finally {
          await hardDeleteMessage(probeId).catch(() => undefined);
        }

        if (!ws || !ready) return steps;

        // Круг «отправили пакет — сервер ответил». Если он не проходит, то и
        // msg.send не дойдёт, сколько бы «на связи» ни показывал экран.
        const answered = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => finish(false), 8000);
          const finish = (result: boolean): void => {
            clearTimeout(timer);
            offPage();
            offError();
            resolve(result);
          };
          const offPage = ws.events.on("historyPage", () => finish(true));
          const offError = ws.events.on("errorPacket", () => finish(false));
          // Курсор из будущего: нужен сам факт ответа сервера, а не сообщения.
          ws.fetchHistory(chatId, { ts: Date.now(), id: null });
        });
        add("Сервер отвечает на запросы", answered, answered ? "" : "ответа нет за 8 секунд");

        return steps;
      },
      async createInvite() {
        const ws = wsRef.current;
        if (!ws) return { ok: false, reason: "OFFLINE" };

        // Раньше здесь была мгновенная проверка isOpen(): если сокет умер в
        // фоне (обычное дело на Android), экран сразу писал «нет соединения».
        // Теперь сначала пробуем переподключиться и подождать авторизацию.
        if (!(await ws.waitUntilReady(WAIT_READY_MS))) {
          // Причину берём из клиента, а не из состояния React: она появляется
          // уже во время ожидания, и замыкание экрана её бы не увидело.
          return { ok: false, reason: "OFFLINE", detail: describeFailure(ws.failure) };
        }

        return new Promise<CreateInviteResult>((resolve) => {
          let settled = false;
          const finish = (result: CreateInviteResult): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            offCreated();
            offError();
            resolve(result);
          };

          const timeout = setTimeout(() => finish({ ok: false, reason: "TIMEOUT" }), 12_000);

          const offCreated = ws.events.on("inviteCreated", (payload) => finish({ ok: true, invite: payload }));

          // Старая версия сервера не знает пакет invite.create и отвечает
          // UNKNOWN_TYPE — без этой ветки экран ждал бы таймаут и не объяснил,
          // что именно нужно сделать (обновить сервер).
          const offError = ws.events.on("errorPacket", (payload) => {
            if (payload.code === "UNKNOWN_TYPE") finish({ ok: false, reason: "SERVER_OUTDATED" });
          });

          if (!ws.requestInvite()) finish({ ok: false, reason: "OFFLINE" });
        });
      },
    };
    // Только стабильные зависимости: identity не меняется за жизнь провайдера,
    // chatEvents и applyBackgroundMode созданы через useMemo/useCallback без
    // зависимостей, остальное — рефы.
  }, [identity, chatEvents, applyBackgroundMode, markChatReadIfVisible]);

  const value = useMemo<AppContextValue>(
    () => ({
      identity,
      connectionState,
      connectionFailure,
      contacts,
      presence,
      chatEvents,
      myFingerprint,
      notificationsEnabled,
      displayName,
      username,
      isAdmin,
      backgroundEnabled,
      backgroundAvailable: isBackgroundModeAvailable(),
      ...actions,
    }),
    [
      identity,
      connectionState,
      connectionFailure,
      contacts,
      presence,
      chatEvents,
      myFingerprint,
      notificationsEnabled,
      displayName,
      username,
      isAdmin,
      backgroundEnabled,
      actions,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** true, если сообщение действительно добавлено (а не было уже известно). */
/**
 * Разбор входящего сообщения: расшифровать, записать, подтвердить, уведомить.
 *
 * Экспортируется, потому что этим же занимается соединение без экрана
 * (src/background/task.ts): когда приложение смахнули из недавних, сообщения
 * принимает headless-задача службы, а разбирать их должен ровно тот же код.
 */
export async function handleIncomingMessage(
  crypto: Crypto,
  ws: WsClient,
  identity: DeviceIdentity,
  payload: MsgDeliverPayload,
  chatEvents: Emitter<ChatEvents>,
  options: {
    skipAck?: boolean;
    silent?: boolean;
    contacts?: Contact[];
    notify?: (contentType: string, plaintext: string | null) => void;
  } = {},
): Promise<boolean> {
  if (await messageExists(payload.msgId)) return false;

  // Контакты берём из памяти: обращение к sqlite на каждое входящее сообщение
  // заметно тормозило разбор истории.
  const contactsList = options.contacts ?? (await listContacts());
  const contactsByUserId = new Map(contactsList.map((c) => [c.userId, c]));
  const decrypted = decryptDeliveredMessage(crypto, identity, payload, contactsByUserId);

  // Для медиа конверт содержит сырые base64-данные — на диск пишем один раз,
  // в sqlite кладём только метаданные (см. src/chat/media.ts).
  const plaintext =
    decrypted && MEDIA_CONTENT_TYPES.has(payload.contentType)
      ? JSON.stringify(saveIncomingEnvelope(decrypted, payload.msgId))
      : decrypted;

  await insertMessage({
    id: payload.msgId,
    clientMsgId: payload.msgId,
    chatId: payload.chatId,
    fromUserId: payload.fromUserId,
    contentType: payload.contentType,
    plaintext,
    replyTo: payload.replyTo,
    status: payload.fromUserId === identity.userId ? "sent" : "delivered",
    createdAt: payload.ts,
    deletedAt: null,
  });
  if (!options.silent) chatEvents.emit("messageInserted", payload.chatId);
  options.notify?.(payload.contentType, plaintext);

  if (!options.skipAck && payload.fromUserId !== identity.userId) {
    if (!ws.ackMessage(payload.msgId, payload.chatId, "delivered")) {
      await queueAck({ msgId: payload.msgId, chatId: payload.chatId, status: "delivered" });
    }
  }
  return true;
}
