import { useEffect, useRef, useState } from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface KeyboardState {
  /** Клавиатура открыта. Определяется не только событиями — см. ниже. */
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
  /**
   * Нижний отступ под строкой ввода: системная навигация или её эквивалент.
   *
   * Отдельно от insets.bottom намеренно, см. комментарий в коде.
   */
  safeBottom: number;
}

/**
 * Сжатие окна меньше этого считаем не клавиатурой, а мелочью вроде смены
 * системных полос: настоящая клавиатура забирает куда больше.
 */
const SHRINK_THRESHOLD = 60;

/**
 * Состояние экранной клавиатуры.
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
 * система не отдала сама.
 *
 * Два урока с реальных телефонов:
 *
 *  1. keyboardDidShow приходит не всегда. При edge-to-edge на части прошивок
 *     событие не срабатывает вовсе, и «клавиатуры нет» — тогда мы не добавляли
 *     ничего. Поэтому открытость определяется ещё и по сжатию окна.
 *  2. Пока клавиатура открыта, системный нижний инсет обнуляется: клавиатура
 *     закрывает навигацию, и safe-area честно сообщает 0. Но окно система
 *     сжимает на высоту клавиатуры *без* этой полосы, и строка ввода уезжала
 *     ровно под неё. Поэтому запоминаем инсет, каким он был до клавиатуры, и
 *     держим его, пока она открыта.
 */
export function useKeyboard(): KeyboardState {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState({ visible: false, height: 0 });

  // Эталоны «без клавиатуры». Обновляются только когда её точно нет, иначе
  // сравнивать было бы не с чем.
  const baseHeight = useRef(window.height);
  const baseInsetBottom = useRef(insets.bottom);

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
  const open = keyboard.visible || shrunkBySystem >= SHRINK_THRESHOLD;

  if (!open) {
    baseHeight.current = window.height;
    baseInsetBottom.current = insets.bottom;
  }

  return {
    visible: open,
    height: keyboard.height,
    // Событий может не быть — тогда высоту клавиатуры мы не знаем, но и
    // добавлять нечего: раз окно сжалось, место система уже отдала.
    avoidOffset: keyboard.visible ? Math.max(0, keyboard.height - shrunkBySystem) : 0,
    safeBottom: open ? Math.max(insets.bottom, baseInsetBottom.current) : insets.bottom,
  };
}
