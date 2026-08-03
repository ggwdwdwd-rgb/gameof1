import type { EncryptedBackup } from "@family-messenger/crypto";
import { getCrypto } from "../crypto/sodium";
import { listContacts, upsertContact, type Contact } from "../db/contacts";
import { insertMessage, listAllMessages, messageExists, type LocalMessage } from "../db/messages";

/**
 * Резервная копия переписки, зашифрованная кодовой фразой.
 *
 * Зачем: с аккаунтами человек ожидает, что после входа с нового телефона чаты
 * будут на месте. Но сообщения расшифровываются ключами устройства, а они
 * остаются на прежнем телефоне — сервер хранит только шифротекст и помочь не
 * может даже теоретически. Значит копию делает сам клиент, уже расшифрованную, и
 * шифрует её фразой, которую сервер не знает.
 *
 * Что попадает в копию: текст сообщений, их статусы и время, а также контакты с
 * публичными ключами. Медиа НЕ попадает — фотографии и голосовые лежат файлами
 * на диске, и копия из них выросла бы до сотен мегабайт на сервере. В восстановленной
 * переписке вложения останутся подписями «Фото», «Голосовое сообщение».
 *
 * Чего копия НЕ содержит: приватных ключей устройства. Они не покидают телефон —
 * это свойство, на котором держится всё остальное. Честное следствие: сообщения,
 * пришедшие на прежний телефон уже ПОСЛЕ последней копии, на новом расшифровать
 * нечем.
 *
 * Забытая фраза означает потерянную копию: ключ выводится только из неё, и
 * восстановить его нечем.
 */
const FORMAT_VERSION = 1;

interface BackupContents {
  v: number;
  createdAt: number;
  messages: LocalMessage[];
  contacts: Contact[];
}

/** Собирает копию из локальной базы и шифрует её фразой. */
export async function createBackup(passphrase: string): Promise<{ blob: string; messages: number }> {
  const crypto = await getCrypto();
  const messages = await listAllMessages();
  const contacts = await listContacts();

  const contents: BackupContents = { v: FORMAT_VERSION, createdAt: Date.now(), messages, contacts };
  const encrypted = crypto.encryptBackup(JSON.stringify(contents), passphrase);
  return { blob: JSON.stringify(encrypted), messages: messages.length };
}

export type RestoreResult =
  | { ok: true; messages: number; contacts: number }
  /** BAD_PASSPHRASE — фраза не подходит либо копия испорчена: различать эти случаи вредно. */
  | { ok: false; code: "BAD_PASSPHRASE" | "BAD_FORMAT" };

/**
 * Восстановление: дописывает то, чего в базе нет.
 *
 * Именно дописывает, а не заменяет. На новом телефоне база пуста, и разницы нет;
 * но восстановление на телефоне, где уже что-то есть, не должно стирать
 * сообщения, пришедшие после копии. Поэтому уже существующие записи
 * пропускаются, а не перезаписываются.
 */
export async function restoreBackup(blob: string, passphrase: string): Promise<RestoreResult> {
  const crypto = await getCrypto();

  let encrypted: EncryptedBackup;
  try {
    encrypted = JSON.parse(blob) as EncryptedBackup;
  } catch {
    return { ok: false, code: "BAD_FORMAT" };
  }

  const plaintext = crypto.decryptBackup(encrypted, passphrase);
  if (plaintext === null) return { ok: false, code: "BAD_PASSPHRASE" };

  let contents: BackupContents;
  try {
    contents = JSON.parse(plaintext) as BackupContents;
  } catch {
    return { ok: false, code: "BAD_FORMAT" };
  }
  // Копию, созданную более новой версией приложения, читать не пытаемся:
  // молча пропустить незнакомые поля хуже, чем честно отказать.
  if (contents.v !== FORMAT_VERSION || !Array.isArray(contents.messages)) {
    return { ok: false, code: "BAD_FORMAT" };
  }

  let contacts = 0;
  for (const contact of contents.contacts ?? []) {
    // Контакты пишем всегда: их ключи нужны, чтобы расшифровывать историю с
    // сервера, а свои названия из копии человек и рассчитывает вернуть.
    await upsertContact(contact);
    contacts += 1;
  }

  let messages = 0;
  for (const message of contents.messages) {
    if (await messageExists(message.clientMsgId)) continue;
    await insertMessage(message);
    messages += 1;
  }

  return { ok: true, messages, contacts };
}
