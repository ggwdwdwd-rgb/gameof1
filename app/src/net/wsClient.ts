import { getCrypto } from "../crypto/sodium";
import { enqueueOutbox, listOutbox, removeFromOutbox } from "../db/outbox";
import { Emitter } from "../util/emitter";
import { uuidv4 } from "../util/uuid";
import {
  isEnvelope,
  type AuthChallengePayload,
  type AuthErrorPayload,
  type AuthOkPayload,
  type ErrorPayload,
  type HistoryPagePayload,
  type InviteCreatedPayload,
  type InviteRedeemErrorPayload,
  type InviteRedeemOkPayload,
  type MemberJoinedPayload,
  type MsgAcceptedPayload,
  type MsgAckRelayPayload,
  type MsgDeletedPayload,
  type MsgDeliverPayload,
  type MsgSendPayload,
  type RosterSnapshotPayload,
  type TypingRelayPayload,
} from "./protocol";

export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting";

/**
 * Почему соединение не работает. Раньше любая причина выглядела для
 * пользователя одинаково («нет соединения»), хотя отказ сервера в
 * аутентификации и недоступный домен требуют совершенно разных действий.
 */
export type ConnectionFailure =
  | { kind: "auth"; code: string }
  | { kind: "network"; detail: string }
  /** Приложение не смогло инициализироваться — соединение даже не начиналось. */
  | { kind: "fatal"; detail: string };

export type AuthMode =
  | { kind: "device"; deviceId: string; identitySecretKey: string }
  | {
      kind: "invite";
      code: string;
      deviceId: string;
      displayName: string;
      identityPublicKey: string;
      encryptionPublicKey: string;
    };

interface WsClientEvents extends Record<string, (...args: never[]) => void> {
  state: (state: ConnectionState) => void;
  failure: (failure: ConnectionFailure) => void;
  authOk: (payload: AuthOkPayload) => void;
  authError: (payload: AuthErrorPayload) => void;
  inviteOk: (payload: InviteRedeemOkPayload) => void;
  inviteError: (payload: InviteRedeemErrorPayload) => void;
  inviteCreated: (payload: InviteCreatedPayload) => void;
  roster: (payload: RosterSnapshotPayload) => void;
  memberJoined: (payload: MemberJoinedPayload) => void;
  msgDeliver: (payload: MsgDeliverPayload) => void;
  msgAccepted: (payload: MsgAcceptedPayload) => void;
  ackRelay: (payload: MsgAckRelayPayload) => void;
  msgDeleted: (payload: MsgDeletedPayload) => void;
  typingRelay: (payload: TypingRelayPayload) => void;
  historyPage: (payload: HistoryPagePayload) => void;
  errorPacket: (payload: ErrorPayload) => void;
}

const PING_INTERVAL_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const TYPING_THROTTLE_MS = 2_000;

/**
 * Один WS-клиент на приложение: авторизация (по подписи либо по инвайту),
 * реконнект с экспоненциальной задержкой, keepalive-пинги, очередь исходящих
 * (outbox в sqlite — переживает обрыв связи и перезапуск приложения).
 */
export class WsClient {
  readonly events = new Emitter<WsClientEvents>();
  state: ConnectionState = "idle";

  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUser = false;
  private lastTypingSentAt = 0;
  private lastPongAt = 0;
  private lastSocketError = "";
  /** Последняя причина отказа — читается экранами, чтобы объяснить проблему. */
  failure: ConnectionFailure | null = null;

  constructor(
    private readonly serverUrl: string,
    private readonly authMode: AuthMode,
  ) {}

