import type { WebSocket } from "ws";
import type { Envelope } from "./types.js";

interface Connection {
  socket: WebSocket;
  userId: string;
  deviceId: string;
  /**
   * Смотрит ли человек на телефон прямо сейчас. Приходит от клиента пакетом
   * presence.set. Открытое соединение само по себе этого больше не означает:
   * со службой переднего плана оно живёт и с погашенным экраном.
   */
  active: boolean;
}

// Простой in-memory реестр авторизованных соединений на процесс.
// Для 10 участников одного процесса Node более чем достаточно —
// шардинг/pub-sub между инстансами не нужен.
const connections = new Map<string, Connection>();

export function registerConnection(deviceId: string, userId: string, socket: WebSocket): void {
  // active: true при подключении — приложение только что открыли.
  connections.set(deviceId, { socket, userId, deviceId, active: true });
}

/** Возвращает true, если значение изменилось (значит, надо рассылать presence). */
export function setConnectionActive(deviceId: string, active: boolean): boolean {
  const conn = connections.get(deviceId);
  if (!conn || conn.active === active) return false;
  conn.active = active;
  return true;
}

export function unregisterConnection(deviceId: string): void {
  connections.delete(deviceId);
}

/**
 * Участник считается «в сети», пока хоть одно его устройство подключено.
 * Отдельного флага в базе нет намеренно: он бы врал после падения процесса.
 */
export function isUserOnline(userId: string): boolean {
  for (const conn of connections.values()) {
    if (conn.userId === userId && conn.active) return true;
  }
  return false;
}

/** Все, кто сейчас на связи — для снимка при подключении. */
export function onlineUserIds(): string[] {
  return [...new Set([...connections.values()].filter((conn) => conn.active).map((conn) => conn.userId))];
}

/** Остались ли у участника ещё соединения (проверяется после отключения одного). */
export function hasOtherConnections(userId: string, exceptDeviceId: string): boolean {
  for (const conn of connections.values()) {
    if (conn.userId === userId && conn.deviceId !== exceptDeviceId) return true;
  }
  return false;
}

export function send(socket: WebSocket, envelope: Envelope): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(envelope));
  }
}

/** excludeDeviceId = null — отправить всем, включая другие устройства автора. */
export function broadcastToAllExcept(excludeDeviceId: string | null, envelope: Envelope): void {
  for (const conn of connections.values()) {
    if (conn.deviceId === excludeDeviceId) continue;
    send(conn.socket, envelope);
  }
}

/** true, если получатель был онлайн и пакет реально ушёл (иначе он останется только в БД до history.fetch). */
export function sendToDevice(deviceId: string, envelope: Envelope): boolean {
  const conn = connections.get(deviceId);
  if (!conn) return false;
  send(conn.socket, envelope);
  return true;
}

export function connectedDeviceCount(): number {
  return connections.size;
}

/**
 * Разрывает соединения перечисленных устройств.
 *
 * Нужно после удаления участника и после отзыва устройства: запись из базы уже
 * исчезла или помечена отозванной, но открытый сокет продолжал бы работать до
 * перезапуска — отключённое устройство оставалось бы «на связи» и получало бы
 * сообщения, а именно от этого отзыв и должен защищать.
 */
export function closeDevices(deviceIds: string[], reason = "участник удалён"): void {
  for (const deviceId of deviceIds) {
    const conn = connections.get(deviceId);
    if (!conn) continue;
    connections.delete(deviceId);
    conn.socket.close(4003, reason);
  }
}
