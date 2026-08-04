/**
 * Геометрия перехода между экранами — чистыми функциями, отдельно от Navigator.
 *
 * Отдельно, потому что именно здесь был баг с чёрным экраном, и проверять его
 * надо не глазами на телефоне. React-рендерера в проекте нет, а компонент без
 * него не запустить — зато вот это запускается обычным node и проверяется
 * скриптом (`npm run check:nav`).
 *
 * Все параметры перехода — числовые диапазоны `{from, to}`, и других мест, где
 * направление разбиралось бы через `dir === "push" ? ... : ...`, в компоненте
 * больше нет: Navigator просто интерполирует то, что здесь посчитано. Это не
 * только чище, но и единственный способ гарантировать симметрию открытия и
 * закрытия модального экрана — если бы её проверяли двумя копипастами внутри
 * компонента, они разошлись бы так же, как разошлись раньше.
 */
export type NavDirection = "push" | "pop" | "modalOpen" | "modalClose";

interface Range {
  from: number;
  to: number;
}

export interface NavLayout {
  enterX: Range;
  enterY: Range;
  enterOpacity: Range;
  enterScale: Range;
  leaveX: Range;
  leaveY: Range;
  leaveOpacity: Range;
  leaveScale: Range;
  /** Кто рисуется поверх: при возврате/закрытии — уходящий, он открывает лежащий под ним. */
  leavingOnTop: boolean;
  /**
   * Нужна ли полоска-тень вдоль края верхнего слоя.
   *
   * Только для горизонтальных переходов (push/pop): там два слоя реально
   * едут относительно друг друга по X, и край между ними — то, что делает
   * переход «слоями». У модального слои не двигаются по горизонтали вовсе:
   * нижний просто дремлет под верхним, и полоска там ничего бы не показала —
   * не там, где хоть что-то происходит на этой оси.
   */
  hasEdgeScrim: boolean;
}

const STATIC: Range = { from: 0, to: 0 };
const OPAQUE: Range = { from: 1, to: 1 };
const FULL_SCALE: Range = { from: 1, to: 1 };

export function navLayout(dir: NavDirection, width: number, height: number): NavLayout {
  // Уходящий экран при push/pop идёт вчетверо короче входящего — эта разница
  // скоростей и читается как слои. Дальше четверти его уводить нельзя: за ней
  // он перестаёт прикрывать край, и появляется дыра — тот самый чёрный экран.
  const parallax = width * 0.25;

  if (dir === "push") {
    return {
      enterX: { from: width, to: 0 },
      enterY: STATIC,
      enterOpacity: OPAQUE,
      enterScale: FULL_SCALE,
      leaveX: { from: 0, to: -parallax },
      leaveY: STATIC,
      leaveOpacity: { from: 1, to: 0.5 },
      leaveScale: FULL_SCALE,
      leavingOnTop: false,
      hasEdgeScrim: true,
    };
  }

  if (dir === "pop") {
    return {
      enterX: { from: -parallax, to: 0 },
      enterY: STATIC,
      enterOpacity: OPAQUE,
      enterScale: FULL_SCALE,
      leaveX: { from: 0, to: width },
      leaveY: STATIC,
      leaveOpacity: OPAQUE,
      leaveScale: FULL_SCALE,
      leavingOnTop: true,
      hasEdgeScrim: true,
    };
  }

  // Нижний слой у модального никогда не движется по X и Y — он остаётся на
  // месте и просто дремлет (дешевле, темнее, чуть мельче), поэтому чёрный
  // экран здесь физически невозможен: кто-то из двух всегда закрывает всё.
  if (dir === "modalOpen") {
    return {
      enterX: STATIC,
      enterY: { from: height * 0.28, to: 0 },
      enterOpacity: { from: 0, to: 1 },
      enterScale: FULL_SCALE,
      leaveX: STATIC,
      leaveY: STATIC,
      leaveOpacity: { from: 1, to: 0.72 },
      leaveScale: { from: 1, to: 0.96 },
      leavingOnTop: false,
      hasEdgeScrim: false,
    };
  }

  // modalClose — ЗЕРКАЛЬНОЕ отражение modalOpen, а не «pop» с горизонтальным
  // сдвигом. Раньше закрытие шло через pop: тот, кто открылся снизу с
  // затемнением фона, уезжал вбок, будто обычный «назад» — движение в упор не
  // совпадало с тем, как экран появился, и это само по себе выглядело сломанным,
  // независимо от частоты кадров. Здесь уходящий доигрывает вход modalOpen в
  // обратную сторону (Y и opacity), а входящий доигрывает выход modalOpen в
  // обратную сторону (opacity и scale) — ровно та же пара чисел, переставленная
  // местами.
  return {
    enterX: STATIC,
    enterY: STATIC,
    enterOpacity: { from: 0.72, to: 1 },
    enterScale: { from: 0.96, to: 1 },
    leaveX: STATIC,
    leaveY: { from: 0, to: height * 0.28 },
    leaveOpacity: { from: 1, to: 0 },
    leaveScale: FULL_SCALE,
    leavingOnTop: true,
    hasEdgeScrim: false,
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
