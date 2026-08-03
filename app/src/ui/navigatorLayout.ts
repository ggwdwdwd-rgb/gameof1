/**
 * Геометрия перехода между экранами — чистыми функциями, отдельно от Navigator.
 *
 * Отдельно, потому что именно здесь был баг с чёрным экраном, и проверять его
 * надо не глазами на телефоне. React-рендерера в проекте нет, а компонент без
 * него не запустить — зато вот это запускается обычным node и проверяется
 * скриптом (`npm run check:nav`).
 *
 * Главное условие, которое там и проверяется: в ЛЮБОЙ момент перехода два слоя
 * вместе закрывают экран целиком. Незакрытая полоса — это не «щель», это чёрный
 * прямоугольник: фон приложения в тёмной теме равен #000000, и всё, что не
 * закрыто экраном, выглядит дырой.
 */
export type NavDirection = "push" | "pop" | "modal";

export interface NavLayout {
  /** Сдвиг входящего экрана по X: от — при начале перехода, до — в конце. */
  enterX: { from: number; to: number };
  /** Сдвиг входящего по Y — нужен только модальному (выезжает снизу). */
  enterY: { from: number; to: number };
  /** Уходящий экран по X. */
  leaveX: { from: number; to: number };
  /** Прозрачность входящего анимируется только у модального. */
  enterFade: boolean;
  /** Кто рисуется поверх: при возврате — уходящий, он открывает лежащий под ним. */
  leavingOnTop: boolean;
}

export function navLayout(dir: NavDirection, width: number, height: number): NavLayout {
  // Уходящий экран идёт вчетверо короче входящего — эта разница скоростей и
  // читается как слои. Дальше четверти его уводить нельзя: за ней он перестаёт
  // прикрывать край, и появляется та самая дыра.
  const parallax = width * 0.25;

  if (dir === "push") {
    return {
      enterX: { from: width, to: 0 },
      enterY: { from: 0, to: 0 },
      leaveX: { from: 0, to: -parallax },
      enterFade: false,
      leavingOnTop: false,
    };
  }
  if (dir === "pop") {
    return {
      enterX: { from: -parallax, to: 0 },
      enterY: { from: 0, to: 0 },
      leaveX: { from: 0, to: width },
      enterFade: false,
      leavingOnTop: true,
    };
  }
  return {
    enterX: { from: 0, to: 0 },
    enterY: { from: height * 0.28, to: 0 },
    leaveX: { from: 0, to: 0 },
    enterFade: true,
    leavingOnTop: false,
  };
}

/**
 * Снятие уходящего экрана по ответу анимации.
 *
 * Снимаем и когда анимация доиграла, и когда её прервали, — но только если этот
 * переход всё ещё последний. Раньше условие было «только если доиграла», и
 * прерванный переход оставлял уходящий экран висеть поверх нового навсегда:
 * следующего перехода могло и не быть. Проверка по номеру нужна с другой
 * стороны: поздний ответ прерванной анимации не должен снимать переход, который
 * начался после неё.
 */
export function clearTransition<T extends { id: number }>(current: T | null, id: number): T | null {
  return current !== null && current.id === id ? null : current;
}
