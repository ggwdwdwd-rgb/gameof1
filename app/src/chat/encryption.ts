import type { createCrypto } from "@family-messenger/crypto";
import type { Contact } from "../db/contacts";
import { getGroupKey, getLatestGroupKeyVersion } from "../db/groupKeys";
import type { DeviceIdentity } from "../storage/identity";
import { dmChatId, isGroupChat, otherUserIdInDm } from "./chatId";

type Crypto = ReturnType<typeof createCrypto>;

export interface EncryptedForSend {
  ciphertext: string;
  nonce: string;
  keyVersion?: number;
}

/** Общий секрет с конкретным контактом (симметричен: та же функция на обеих сторонах, см. ARCHITECTURE.md §2.2). */
export function sharedKeyWithContact(crypto: Crypto, identity: DeviceIdentity, contact: Contact): string {
  return crypto.deriveSharedKey(identity.encryptionSecretKey, contact.encryptionPublicKey);
}

export async function encryptForChat(
  crypto: Crypto,
  identity: DeviceIdentity,
  chatId: string,
  plaintext: string,
  contactsByUserId: Map<string, Contact>,
): Promise<EncryptedForSend | null> {
  if (isGroupChat(chatId)) {
    const keyVersion = await getLatestGroupKeyVersion(chatId);
    if (keyVersion === null) return null; // ключ группы ещё не создан/не получен
    const keyMaterial = await getGroupKey(chatId, keyVersion);
    if (!keyMaterial) return null;
    const { ciphertext, nonce } = crypto.encryptWithKey(plaintext, keyMaterial);
    return { ciphertext, nonce, keyVersion };
  }

  const otherUserId = otherUserIdInDm(chatId, identity.userId);
  const contact = otherUserId ? contactsByUserId.get(otherUserId) : undefined;
  if (!contact) return null;

  const sharedKey = sharedKeyWithContact(crypto, identity, contact);
  const { ciphertext, nonce } = crypto.encryptWithKey(plaintext, sharedKey);
  return { ciphertext, nonce };
}

export interface DeliveredMessageForDecrypt {
  chatId: string;
  fromUserId: string;
  ciphertext: string;
  nonce: string;
  keyVersion: number | null;
}

export async function decryptDeliveredMessage(
  crypto: Crypto,
  identity: DeviceIdentity,
  message: DeliveredMessageForDecrypt,
  contactsByUserId: Map<string, Contact>,
): Promise<string | null> {
  try {
    if (isGroupChat(message.chatId)) {
      if (message.keyVersion === null) return null;
      const keyMaterial = await getGroupKey(message.chatId, message.keyVersion);
      if (!keyMaterial) return null; // ключ этой версии ещё не получен
      return crypto.decryptWithKey({ ciphertext: message.ciphertext, nonce: message.nonce }, keyMaterial);
    }

    const contact = contactsByUserId.get(message.fromUserId);
    if (!contact) return null;
    const sharedKey = sharedKeyWithContact(crypto, identity, contact);
    return crypto.decryptWithKey({ ciphertext: message.ciphertext, nonce: message.nonce }, sharedKey);
  } catch {
    return null; // AEAD-тег не сошёлся — подмена/повреждение/не тот ключ
  }
}

/** chatId, где myUserId переписывается с contact — используется и для system_group_key DM. */
export function chatIdWithContact(myUserId: string, contact: Contact): string {
  return dmChatId(myUserId, contact.userId);
}
