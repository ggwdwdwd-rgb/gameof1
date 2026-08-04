import { deleteLocalMediaFile } from "../chat/media";
import { getDb } from "./database";
import { UPDATE_CONTACT_REVOKED } from "./sql";

export interface Contact {
  userId: string;
  deviceId: string;
  /** Имя, которое задал сам человек (приходит в roster). */
  displayName: string;
  /** @тег: по нему человека нашли. null — аккаунт без тега. */
  username: string | null;
  /** Своё название этого контакта; null — используется displayName. */
  localName: string | null;
  identityPublicKey: string;
  encryptionPublicKey: string;
  fingerprint: string;
  isRevoked: boolean;
}

interface ContactRow {
  user_id: string;
  device_id: string;
  display_name: string;
  username: string | null;
  identity_public_key: string;
  encryption_public_key: string;
  fingerprint: string;
  is_revoked: number;
  local_name: string | null;
}

function fromRow(row: ContactRow): Contact {
  return {
    userId: row.user_id,
    deviceId: row.device_id,
    displayName: row.display_name,
    username: row.username,
    localName: row.local_name,
    identityPublicKey: row.identity_public_key,
    encryptionPublicKey: row.encryption_public_key,
    fingerprint: row.fingerprint,
    isRevoked: row.is_revoked === 1,
  };
}

export async function upsertContact(contact: Contact): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO contacts (user_id, device_id, display_name, username, identity_public_key, encryption_public_key, fingerprint, is_revoked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       device_id = excluded.device_id,
       display_name = excluded.display_name,
       username = excluded.username,
       identity_public_key = excluded.identity_public_key,
       encryption_public_key = excluded.encryption_public_key,
       fingerprint = excluded.fingerprint,
       is_revoked = excluded.is_revoked`,
    [
      contact.userId,
      contact.deviceId,
      contact.displayName,
      contact.username,
      contact.identityPublicKey,
      contact.encryptionPublicKey,
      contact.fingerprint,
      contact.isRevoked ? 1 : 0,
    ],
  );
}

export async function listContacts(): Promise<Contact[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ContactRow>(
    "SELECT * FROM contacts ORDER BY COALESCE(local_name, display_name) ASC",
  );
  return rows.map(fromRow);
}

/** Своё название контакта; пустая строка убирает его и возвращает имя из roster. */
export async function setContactLocalName(userId: string, localName: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE contacts SET local_name = ? WHERE user_id = ?", [localName, userId]);
}

/** Как контакт подписан на экранах: своё название важнее имени из roster. */
export function contactTitle(contact: Contact): string {
  return contact.localName ?? contact.displayName;
}

export async function getContact(userId: string): Promise<Contact | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ContactRow>("SELECT * FROM contacts WHERE user_id = ?", [userId]);
  return row ? fromRow(row) : null;
}

/**
 * Полное удаление контакта вместе с перепиской.
 *
 * Нужно, когда участника удалили на сервере: писать ему нельзя (ключей от него
 * ни у кого нет), а чат с ним висел бы в списке навсегда. Сообщения удаляем
 * тоже — расшифровать их всё равно нечем, а место они занимают.
 *
 * Файлы медиа забираем ДО удаления строк: сама запись — единственное, что
 * знает про localUri. Без этого шага удаление контакта стирало бы записи из
 * базы, но все его фото и голосовые тихо оставались бы в песочнице приложения
 * навсегда — то есть решило бы ровно то, что обещано в комментарии выше, только
 * на бумаге.
 */
export async function deleteContactWithChat(userId: string, chatId: string): Promise<void> {
  const db = await getDb();
  const media = await db.getAllAsync<{ content_type: string; plaintext: string | null }>(
    "SELECT content_type, plaintext FROM messages WHERE chat_id = ?",
    [chatId],
  );
  await db.runAsync("DELETE FROM messages WHERE chat_id = ?", [chatId]);
  await db.runAsync("DELETE FROM sync_state WHERE chat_id = ?", [chatId]);
  await db.runAsync("DELETE FROM contacts WHERE user_id = ?", [userId]);
  for (const row of media) deleteLocalMediaFile(row.content_type, row.plaintext);
}

/**
 * Отметка «доступ устройства отозван» — и снятие её обратно.
 *
 * Переписку при этом не удаляем: отзыв обратим, а прежние сообщения этого
 * устройства расшифровываются его же ключами, которые лежат в этой же записи.
 */
export async function setContactRevoked(userId: string, revoked: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(UPDATE_CONTACT_REVOKED, [revoked ? 1 : 0, userId]);
}
