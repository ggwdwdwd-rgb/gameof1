export type ThemeName = "light" | "dark";
export type ThemePreference = ThemeName | "system";

export interface Theme {
  name: ThemeName;
  colors: {
    /** Фон экрана. */
    background: string;
    /** Карточки, шапки, строка ввода. */
    surface: string;
    /** Приподнятые элементы: шторка вложений, бейджи. */
    surfaceElevated: string;
    /** Фон нажатой строки. */
    surfacePressed: string;
    border: string;
    /** Разделитель между строками списка — тоньше и светлее рамки. */
    divider: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    /** Тот же акцент, но приглушённый — для подложек иконок и выделений. */
    accentSoft: string;
    onAccent: string;
    bubbleMine: string;
    bubbleTheirs: string;
    bubbleMineText: string;
    bubbleTheirsText: string;
    /** Время и галочки внутри своего пузыря. */
    bubbleMineMeta: string;
    bubbleTheirsMeta: string;
    /** Галочка «прочитано». */
    readTick: string;
    danger: string;
    success: string;
    /** Обои чата: мягкий вертикальный градиент. */
    wallpaperFrom: string;
    wallpaperTo: string;
    /** Плашка с датой поверх обоев. */
    dateChip: string;
    dateChipText: string;
    shadow: string;
    statusBar: "light" | "dark";
  };
}

/**
 * Чёрно-белая палитра.
 *
 * Цвет здесь не декорация, а единственный способ расставить смысл: акцент —
 * чистый чёрный в светлой теме и чистый белый в тёмной, всё остальное строится
 * серой шкалой. Своё сообщение — инверсия фона (чёрный пузырь с белым текстом и
 * наоборот): в монохроме это самый сильный доступный контраст, и переписка
 * читается с одного взгляда, без цветовых подсказок.
 *
 * Единственное исключение — `danger`: приглушённый красный остаётся на
 * удалении, отзыве доступа и ошибках. Так делают все строгие монохромные
 * интерфейсы: «необратимое действие» нельзя доверять одной типографике, а
 * приглушённый тон не ломает общий вид.
 *
 * «В сети» тоже монохромное: точка красится акцентом с кольцом цвета фона —
 * зелёный тут выглядел бы заплаткой.
 */
const lightTheme: Theme = {
  name: "light",
  colors: {
    // Фон списка чуть темнее карточек — это даёт глубину без теней и рамок.
    background: "#f2f2f2",
    surface: "#ffffff",
    surfaceElevated: "#ffffff",
    surfacePressed: "#e6e6e6",
    border: "#dcdcdc",
    divider: "#e8e8e8",
    textPrimary: "#0a0a0a",
    textSecondary: "#5c5c5c",
    textMuted: "#8e8e8e",
    accent: "#0a0a0a",
    accentSoft: "#ebebeb",
    onAccent: "#ffffff",
    bubbleMine: "#0a0a0a",
    bubbleTheirs: "#ffffff",
    bubbleMineText: "#ffffff",
    bubbleTheirsText: "#0a0a0a",
    bubbleMineMeta: "rgba(255,255,255,0.72)",
    bubbleTheirsMeta: "#8e8e8e",
    readTick: "#ffffff",
    danger: "#8c1d18",
    success: "#0a0a0a",
    wallpaperFrom: "#ededed",
    wallpaperTo: "#f7f7f7",
    dateChip: "rgba(10,10,10,0.07)",
    dateChipText: "#5c5c5c",
    shadow: "#000000",
    statusBar: "dark",
  },
};

/**
 * Тёмная тема — на чистом чёрном, а не на графите.
 *
 * На OLED-экранах чёрный пиксель не горит: интерфейс сливается с рамкой, и
 * получается тот самый вид, за который любят ночные темы мессенджеров. Серая
 * шкала строго нейтральная — любой тёплый или холодный уход сразу читается как
 * «цвет» и рушит монохром.
 */
const darkTheme: Theme = {
  name: "dark",
  colors: {
    background: "#000000",
    surface: "#101010",
    surfaceElevated: "#1c1c1c",
    surfacePressed: "#1f1f1f",
    border: "#262626",
    divider: "#1a1a1a",
    textPrimary: "#f7f7f7",
    textSecondary: "#a8a8a8",
    textMuted: "#6e6e6e",
    accent: "#ffffff",
    accentSoft: "#1c1c1c",
    onAccent: "#0a0a0a",
    bubbleMine: "#f2f2f2",
    bubbleTheirs: "#161616",
    bubbleMineText: "#0a0a0a",
    bubbleTheirsText: "#f7f7f7",
    bubbleMineMeta: "rgba(10,10,10,0.62)",
    bubbleTheirsMeta: "#6e6e6e",
    readTick: "#0a0a0a",
    danger: "#f2b8b5",
    success: "#ffffff",
    wallpaperFrom: "#000000",
    wallpaperTo: "#0b0b0b",
    dateChip: "rgba(247,247,247,0.1)",
    dateChipText: "#a8a8a8",
    shadow: "#000000",
    statusBar: "light",
  },
};

export const themes: Record<ThemeName, Theme> = { light: lightTheme, dark: darkTheme };

/**
 * Аватары — градиенты серой шкалы.
 *
 * Пара выбирается детерминированно по userId, поэтому оттенок человека не
 * меняется между запусками и его узнаёшь в списке. Все восемь достаточно тёмные,
 * чтобы белые инициалы читались, и достаточно разные, чтобы соседние строки не
 * слипались. В монохроме различать людей цветом почти нечем — поэтому взят весь
 * доступный диапазон от угольного до среднего серого.
 */
const AVATAR_GRADIENTS: readonly (readonly [string, string])[] = [
  ["#3d3d3d", "#0f0f0f"],
  ["#6b6b6b", "#2e2e2e"],
  ["#4f4f4f", "#1c1c1c"],
  ["#7d7d7d", "#3f3f3f"],
  ["#2b2b2b", "#000000"],
  ["#5c5c5c", "#242424"],
  ["#8a8a8a", "#4a4a4a"],
  ["#454545", "#141414"],
];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  }
  return hash;
}

export function avatarGradient(seed: string): readonly [string, string] {
  return AVATAR_GRADIENTS[hashSeed(seed) % AVATAR_GRADIENTS.length]!;
}
