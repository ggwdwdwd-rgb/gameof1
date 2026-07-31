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
 * Палитра Claude: тёплая терракота как акцент, кремовая бумага в светлой теме и
 * тёплый графит в тёмной. Никаких «холодных» синих — вся серая шкала уводится в
 * тёплую сторону, иначе акцент выглядит инородным.
 */
const lightTheme: Theme = {
  name: "light",
  colors: {
    background: "#faf9f5",
    surface: "#ffffff",
    surfaceElevated: "#ffffff",
    surfacePressed: "#f0eee6",
    border: "#e6e3d9",
    divider: "#efece3",
    textPrimary: "#141413",
    textSecondary: "#605e57",
    textMuted: "#96938a",
    accent: "#d97757",
    accentSoft: "#f7ece7",
    onAccent: "#ffffff",
    bubbleMine: "#d97757",
    bubbleTheirs: "#ffffff",
    bubbleMineText: "#ffffff",
    bubbleTheirsText: "#141413",
    bubbleMineMeta: "rgba(255,255,255,0.78)",
    bubbleTheirsMeta: "#96938a",
    readTick: "#ffffff",
    danger: "#c0492f",
    success: "#3f8f5f",
    wallpaperFrom: "#f4f1e8",
    wallpaperTo: "#faf9f5",
    dateChip: "rgba(20,20,19,0.06)",
    dateChipText: "#605e57",
    shadow: "#141413",
    statusBar: "dark",
  },
};

const darkTheme: Theme = {
  name: "dark",
  colors: {
    background: "#1a1918",
    surface: "#242322",
    surfaceElevated: "#2e2d2b",
    surfacePressed: "#302f2c",
    border: "#3a3835",
    divider: "#2e2d2b",
    textPrimary: "#f5f3ee",
    textSecondary: "#b5b2a8",
    textMuted: "#85827a",
    accent: "#e08a68",
    accentSoft: "#3a2b24",
    onAccent: "#20130d",
    bubbleMine: "#b8613f",
    bubbleTheirs: "#2c2b29",
    bubbleMineText: "#fdf8f5",
    bubbleTheirsText: "#f5f3ee",
    bubbleMineMeta: "rgba(253,248,245,0.72)",
    bubbleTheirsMeta: "#85827a",
    readTick: "#fdf8f5",
    danger: "#e07a62",
    success: "#5cae7c",
    wallpaperFrom: "#161514",
    wallpaperTo: "#1e1d1b",
    dateChip: "rgba(245,243,238,0.09)",
    dateChipText: "#b5b2a8",
    shadow: "#000000",
    statusBar: "light",
  },
};

export const themes: Record<ThemeName, Theme> = { light: lightTheme, dark: darkTheme };

/**
 * Цвета аватаров — тёплые оттенки вокруг акцента, чтобы список чатов выглядел
 * одним набором, а не радугой. Пара выбирается детерминированно по userId,
 * поэтому цвет человека не меняется между запусками. Градиент из двух тонов
 * даёт объём без картинок.
 */
const AVATAR_GRADIENTS: readonly (readonly [string, string])[] = [
  ["#e0906e", "#c9613c"],
  ["#d9a05b", "#bd7333"],
  ["#c98a7a", "#a85b4c"],
  ["#b98f5f", "#94693a"],
  ["#cf7f8e", "#a8505f"],
  ["#a89a72", "#7f7049"],
  ["#d3855e", "#a95c34"],
  ["#9c9b83", "#736f57"],
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
