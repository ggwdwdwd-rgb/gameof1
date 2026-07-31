import { getDb } from "./database";

export interface Contact {
  userId: string;
  deviceId: string;
  /** Имя, которое задал сам человек (приходит в roster). */
  displayName: string;
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
    `INSERT INTO contacts (user_id, device_id, display_name, identity_public_key, encryption_public_key, fingerprint, is_revoked)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       device_id = excluded.device_id,
       display_name = excluded.display_name,
       identity_public_key = excluded.identity_public_key,
       encryption_public_key = excluded.encryption_public_key,
       fingerprint = excluded.fingerprint,
       is_revoked = excluded.is_revoked`,
    [
      contact.userId,
      contact.deviceId,
      contact.displayName,
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

export async function markContactRevoked(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE contacts SET is_revoked = 1 WHERE user_id = ?", [userId]);
}
