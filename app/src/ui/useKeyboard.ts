import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

export interface KeyboardState {
  visible: boolean;
  /** Высота клавиатуры в точках; 0, когда её нет. */
  height: number;
}

/**
 * Состояние экранной клавиатуры из её собственных событий.
 *
 * Отсюда берётся нижний отступ экрана чата — вместо KeyboardAvoidingView.
 * Тот считает отступ по onLayout своего содержимого, и с растущим multiline
 * TextInput получалась петля: ввод растёт → меняется layout → меняется отступ →
 * снова меняется layout. Приложение при этом заметно подвисало ровно в момент,
 * когда сообщение переставало влезать в одну строку. Событиям клавиатуры такая
 * петля не грозит: высота приходит от системы и от вёрстки не зависит.
 *
 * На Android есть только события Did*, поэтому Will* не слушаем вовсе.
 */
export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({ visible: false, height: 0 });

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setState({ visible: true, height: event.endCoordinates.height });
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setState({ visible: false, height: 0 });
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return state;
}
