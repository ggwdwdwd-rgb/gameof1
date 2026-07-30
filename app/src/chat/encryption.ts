import type { createCrypto } from "@family-messenger/crypto";
import type { Contact } from "../db/contacts";
import type { DeviceIdentity } from "../storage/identity";
import { otherUserIdInDm } from "./chatId";

type Crypto = ReturnType<typeof createCrypto>;

export interface EncryptedForSend {
  ciphertext: string;
  nonce: string;
}

/** Общий секрет с контактом (симметричен: та же функция на обеих сторонах, см. ARCHITECTURE.md §2.2). */
export function sharedKeyWithContact(crypto: Crypto, identity: DeviceIdentity, contact: Contact): string {
  return crypto.deriveSharedKey(identity.encryptionSecretKey, contact.encryptionPublicKey);
}

export type EncryptError = "NO_CONTACT";

export function encryptForChat(
  crypto: Crypto,
  identity: DeviceIdentity,
  chatId: string,
  plaintext: string,
  contactsByUserId: Map<string, Contact>,
): EncryptedForSend | { error: EncryptError } {
  const otherUserId = otherUserIdInDm(chatId, identity.userId);
  const contact = otherUserId ? contactsByUserId.get(otherUserId) : undefined;
  if (!contact) return { error: "NO_CONTACT" };

  const sharedKey = sharedKeyWithContact(crypto, identity, contact);
  return crypto.encryptWithKey(plaintext, sharedKey);
}

export interface DeliveredMessageForDecrypt {
  chatId: string;
  fromUserId: string;
  ciphertext: string;
  nonce: string;
}

export function decryptDeliveredMessage(
  crypto: Crypto,
  identity: DeviceIdentity,
  message: DeliveredMessageForDecrypt,
  contactsByUserId: Map<string, Contact>,
): string | null {
  try {
    // Ключ ищем по собеседнику чата, а не по отправителю: иначе собственные
    // сообщения, пришедшие обратно через history.fetch (после переустановки
    // или на второй сессии), не расшифровывались бы — ключа "сам с собой" нет.
    const peerUserId = otherUserIdInDm(message.chatId, identity.userId);
    const contact = peerUserId ? contactsByUserId.get(peerUserId) : undefined;
    if (!contact) return null;
    const sharedKey = sharedKeyWithContact(crypto, identity, contact);
    return crypto.decryptWithKey({ ciphertext: message.ciphertext, nonce: message.nonce }, sharedKey);
  } catch {
    return null; // AEAD-тег не сошёлся — подмена/повреждение/не тот ключ
  }
}
