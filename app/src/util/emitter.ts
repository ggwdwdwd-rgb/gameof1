/** Минимальный типизированный pub-sub — не тянуть node:events ради десятка колбэков. */
export class Emitter<Events extends Record<string, (...args: never[]) => void>> {
  private listeners: { [K in keyof Events]?: Set<Events[K]> } = {};

  on<K extends keyof Events>(event: K, handler: Events[K]): () => void {
    (this.listeners[event] ??= new Set()).add(handler);
    return () => this.listeners[event]?.delete(handler);
  }

  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    for (const handler of this.listeners[event] ?? []) {
      (handler as (...a: Parameters<Events[K]>) => void)(...args);
    }
  }
}
