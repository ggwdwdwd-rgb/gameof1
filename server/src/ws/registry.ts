import type { WebSocket } from "ws";
import type { Envelope } from "./types.js";

interface Connection {
  socket: WebSocket;
  userId: string;
  deviceId: string;
}

// Простой in-memory реестр авторизованных соединений на процесс.
// Для 10 участников одного процесса Node более чем достаточно —
// шардинг/pub-sub между инстансами не нужен.
const connections = new Map<string, Connection>();

export function registerConnection(deviceId: string, userId: string, socket: WebSocket): void {
  connections.set(deviceId, { socket, userId, deviceId });
}

export function unregisterConnection(deviceId: string): void {
  connections.delete(deviceId);
}

export function send(socket: WebSocket, envelope: Envelope): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(envelope));
  }
}

export function broadcastToAllExcept(excludeDeviceId: string, envelope: Envelope): void {
  for (const conn of connections.values()) {
    if (conn.deviceId === excludeDeviceId) continue;
    send(conn.socket, envelope);
  }
}

export function connectedDeviceCount(): number {
  return connections.size;
}
