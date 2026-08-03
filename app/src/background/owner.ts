/**
 * Кто сейчас держит соединение с сервером.
 *
 * Соединений должно быть строго одно. Сервер различает устройства по deviceId и
 * держит на каждое одно соединение: второе вытесняет первое, и два клиента с
 * одним deviceId начинают выбивать друг друга — сообщения теряются у обоих.
 *
 * Претендентов два, и они существуют в одном JS-контексте:
 *  - экран приложения (AppProvider) — когда приложение открыто;
 *  - headless-задача службы переднего плана — когда экрана нет.
 *
 * Правило простое: экран главнее. Задача подключается, только если экрана нет, и
 * отпускает соединение, как только он появился.
 */
export type ConnectionOwner = "app" | "background";

let owner: ConnectionOwner | null = null;
const listeners = new Set<(owner: ConnectionOwner | null) => void>();

function notify(): void {
  for (const listener of [...listeners]) listener(owner);
}

/** Экран забирает соединение всегда; фон — только если свободно. */
export function claimConnection(who: ConnectionOwner): boolean {
  if (who === "app") {
    owner = "app";
    notify();
    return true;
  }
  if (owner !== null) return false;
  owner = "background";
  notify();
  return true;
}

export function releaseConnection(who: ConnectionOwner): void {
  if (owner !== who) return;
  owner = null;
  notify();
}

export function connectionOwner(): ConnectionOwner | null {
  return owner;
}

/** Подписка нужна фону: он должен отпустить соединение, когда открыли экран. */
export function onOwnerChange(listener: (owner: ConnectionOwner | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
