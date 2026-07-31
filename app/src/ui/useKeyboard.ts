import { useEffect, useRef, useState } from "react";
import { Keyboard, useWindowDimensions } from "react-native";

export interface KeyboardState {
  visible: boolean;
  /** Высота клавиатуры в точках; 0, когда её нет. */
  height: number;
  /**
   * Сколько нужно добавить снизу, чтобы содержимое не оказалось под клавиатурой.
   *
   * Это НЕ то же, что height: если система сама сжала окно под клавиатуру
   * (adjustResize), место уже освободилось, и добавлять отступ второй раз
   * нельзя — содержимое уехало бы вверх на две высоты клавиатуры.
   */
  avoidOffset: number;
}

/**
 * Состояние экранной клавиатуры из её собственных событий.
 *
 * Отсюда берётся нижний отступ экрана чата — вместо KeyboardAvoidingView. Тот
 * считает отступ по onLayout своего содержимого, и с растущим multiline
 * TextInput получалась петля: ввод растёт → меняется layout → меняется отступ →
 * снова меняется layout. Приложение подвисало ровно тогда, когда сообщение
 * перестаёт влезать в одну строку. Событиям клавиатуры такая петля не грозит:
 * высота приходит от системы и от вёрстки не зависит.
 *
 * Сжимает ли окно система — зависит от версии Android, режима edge-to-edge и
 * прошивки, то есть заранее не угадать. Поэтому не угадываем: сравниваем высоту
 * окна с той, что была без клавиатуры, и добавляем ровно ту часть, которую
 * система не отдала сама. При любом поведении системы содержимое поднимается
 * на одну высоту клавиатуры, а не на две.
 *
 * На Android есть только события Did*, поэтому Will* не слушаем вовсе.
 */
export function useKeyboard(): KeyboardState {
  const window = useWindowDimensions();
  const [keyboard, setKeyboard] = useState({ visible: false, height: 0 });

  // Высота окна без клавиатуры — эталон для сравнения. Пока клавиатуры нет,
  // текущая высота и есть эталон (заодно так учитывается поворот экрана).
  const baseHeight = useRef(window.height);
  if (!keyboard.visible) baseHeight.current = window.height;

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboard({ visible: true, height: event.endCoordinates.height });
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboard({ visible: false, height: 0 });
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Считаем на рендере, а не в обработчике: размер окна система меняет уже
  // после события, и в момент события он ещё старый.
  const shrunkBySystem = Math.max(0, baseHeight.current - window.height);
  const avoidOffset = keyboard.visible ? Math.max(0, keyboard.height - shrunkBySystem) : 0;

  return { visible: keyboard.visible, height: keyboard.height, avoidOffset };
}
