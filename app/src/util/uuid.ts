/**
 * uuid v4 на Math.random — используется только как ID пакета/сообщения для
 * идемпотентности и сопоставления запрос/ответ, не для криптографии
 * (ключи и nonce всегда берутся из sodium.randombytes_buf, не отсюда).
 */
export function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
