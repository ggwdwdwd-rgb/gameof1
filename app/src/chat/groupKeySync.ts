import type { createCrypto } from "@family-messenger/crypto";
import type { Contact } from "../db/contacts";
import { getGroupKey, getLatestGroupKeyVersion, saveGroupKey } from "../db/groupKeys";
import type { DeviceIdentity } from "../storage/identity";
import type { WsClient } from "../net/wsClient";
import { uuidv4 } from "../util/uuid";
import { GROUP_CHAT_ID } from "./chatId";
import { chatIdWithContact, sharedKeyWithContact } from "./encryption";

type Crypto = ReturnType<typeof createCrypto>;

/** Самый первый пользователь системы (пустой ростер при регистрации) создаёт groupKey сам, см. ARCHITECTURE.md §4.6. */
export async function bootstrapGroupKeyIfFirstUser(crypto: Crypto, rosterIsEmpty: boolean): Promise<void> {
  if (!rosterIsEmpty) return;
  const existing = await getLatestGroupKeyVersion(GROUP_CHAT_ID);
  if (existing !== null) return;
  const key = crypto.generateGroupKey();
  await saveGroupKey(GROUP_CHAT_ID, 1, key);
}

/**
 * Раздаёт мой текущий групповой ключ конкретному участнику через его 1:1-канал
 * (обычное msg.send с contentType system_group_key — см. ARCHITECTURE.md §4.6).
 * Идемпотентно: получатель просто повторно сохранит тот же ключ, ничего страшного
 * в повторных вызовах при каждом roster.snapshot/member.joined нет.
 */
export async function distributeGroupKeyToContact(
  crypto: Crypto,
  wsClient: WsClient,
  identity: DeviceIdentity,
  contact: Contact,
): Promise<void> {
  const keyVersion = await getLatestGroupKeyVersion(GROUP_CHAT_ID);
  if (keyVersion === null) return; // у меня самого ключа ещё нет — нечего раздавать
  const keyMaterial = await getGroupKey(GROUP_CHAT_ID, keyVersion);
  if (!keyMaterial) return;

  const sharedKey = sharedKeyWithContact(crypto, identity, contact);
  const body = JSON.stringify({ chatId: GROUP_CHAT_ID, keyVersion, key: keyMaterial });
  const { ciphertext, nonce } = crypto.encryptWithKey(body, sharedKey);

  await wsClient.sendMessage({
    clientMsgId: uuidv4(),
    chatId: chatIdWithContact(identity.userId, contact),
    contentType: "system_group_key",
    ciphertext,
    nonce,
    replyTo: null,
  });
}

export interface IncomingGroupKeyMessage {
  chatId: string;
  keyVersion: number;
  key: string;
}

export function parseGroupKeyMessage(plaintext: string): IncomingGroupKeyMessage | null {
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).chatId === "string" &&
      typeof (parsed as Record<string, unknown>).keyVersion === "number" &&
      typeof (parsed as Record<string, unknown>).key === "string"
    ) {
      return parsed as IncomingGroupKeyMessage;
    }
    return null;
  } catch {
    return null;
  }
}
