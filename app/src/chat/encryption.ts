import type { createCrypto } from "@family-messenger/crypto";
import type { Contact } from "../db/contacts";
import type { DeviceIdentity } from "../storage/identity";
import { otherUserIdInDm } from "./chatId";

type Crypto = ReturnType<typeof createCrypto>;

export interface EncryptedForSend {
  ciphertext: string;
  nonce: string;
}

export type EncryptError = "NO_CONTACT" | "CRYPTO_FAILED";

/**
 * Шифруем сообщение личного чата парным ключом (NaCl box). Собеседник
 * определяется по chatId, а не по отправителю — это важно и для расшифровки
 * своих же сообщений, пришедших обратно из истории.
 */
export function encryptForChat(
  crypto: Crypto,
  identity: DeviceIdentity,
  chatId: string,
  plaintext: string,
  contactsByUserId: Map<string, Contact>,
): EncryptedForSend | { error: EncryptError } {
  const contact = peerContact(identity, chatId, contactsByUserId);
  if (!contact) return { error: "NO_CONTACT" };

  try {
    return crypto.boxEncrypt(plaintext, contact.encryptionPublicKey, identity.encryptionSecretKey);
  } catch {
    // Явная ошибка вместо «тихого» исключения: раньше такое падение внутри
    // обработчика приводило к тому, что сообщение просто исчезало.
    return { error: "CRYPTO_FAILED" };
  }
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
  const contact = peerContact(identity, message.chatId, contactsByUserId);
  if (!contact) return null;
  try {
    return crypto.boxOpen(
      { ciphertext: message.ciphertext, nonce: message.nonce },
      contact.encryptionPublicKey,
      identity.encryptionSecretKey,
    );
  } catch {
    return null; // тег не сошёлся — подмена/повреждение/не тот ключ
  }
}

function peerContact(
  identity: DeviceIdentity,
  chatId: string,
  contactsByUserId: Map<string, Contact>,
): Contact | undefined {
  const peerUserId = otherUserIdInDm(chatId, identity.userId);
  return peerUserId ? contactsByUserId.get(peerUserId) : undefined;
}
