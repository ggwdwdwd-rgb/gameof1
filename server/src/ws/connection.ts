import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { FastifyBaseLogger } from "fastify";
import { randomNonceB64 } from "../crypto/verify.js";
import { handleAuthResponse } from "./handlers/auth.js";
import { recipientDeviceIds } from "./handlers/chat.js";
import { handleInviteRedeem } from "./handlers/invite.js";
import { createInvite } from "../invites.js";
import { handleHistoryFetch, handleMsgAck, handleMsgDelete, handleMsgSend } from "./handlers/message.js";
import { getContactsFor, touchLastSeen } from "./handlers/roster.js";
import { updateDisplayName } from "./handlers/profile.js";
import { findDevice, setDeviceRevoked } from "../devices.js";
import { backupInfo, deleteBackup, getBackup, MAX_BACKUP_BYTES, putBackup } from "../backups.js";
import {
  accountOf,
  contactIdsOf,
  linkContacts,
  login,
  publicUser,
  register,
  searchUser,
  setUsername,
  VALIDATION_MESSAGES,
} from "../accounts.js";
import { deviceIdsOf, isAdmin, removeUser, userExists, wouldLeaveNoAdmin } from "../users.js";
import {
  broadcastToUsers,
  closeDevices,
  hasOtherConnections,
  isUserOnline,
  setConnectionActive,
  registerConnection,
  send,
  sendToDevice,
  unregisterConnection,
} from "./registry.js";
import {
  isEnvelope,
  type AuthLoginPayload,
  type AuthRegisterPayload,
  type AuthResponsePayload,
  type ContactAddPayload,
  type Envelope,
  type HistoryFetchPayload,
  type InviteCreatePayload,
  type InviteRedeemPayload,
  type MsgAckPayload,
  type MsgDeletePayload,
  type DeviceRevokePayload,
  type MemberRemovePayload,
  type BackupPutPayload,
  type MsgSendPayload,
  type PresenceSetPayload,
  type ProfileUpdatePayload,
  type TypingPayload,
  type UsernameSetPayload,
  type UserSearchPayload,
} from "./types.js";

type ConnState =
  | { stage: "awaiting_auth"; nonce: string }
  | { stage: "authenticated"; userId: string; deviceId: string };

function envelope(type: string, payload: unknown): Envelope {
  return { v: 1, type, id: randomUUID(), ts: Date.now(), payload: payload as object };
}

