import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

/**
 * Открыта ли экранная клавиатура.
 *
 * Нужно для нижних отступов: пока клавиатуры нет, строку ввода перекрывают
 * кнопки навигации, и снизу нужен системный инсет. Когда клавиатура поднялась,
 * она уже занимает эту область (Android сообщает высоту клавиатуры вместе с
 * панелью навигации), и тот же инсет превращается в лишнюю пустую полосу.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // На Android событий keyboardWill* нет — слушаем только Did*.
    const show = Keyboard.addListener("keyboardDidShow", () => setVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}
