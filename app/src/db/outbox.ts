import { getDb } from "./database";

export interface OutboxItem {
  clientMsgId: string;
  payload: unknown; // готовый envelope msg.send, ждёт соединения
  attempts: number;
  createdAt: number;
}

interface OutboxRow {
  client_msg_id: string;
  payload_json: string;
  attempts: number;
  created_at: number;
}

export async function enqueueOutbox(clientMsgId: string, payload: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO outbox (client_msg_id, payload_json, attempts, created_at) VALUES (?, ?, 0, ?)",
    [clientMsgId, JSON.stringify(payload), Date.now()],
  );
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OutboxRow>("SELECT * FROM outbox ORDER BY created_at ASC");
  return rows.map((r) => ({
    clientMsgId: r.client_msg_id,
    payload: JSON.parse(r.payload_json) as unknown,
    attempts: r.attempts,
    createdAt: r.created_at,
  }));
}

export async function removeFromOutbox(clientMsgId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM outbox WHERE client_msg_id = ?", [clientMsgId]);
}

export async function bumpOutboxAttempts(clientMsgId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE outbox SET attempts = attempts + 1 WHERE client_msg_id = ?", [clientMsgId]);
}
