import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { loadLockConfig, type LockConfig } from "../storage/lock";
import { setAppLocked } from "./lockState";
import { isSystemPickerOpen } from "./systemPicker";

export type LockState =
  /** Настройки ещё читаются из хранилища — показывать содержимое нельзя. */
  | "loading"
  /** Блокировка выключена. */
  | "off"
  | "locked"
  | "unlocked";

export interface AppLock {
  state: LockState;
  config: LockConfig | null;
  /** Вызывается экраном блокировки после успешной проверки кода или биометрии. */
  unlock: () => void;
  /** Перечитать настройки — после включения, выключения или смены кода. */
  reload: () => Promise<LockConfig | null>;
}

/**
 * Блокировка приложения PIN-кодом.
 *
 * Живёт выше всех экранов, но НЕ выше соединения: пока показан экран
 * блокировки, приложение продолжает получать сообщения и показывать
 * уведомления. Иначе блокировка означала бы «не получать сообщения, пока
 * телефон в кармане» — а работа в фоне делалась ровно для обратного.
 *
 * Момент блокировки: холодный запуск всегда, и возвращение из фона, если в фоне
 * прошло больше graceSec. Уход в фон засчитывается не всегда — системные окна
 * (выбор фото, «поделиться») его не считают, см. systemPicker.
 */
export function useAppLock(): AppLock {
  const [state, setState] = useState<LockState>("loading");
  const [config, setConfig] = useState<LockConfig | null>(null);

  // Обработчик AppState подписывается один раз и читает настройки из рефов:
  // иначе он пересоздавался бы на каждое изменение и мог пропустить переход.
  const configRef = useRef<LockConfig | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const lockedRef = useRef(false);

  /**
   * Один вход для смены «заперто/не заперто».
   *
   * Помимо состояния React ставит флаг в lockState: его читает AppContext,
   * которому нельзя отмечать сообщения прочитанными и показывать человека «в
   * сети», пока чат перекрыт экраном блокировки.
   */
  const setLocked = useCallback((next: boolean): void => {
    lockedRef.current = next;
    setAppLocked(next);
    setState(next ? "locked" : configRef.current === null ? "off" : "unlocked");
  }, []);

  const reload = useCallback(async (): Promise<LockConfig | null> => {
    const stored = await loadLockConfig();
    configRef.current = stored;
    setConfig(stored);
    // Блокировку только что выключили — держать запертым больше нечем. Обратный
    // случай (только что включили) запирать сразу не надо: человек стоит в
    // настройках и код уже ввёл.
    if (!stored) setLocked(false);
    else if (!lockedRef.current) setState("unlocked");
    return stored;
  }, [setLocked]);

  useEffect(() => {
    void (async () => {
      const stored = await loadLockConfig();
      configRef.current = stored;
      setConfig(stored);
      // Холодный запуск всегда требует код: приложение только что открыли, и
      // кто именно это сделал — неизвестно.
      setLocked(stored !== null);
    })();
  }, [setLocked]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      const current = configRef.current;
      if (!current) return;

      if (next === "background" || next === "inactive") {
        // Системное окно — не уход из приложения. Отметку времени в этом случае
        // не ставим вовсе, иначе возвращение из выбора фото считалось бы
        // возвращением человека.
        if (isSystemPickerOpen()) return;
        // Первое из inactive/background и решает: на Android они приходят парой,
        // и второе перезаписало бы время, укоротив паузу.
        hiddenAtRef.current ??= Date.now();
        return;
      }

      if (next === "active") {
        const hiddenAt = hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (hiddenAt === null || lockedRef.current) return;
        if (Date.now() - hiddenAt >= current.graceSec * 1000) setLocked(true);
      }
    });
    return () => subscription.remove();
  }, [setLocked]);

  const unlock = useCallback(() => {
    hiddenAtRef.current = null;
    setLocked(false);
  }, [setLocked]);

  return { state, config, unlock, reload };
}