export function handleConnection(socket: WebSocket, log: FastifyBaseLogger): void {
  let state: ConnState | null = null;

  void (async () => {
    const nonce = await randomNonceB64();
    state = { stage: "awaiting_auth", nonce };
    send(socket, envelope("auth.challenge", { nonce }));
  })();

  socket.on("message", (raw: Buffer) => {
    void (async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString("utf-8"));
      } catch {
        send(socket, envelope("error", { code: "BAD_JSON", message: "Не удалось разобрать пакет" }));
        return;
      }

      if (!isEnvelope(parsed)) {
        send(socket, envelope("error", { code: "BAD_ENVELOPE", message: "Неверный формат пакета" }));
        return;
      }

      if (!state) return; // защита от гонки, до инициализации состояния сообщения не приходят

      if (state.stage === "awaiting_auth") {
        if (parsed.type === "auth.response") {
          const payload = parsed.payload as AuthResponsePayload;
          const result = await handleAuthResponse(payload.deviceId, payload.signature, state.nonce);
          if (!result.ok) {
            // Отказ логируем: раньше он не оставлял в логах никакого следа, и
            // «устройство не может подключиться» было не отличить от «клиент
            // вообще не доходит до сервера».
            log.warn({ deviceId: payload.deviceId, code: result.code }, "отказ в аутентификации устройства");
            send(socket, envelope("auth.error", result));
            return;
          }
          state = { stage: "authenticated", userId: result.userId, deviceId: result.deviceId };
          registerConnection(result.deviceId, result.userId, socket);
          touchLastSeen(result.userId);
          // isAdmin — чтобы клиент знал, показывать ли удаление участников.
          // Признак вычисляется сервером: доверять клиенту в этом нельзя, но и
          // прятать его незачем — проверка всё равно повторяется при удалении.
          send(
            socket,
            envelope("auth.ok", {
              userId: result.userId,
              deviceId: result.deviceId,
              serverTime: Date.now(),
              isAdmin: isAdmin(result.userId),
            }),
          );
          // roster формируем уже после registerConnection, иначе сам подключившийся
          // не увидел бы себя онлайн у остальных в первый момент.
          send(socket, envelope("roster.snapshot", { members: getContactsFor(result.userId, result.deviceId) }));
          // Присутствие — только контактам. Раньше уходило всем подключённым, то
          // есть посторонний, создавший аккаунт, светился у каждого.
          broadcastToUsers(
            contactIdsOf(result.userId),
            envelope("presence", { userId: result.userId, online: true, lastSeenAt: null }),
            result.deviceId,
          );
          log.info({ userId: result.userId, deviceId: result.deviceId }, "устройство аутентифицировано");
          return;
        }

        if (parsed.type === "invite.redeem") {
          const payload = parsed.payload as InviteRedeemPayload;
          const result = handleInviteRedeem(payload);
          if (!result.ok) {
            log.warn({ code: result.code }, "отказ по коду приглашения");
            send(socket, envelope("invite.redeem.error", result));
            return;
          }
          state = { stage: "authenticated", userId: result.userId, deviceId: payload.deviceId };
          registerConnection(payload.deviceId, result.userId, socket);
          touchLastSeen(result.userId);
          // Вошедший по коду становится контактом того, кто код выпустил, — и
          // только его. Общего списка участников больше нет, поэтому «показать
          // всем» здесь означало бы вернуть прежнее «все видят всех».
          if (result.invitedBy !== null) linkContacts(result.userId, result.invitedBy);

          send(socket, envelope("invite.redeem.ok", { userId: result.userId, isAdmin: isAdmin(result.userId) }));
          send(socket, envelope("roster.snapshot", { members: getContactsFor(result.userId, payload.deviceId) }));

          if (result.invitedBy !== null) {
            broadcastToUsers(
              [result.invitedBy],
              envelope("member.joined", {
                userId: result.userId,
                deviceId: payload.deviceId,
                displayName: payload.displayName,
                username: null,
                identityPublicKey: payload.identityPublicKey,
                encryptionPublicKey: payload.encryptionPublicKey,
                joinedAt: Date.now(),
              }),
            );
            // Присутствие отдельно: member.joined говорит «появился контакт», но
            // не «он сейчас в сети», а клиент ведёт эти состояния раздельно.
            broadcastToUsers(
              [result.invitedBy],
              envelope("presence", { userId: result.userId, online: true, lastSeenAt: null }),
            );
          }
          log.info({ userId: result.userId }, "новый участник зарегистрирован по инвайту");
          return;
        }

        /**
         * Регистрация аккаунта — основной путь вместо одноразового кода.
         *
         * Никого ни о чём не оповещаем: у нового аккаунта нет контактов, и
         * показывать его кому-либо нельзя. Именно этим свободная регистрация
         * отличается от прежних инвайтов.
         */
        if (parsed.type === "auth.register") {
          const payload = parsed.payload as AuthRegisterPayload;
          const result = await register({
            email: payload.email,
            password: payload.password,
            username: payload.username,
            displayName: payload.displayName,
            phone: payload.phone,
            deviceId: payload.deviceId,
            identityPublicKey: payload.identityPublicKey,
            encryptionPublicKey: payload.encryptionPublicKey,
          });
          if (!result.ok) {
            log.warn({ code: result.code }, "отказ в регистрации");
            send(
              socket,
              envelope("auth.register.error", { code: result.code, message: VALIDATION_MESSAGES[result.code] }),
            );
            return;
          }
          state = { stage: "authenticated", userId: result.account.userId, deviceId: payload.deviceId };
          registerConnection(payload.deviceId, result.account.userId, socket);
          touchLastSeen(result.account.userId);
          send(
            socket,
            envelope("auth.register.ok", {
              userId: result.account.userId,
              username: result.account.username,
              displayName: result.account.displayName,
              isAdmin: result.account.isAdmin,
              serverTime: Date.now(),
            }),
          );
          // Пустой список — но отправить его нужно: клиент ждёт снимок, чтобы
          // понять, что подключение завершилось.
          send(socket, envelope("roster.snapshot", { members: [] }));
          log.info({ userId: result.account.userId }, "зарегистрирован аккаунт");
          return;
        }

        /** Вход по почте и паролю: привязывает это устройство к аккаунту. */
        if (parsed.type === "auth.login") {
          const payload = parsed.payload as AuthLoginPayload;
          const result = await login({
            email: payload.email,
            password: payload.password,
            deviceId: payload.deviceId,
            identityPublicKey: payload.identityPublicKey,
            encryptionPublicKey: payload.encryptionPublicKey,
          });
          if (!result.ok) {
            log.warn({ code: result.code }, "отказ во входе");
            send(
              socket,
              envelope("auth.login.error", {
                code: result.code,
                message:
                  result.code === "NO_PASSWORD"
                    ? "У этого аккаунта нет пароля: он был создан по коду приглашения. Войдите с прежнего устройства и задайте пароль."
                    : "Неверная почта или пароль",
              }),
            );
            return;
          }
          state = { stage: "authenticated", userId: result.account.userId, deviceId: payload.deviceId };
          registerConnection(payload.deviceId, result.account.userId, socket);
          touchLastSeen(result.account.userId);
          send(
            socket,
            envelope("auth.login.ok", {
              userId: result.account.userId,
              username: result.account.username,
              displayName: result.account.displayName,
              isAdmin: result.account.isAdmin,
              serverTime: Date.now(),
            }),
          );
          send(
            socket,
            envelope("roster.snapshot", { members: getContactsFor(result.account.userId, payload.deviceId) }),
          );
          // Прежний телефон отключаем сразу: доступ у него отозван, и оставлять
          // ему живое соединение значило бы продолжать слать туда пакеты.
          if (result.revokedDeviceIds.length > 0) {
            closeDevices(result.revokedDeviceIds, "вход выполнен на другом устройстве");
          }
          /**
           * Контактам рассылаем НОВЫЕ ключи устройства.
           *
           * Это обязательная часть входа, а не уведомление: сообщение шифруется
           * под X25519-ключ конкретного устройства, и пока у отправителя лежит
           * ключ прежнего телефона, всё написанное новому телефону расшифровать
           * нечем. Без этой рассылки «вход с нового телефона» выглядел бы как
           * «сообщения приходят, но не читаются» — до случайного переподключения
           * отправителя, который получил бы свежий roster.snapshot.
           *
           * Пакет тот же member.joined: клиент по нему перезаписывает контакт
           * целиком, вместе с deviceId и ключами.
           */
          broadcastToUsers(
            contactIdsOf(result.account.userId),
            envelope("member.joined", {
              userId: result.account.userId,
              deviceId: payload.deviceId,
              displayName: result.account.displayName,
              username: result.account.username,
              identityPublicKey: payload.identityPublicKey,
              encryptionPublicKey: payload.encryptionPublicKey,
              joinedAt: Date.now(),
              // Признак обязателен именно здесь: клиент при его отсутствии
              // оставляет прежнее значение, и человек, чей телефон когда-то
              // отзывали, навсегда остался бы у контактов «отозванным» — то
              // есть с чатом только для чтения, хотя он уже вошёл заново.
              revoked: false,
            }),
            payload.deviceId,
          );
          // Контактам сообщаем, что человек в сети: для них он не новый.
          broadcastToUsers(
            contactIdsOf(result.account.userId),
            envelope("presence", { userId: result.account.userId, online: true, lastSeenAt: null }),
            payload.deviceId,
          );
          log.info(
            { userId: result.account.userId, revoked: result.revokedDeviceIds.length },
            "вход по почте, устройство привязано",
          );
          return;
        }

        send(
          socket,
          envelope("error", {
            code: "NOT_AUTHENTICATED",
            message: "Сначала auth.register, auth.login или auth.response",
          }),
        );
        return;
      }

      // authenticated
      const { userId, deviceId } = state;

      if (parsed.type === "ping") {
        send(socket, envelope("pong", {}));
        return;
      }

      /**
       * Поиск человека по @тегу, почте или телефону.
       *
       * Только точное совпадение и только один результат. Поиск по части тега
       * позволил бы обойти сервер и собрать всех участников — то есть вернул бы
       * ровно то, от чего мы ушли, убрав общий roster.
       */
      if (parsed.type === "user.search") {
        const payload = parsed.payload as UserSearchPayload;
        const found = searchUser(payload.query, userId);
        send(socket, envelope("user.found", { user: found }));
        return;
      }

      /**
       * Добавление найденного человека в контакты.
       *
       * Связь сразу взаимная: чтобы ответить, второй стороне нужны публичные
       * ключи первой, а сам человек должен увидеть чат, а не молчащее ничто.
       * Согласия не спрашиваем — как в любом мессенджере, где можно написать
       * первым.
       */
      if (parsed.type === "contact.add") {
        const payload = parsed.payload as ContactAddPayload;
        if (payload.userId === userId) {
          send(socket, envelope("error", { code: "CANNOT_ADD_SELF", message: "Себя добавить нельзя" }));
          return;
        }
        const peer = publicUser(payload.userId);
        if (!peer) {
          send(socket, envelope("error", { code: "NO_SUCH_USER", message: "Такого участника нет" }));
          return;
        }
        linkContacts(userId, payload.userId);

        // Себе отдаём карточку добавленного, а ему — свою: обе стороны должны
        // получить ключи, иначе переписку нечем шифровать.
        send(socket, envelope("contact.added", { user: peer, online: isUserOnline(payload.userId) }));
        const me = publicUser(userId);
        if (me) {
          broadcastToUsers([payload.userId], envelope("contact.added", { user: me, online: true }));
        }
        log.info({ userId, added: payload.userId }, "контакт добавлен");
        return;
      }

      /**
       * Резервная копия переписки.
       *
       * Сервер только хранит блоб: он зашифрован кодовой фразой, которая никуда
       * не отправляется. Прочитать копию сервер не может — тот же принцип, что с
       * сообщениями.
       */
      if (parsed.type === "backup.put") {
        const payload = parsed.payload as BackupPutPayload;
        const result = putBackup(userId, typeof payload.blob === "string" ? payload.blob : "");
        if (!result.ok) {
          send(
            socket,
            envelope("error", {
              code: result.code,
              message:
                result.code === "TOO_LARGE"
                  ? `Копия больше ${Math.round(MAX_BACKUP_BYTES / (1024 * 1024))} МБ`
                  : "Копия пустая",
            }),
          );
          return;
        }
        send(socket, envelope("backup.ok", result.info));
        log.info({ userId, sizeBytes: result.info.sizeBytes }, "сохранена резервная копия");
        return;
      }

      if (parsed.type === "backup.get") {
        const stored = getBackup(userId);
        send(
          socket,
          envelope("backup.blob", {
            blob: stored?.blob ?? null,
            updatedAt: stored?.info.updatedAt ?? null,
            sizeBytes: stored?.info.sizeBytes ?? null,
          }),
        );
        return;
      }

      /** Сведения без самой копии — чтобы показать «последняя копия: …». */
      if (parsed.type === "backup.info") {
        const info = backupInfo(userId);
        send(socket, envelope("backup.info.ok", { updatedAt: info?.updatedAt ?? null, sizeBytes: info?.sizeBytes ?? null }));
        return;
      }

      if (parsed.type === "backup.delete") {
        deleteBackup(userId);
        send(socket, envelope("backup.ok", { sizeBytes: 0, updatedAt: 0 }));
        return;
      }

      /** Смена своего @тега. */
      if (parsed.type === "username.set") {
        const payload = parsed.payload as UsernameSetPayload;
        const error = setUsername(userId, payload.username);
        if (error !== null) {
          send(socket, envelope("error", { code: error, message: VALIDATION_MESSAGES[error] }));
          return;
        }
        const account = accountOf(userId);
        send(socket, envelope("username.ok", { username: account?.username ?? null }));
        // Тег виден контактам в карточке — сообщаем им, но никому больше.
        broadcastToUsers(
          contactIdsOf(userId),
          envelope("member.updated", { userId, displayName: account?.displayName ?? "", username: account?.username ?? null }),
        );
        return;
      }

      if (parsed.type === "invite.create") {
        const { ttlHours } = parsed.payload as InviteCreatePayload;
        const invite = createInvite(userId, ttlHours);
        send(socket, envelope("invite.created", invite));
        log.info({ userId }, "выпущен инвайт-код");
        return;
      }

      if (parsed.type === "msg.send") {
        const payload = parsed.payload as MsgSendPayload;
        const result = handleMsgSend(userId, deviceId, payload);
        // Написал — значит вы контакты. Страховка на случай, если клиент
        // отправил, не позвав contact.add: без связи получатель не увидел бы
        // человека в списке после перезапуска, хотя переписка уже есть.
        if (result.ok && !result.duplicate) {
          for (const recipient of result.recipients) linkContacts(userId, recipient);
        }
        if (!result.ok) {
          send(socket, envelope("error", { code: result.code, message: "Сообщение не принято" }));
          return;
        }
        send(
          socket,
          envelope("msg.accepted", {
            clientMsgId: payload.clientMsgId,
            msgId: result.message.msgId,
            chatId: payload.chatId,
            // Время присвоено сервером. Отправитель обязан переписать им своё
            // локальное: иначе порядок сообщений у собеседников расходится —
            // у отправителя своё сообщение стоит по часам его телефона, а у
            // получателя по серверным, и при расхождении часов переписка
            // выглядит по-разному с двух сторон.
            ts: result.message.ts,
          }),
        );
        // Повтор уже принятого сообщения подтверждаем, но не рассылаем заново,
        // иначе у получателя оно продублировалось бы после каждого реконнекта.
        if (result.duplicate) return;
        for (const recipientDeviceId of recipientDeviceIds(payload.chatId, userId)) {
          sendToDevice(recipientDeviceId, envelope("msg.deliver", result.message));
        }
        return;
      }

      if (parsed.type === "msg.ack") {
        const payload = parsed.payload as MsgAckPayload;
        const result = handleMsgAck(userId, payload);
        if (result) {
          sendToDevice(
            result.fromDeviceId,
            envelope("msg.ackRelay", { msgId: payload.msgId, chatId: payload.chatId, byUserId: userId, status: payload.status, ts: Date.now() }),
          );
        }
        return;
      }

      if (parsed.type === "msg.delete") {
        const payload = parsed.payload as MsgDeletePayload;
        const result = handleMsgDelete(userId, payload);
        if (!result.ok) {
          send(socket, envelope("error", { code: result.code, message: "Сообщение не удалено" }));
          return;
        }
        for (const recipientDeviceId of recipientDeviceIds(result.chatId, userId)) {
          sendToDevice(recipientDeviceId, envelope("msg.deleted", { msgId: payload.msgId, chatId: result.chatId, byUserId: userId }));
        }
        send(socket, envelope("msg.deleted", { msgId: payload.msgId, chatId: result.chatId, byUserId: userId }));
        return;
      }

      /**
       * Клиент сообщает, смотрит ли человек на телефон.
       *
       * До работы в фоне «в сети» означало «есть соединение», и этого хватало:
       * свёрнутое приложение Android быстро выгружал. Со службой переднего плана
       * соединение живёт всегда, поэтому теперь активность приходит явно —
       * иначе человек висел бы «в сети» с погашенным экраном в кармане.
       */
      if (parsed.type === "presence.set") {
        const payload = parsed.payload as PresenceSetPayload;
        if (!setConnectionActive(deviceId, payload.active === true)) return;
        // Рассылаем только если состояние участника целиком изменилось: при
        // двух устройствах уход одного в фон ещё не значит, что человек ушёл.
        const online = isUserOnline(userId);
        const lastSeenAt = online ? null : touchLastSeen(userId);
        broadcastToUsers(contactIdsOf(userId), envelope("presence", { userId, online, lastSeenAt }), deviceId);
        return;
      }

      if (parsed.type === "device.revoke") {
        const payload = parsed.payload as DeviceRevokePayload;
        if (!isAdmin(userId)) {
          send(socket, envelope("error", { code: "NOT_ADMIN", message: "Отзывать доступ может только главный участник" }));
          return;
        }
        const device = findDevice(payload.deviceId);
        if (!device) {
          send(socket, envelope("error", { code: "NO_SUCH_DEVICE", message: "Такого устройства нет" }));
          return;
        }
        // Своё устройство отзывать нельзя: главный лишил бы себя доступа, и
        // вернуть право было бы нечем, кроме командной строки на сервере.
        if (device.userId === userId) {
          send(socket, envelope("error", { code: "CANNOT_REVOKE_SELF", message: "Своё устройство отозвать нельзя" }));
          return;
        }
        if (!setDeviceRevoked(payload.deviceId, payload.revoked === true)) {
          send(socket, envelope("error", { code: "ALREADY_IN_STATE", message: "Устройство уже в этом состоянии" }));
          return;
        }

        // Кругу контактов отозванного плюс самому администратору: он ждёт
        // подтверждения своего же действия, а его контактом человек может и не
        // быть.
        broadcastToUsers(
          [...contactIdsOf(device.userId), userId],
          envelope("member.revoked", { userId: device.userId, deviceId: device.id, revoked: payload.revoked === true }),
        );
        // Соединение отозванного устройства рвём сразу: иначе оно продолжало бы
        // получать сообщения до собственного переподключения — а именно от этого
        // отзыв и должен защищать.
        if (payload.revoked === true) closeDevices([device.id], "доступ устройства отозван");
        log.warn({ deviceId: device.id, revoked: payload.revoked === true, by: userId }, "изменён доступ устройства");
        return;
      }

      if (parsed.type === "member.remove") {
        const payload = parsed.payload as MemberRemovePayload;
        // Право одно и только одно: распоряжаться составом может тот, кто
        // поднял сервер, то есть первый зарегистрированный участник.
        if (!isAdmin(userId)) {
          send(socket, envelope("error", { code: "NOT_ADMIN", message: "Удалять участников может только первый участник" }));
          return;
        }
        if (payload.userId === userId) {
          send(socket, envelope("error", { code: "CANNOT_REMOVE_SELF", message: "Себя удалить нельзя" }));
          return;
        }
        if (!userExists(payload.userId)) {
          send(socket, envelope("error", { code: "NO_SUCH_USER", message: "Такого участника нет" }));
          return;
        }
        // Без главного система становится тупиком: вернуть право можно было бы
        // только правкой базы руками.
        if (wouldLeaveNoAdmin(payload.userId)) {
          send(
            socket,
            envelope("error", {
              code: "LAST_ADMIN",
              message: "Это единственный главный участник — сначала назначьте главным другого",
            }),
          );
          return;
        }

        // deviceId и контакты собираем до удаления: после него в базе их уже не найти.
        const devices = deviceIdsOf(payload.userId);
        const contactsOfRemoved = contactIdsOf(payload.userId);
        const stats = removeUser(payload.userId);
        // Сначала оповещаем остальных, потом рвём соединения удалённого:
        // иначе он получил бы сообщение о собственном удалении и обиделся бы
        // зря — а главное, порядок здесь не важен никому, кроме читателя.
        // Контакты собираем ДО удаления: после него связей в базе уже нет.
        broadcastToUsers([...contactsOfRemoved, userId], envelope("member.removed", { userId: payload.userId }));
        closeDevices(devices);
        log.warn({ userId: payload.userId, by: userId, ...stats }, "участник удалён");
        return;
      }

      if (parsed.type === "profile.update") {
        const payload = parsed.payload as ProfileUpdatePayload;
        const displayName = updateDisplayName(userId, payload.displayName);
        if (displayName === null) {
          send(socket, envelope("error", { code: "BAD_NAME", message: "Имя должно быть от 1 до 40 символов" }));
          return;
        }
        // Имя видят все участники, поэтому рассылаем всем, включая другие
        // устройства автора.
        // Себе тоже: имя меняют с одного устройства, а показать его должны все
        // свои. Плюс контактам — и никому больше.
        const updated = accountOf(userId);
        broadcastToUsers(
          [...contactIdsOf(userId), userId],
          envelope("member.updated", { userId, displayName, username: updated?.username ?? null }),
        );
        log.info({ userId }, "участник сменил имя");
        return;
      }

      if (parsed.type === "typing") {
        const payload = parsed.payload as TypingPayload;
        for (const recipientDeviceId of recipientDeviceIds(payload.chatId, userId)) {
          sendToDevice(recipientDeviceId, envelope("typing.relay", { chatId: payload.chatId, fromUserId: userId, isTyping: payload.isTyping }));
        }
        return;
      }

      if (parsed.type === "history.fetch") {
        const payload = parsed.payload as HistoryFetchPayload;
        const messages = handleHistoryFetch(userId, payload);
        if (messages === null) {
          send(socket, envelope("error", { code: "NOT_PARTICIPANT", message: "Нет доступа к этому чату" }));
          return;
        }
        send(socket, envelope("history.page", { chatId: payload.chatId, messages, nextCursor: null }));
        return;
      }

      send(socket, envelope("error", { code: "UNKNOWN_TYPE", message: `Неизвестный тип пакета: ${parsed.type}` }));
    })().catch((err: unknown) => {
      log.error({ err }, "ошибка обработки WS-пакета");
    });
  });

  socket.on("close", () => {
    if (state?.stage !== "authenticated") return;
    const { userId, deviceId } = state;
    unregisterConnection(deviceId);
    // «Не в сети» объявляем только когда у участника не осталось соединений:
    // при двух устройствах закрытие одного не означает, что человек ушёл.
    if (hasOtherConnections(userId, deviceId)) return;
    const lastSeenAt = touchLastSeen(userId);
    broadcastToUsers(contactIdsOf(userId), envelope("presence", { userId, online: false, lastSeenAt }));
  });
}