  connect(): void {
    this.closedByUser = false;
    this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    const ws = new WebSocket(this.serverUrl);
    this.ws = ws;
    ws.onmessage = (event) => {
      void this.handleMessage(String(event.data));
    };
    ws.onclose = (event) => this.handleClose(event);
    ws.onerror = (event) => {
      // onclose вызовется следом — реконнект и разбор причины там. Здесь только
      // запоминаем текст ошибки: без него причина отказа была неизвестна.
      const message = (event as { message?: unknown }).message;
      this.lastSocketError = typeof message === "string" ? message : "";
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  /** Отправка через outbox — переживает офлайн и перезапуск приложения (см. ARCHITECTURE.md §6). */
  async sendMessage(payload: MsgSendPayload): Promise<void> {
    const envelope = { v: 1 as const, type: "msg.send", id: uuidv4(), ts: Date.now(), payload };
    await enqueueOutbox(payload.clientMsgId, envelope);
    this.trySendRaw(envelope);
  }

  ackMessage(msgId: string, chatId: string, status: "delivered" | "read"): void {
    if (this.ws) this.rawSend(this.ws, "msg.ack", { msgId, chatId, status });
  }

  /**
   * Троттлинг: раньше пакет уходил на каждое нажатие клавиши. Теперь "печатает"
   * отправляется не чаще раза в 2 секунды, а "перестал печатать" — всегда.
   */
  sendTyping(chatId: string, isTyping: boolean): void {
    if (!this.ws) return;
    if (isTyping) {
      const now = Date.now();
      if (now - this.lastTypingSentAt < TYPING_THROTTLE_MS) return;
      this.lastTypingSentAt = now;
    } else {
      this.lastTypingSentAt = 0;
    }
    this.rawSend(this.ws, "typing", { chatId, isTyping });
  }

  /** false, если пакет не удалось отправить (нет открытого соединения). */
  requestInvite(ttlHours?: number): boolean {
    if (!this.ws) return false;
    return this.rawSend(this.ws, "invite.create", ttlHours ? { ttlHours } : {});
  }

  fetchHistory(chatId: string, sinceTs: number): void {
    if (this.ws) this.rawSend(this.ws, "history.fetch", { chatId, sinceTs, limit: 200 });
  }

  deleteMessage(msgId: string, chatId: string): void {
    if (this.ws) this.rawSend(this.ws, "msg.delete", { msgId, chatId });
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.events.emit("state", state);
  }

  private async handleMessage(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isEnvelope(parsed)) return;

    switch (parsed.type) {
      case "auth.challenge":
        await this.respondToChallenge((parsed.payload as AuthChallengePayload).nonce);
        return;
      case "auth.ok":
        this.onAuthenticated();
        this.events.emit("authOk", parsed.payload as AuthOkPayload);
        return;
      case "auth.error": {
        const payload = parsed.payload as AuthErrorPayload;
        this.setFailure({ kind: "auth", code: payload.code });
        this.events.emit("authError", payload);
        return;
      }
      case "invite.redeem.ok":
        this.onAuthenticated();
        this.events.emit("inviteOk", parsed.payload as InviteRedeemOkPayload);
        return;
      case "invite.redeem.error":
        this.events.emit("inviteError", parsed.payload as InviteRedeemErrorPayload);
        return;
      case "invite.created":
        this.events.emit("inviteCreated", parsed.payload as InviteCreatedPayload);
        return;
      case "roster.snapshot":
        this.events.emit("roster", parsed.payload as RosterSnapshotPayload);
        return;
      case "member.joined":
        this.events.emit("memberJoined", parsed.payload as MemberJoinedPayload);
        return;
      case "msg.deliver":
        this.events.emit("msgDeliver", parsed.payload as MsgDeliverPayload);
        return;
      case "msg.accepted": {
        const payload = parsed.payload as MsgAcceptedPayload;
        await removeFromOutbox(payload.clientMsgId);
        this.events.emit("msgAccepted", payload);
        return;
      }
      case "msg.ackRelay":
        this.events.emit("ackRelay", parsed.payload as MsgAckRelayPayload);
        return;
      case "msg.deleted":
        this.events.emit("msgDeleted", parsed.payload as MsgDeletedPayload);
        return;
      case "typing.relay":
        this.events.emit("typingRelay", parsed.payload as TypingRelayPayload);
        return;
      case "history.page":
        this.events.emit("historyPage", parsed.payload as HistoryPagePayload);
        return;
      case "pong":
        this.lastPongAt = Date.now();
        return;
      case "error":
        this.events.emit("errorPacket", parsed.payload as ErrorPayload);
        return;
    }
  }

  private onAuthenticated(): void {
    this.reconnectAttempt = 0;
    this.failure = null;
    this.lastSocketError = "";
    this.setState("connected");
    this.startPing();
    void this.flushOutbox();
  }

  private async respondToChallenge(nonceB64: string): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    if (this.authMode.kind === "device") {
      const crypto = await getCrypto();
      const signature = crypto.signDetached(nonceB64, this.authMode.identitySecretKey);
      this.rawSend(ws, "auth.response", { deviceId: this.authMode.deviceId, signature });
    } else {
      this.rawSend(ws, "invite.redeem", {
        code: this.authMode.code,
        deviceId: this.authMode.deviceId,
        displayName: this.authMode.displayName,
        identityPublicKey: this.authMode.identityPublicKey,
        encryptionPublicKey: this.authMode.encryptionPublicKey,
      });
    }
  }

