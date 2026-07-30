import { getDb } from "./database";

export async function saveGroupKey(chatId: string, keyVersion: number, keyMaterialB64: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT OR IGNORE INTO group_keys (chat_id, key_version, key_material) VALUES (?, ?, ?)",
    [chatId, keyVersion, keyMaterialB64],
  );
}

export async function getGroupKey(chatId: string, keyVersion: number): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ key_material: string }>(
    "SELECT key_material FROM group_keys WHERE chat_id = ? AND key_version = ?",
    [chatId, keyVersion],
  );
  return row?.key_material ?? null;
}

export async function getLatestGroupKeyVersion(chatId: string): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ key_version: number }>(
    "SELECT key_version FROM group_keys WHERE chat_id = ? ORDER BY key_version DESC LIMIT 1",
    [chatId],
  );
  return row?.key_version ?? null;
}