  /** true, если соединение реально открыто и в него можно писать. */
  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === this.ws.OPEN;
  }

  /** true, когда соединение открыто И устройство уже аутентифицировано. */
  isReady(): boolean {
    return this.state === "connected" && this.isOpen();
  }

  /**
   * Немедленное переподключение без ожидания экспоненциальной задержки —
   * вызывается при возврате в приложение и вручную из UI. Android часто
   * «убивает» сокет в фоне, и без этого приложение оставалось офлайн до
   * перезапуска.
   */
  forceReconnect(): void {
    if (this.closedByUser) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.reconnectAttempt = 0;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        // сокет мог быть уже мёртв — неважно, всё равно создаём новый
      }
      this.ws = null;
    }
    this.connect();
  }

  /** Ждём готовности соединения (с попыткой переподключиться), максимум timeoutMs. */
  waitUntilReady(timeoutMs: number): Promise<boolean> {
    if (this.isReady()) return Promise.resolve(true);
    if (this.failure?.kind === "auth") return Promise.resolve(false);
    if (!this.isOpen()) this.forceReconnect();

    return new Promise((resolve) => {
      const finish = (result: boolean): void => {
        clearTimeout(timer);
        offState();
        offFailure();
        resolve(result);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      const offState = this.events.on("state", (state) => {
        if (state === "connected") finish(true);
      });
      // Ждать таймаут бессмысленно, если сервер прямо отказал в аутентификации.
      const offFailure = this.events.on("failure", (failure) => {
        if (failure.kind === "auth") finish(false);
      });
    });
  }

  /**
   * Отправка не должна бросать исключение: WebSocket.send() на уже закрытом
   * сокете кидает ошибку, и она раньше всплывала наружу как unhandled
   * rejection (например, экран добавления человека висел в загрузке навсегда).
   */
  private rawSend(ws: WebSocket, type: string, payload: unknown): boolean {
    if (ws.readyState !== ws.OPEN) return false;
    try {
      ws.send(JSON.stringify({ v: 1, type, id: uuidv4(), ts: Date.now(), payload }));
      return true;
    } catch {
      return false;
    }
  }

  private trySendRaw(envelope: unknown): void {
    if (!this.isOpen() || !this.ws) return;
    try {
      this.ws.send(JSON.stringify(envelope));
    } catch {
      // соединение оборвалось между проверкой и записью — пакет останется в outbox
    }
  }

  private async flushOutbox(): Promise<void> {
    const items = await listOutbox();
    for (const item of items) this.trySendRaw(item.payload);
  }

  private handleClose(event?: { code?: number; reason?: string }): void {
    this.ws = null;
    this.stopPing();
    if (this.closedByUser) {
      this.setState("idle");
      return;
    }

    // Отказ аутентификации важнее сетевого: сервер ответил, значит домен и TLS
    // в порядке, и перезапуск ничего не изменит — нужны другие действия.
    if (this.failure?.kind !== "auth") {
      const parts = [this.lastSocketError, event?.reason, event?.code ? `код ${event.code}` : ""].filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      );
      this.setFailure({ kind: "network", detail: parts.join(", ") || "соединение закрыто" });
    }
    this.scheduleReconnect();
  }

  private setFailure(failure: ConnectionFailure): void {
    this.failure = failure;
    this.events.emit("failure", failure);
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    const delayMs = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
  }

  private startPing(): void {
    this.stopPing();
    this.lastPongAt = Date.now();
    this.pingTimer = setInterval(() => {
      // Сокет может «умереть» без события close (обычное дело на мобильной
      // сети): readyState всё ещё OPEN, но данные не ходят. Если на два
      // пинга подряд не пришло pong — считаем соединение мёртвым и
      // переподключаемся, иначе приложение висело бы «на связи» вечно.
      if (Date.now() - this.lastPongAt > PING_INTERVAL_MS * 2 + 5_000) {
        this.forceReconnect();
        return;
      }
      if (this.ws && this.ws.readyState === this.ws.OPEN) this.rawSend(this.ws, "ping", {});
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
