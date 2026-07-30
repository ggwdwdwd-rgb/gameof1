export type ThemeName = "light" | "dark";
export type ThemePreference = ThemeName | "system";

export interface Theme {
  name: ThemeName;
  colors: {
    background: string;
    surface: string;
    surfaceElevated: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    accentSoft: string;
    onAccent: string;
    bubbleMine: string;
    bubbleTheirs: string;
    bubbleMineText: string;
    bubbleTheirsText: string;
    danger: string;
    success: string;
    statusBar: "light" | "dark";
  };
}

const lightTheme: Theme = {
  name: "light",
  colors: {
    background: "#f2f3f7",
    surface: "#ffffff",
    surfaceElevated: "#ffffff",
    border: "#e3e5ec",
    textPrimary: "#12141a",
    textSecondary: "#5b6070",
    textMuted: "#9aa0b0",
    accent: "#5b5bd6",
    accentSoft: "#ececfb",
    onAccent: "#ffffff",
    bubbleMine: "#5b5bd6",
    bubbleTheirs: "#ffffff",
    bubbleMineText: "#ffffff",
    bubbleTheirsText: "#12141a",
    danger: "#d94848",
    success: "#2f9e63",
    statusBar: "dark",
  },
};

const darkTheme: Theme = {
  name: "dark",
  colors: {
    background: "#0e1014",
    surface: "#171a21",
    surfaceElevated: "#1f232c",
    border: "#272b35",
    textPrimary: "#f2f3f7",
    textSecondary: "#a3a9b8",
    textMuted: "#6f7686",
    accent: "#7b7bf0",
    accentSoft: "#242452",
    onAccent: "#ffffff",
    bubbleMine: "#4f4fc4",
    bubbleTheirs: "#1f232c",
    bubbleMineText: "#ffffff",
    bubbleTheirsText: "#f2f3f7",
    danger: "#e46060",
    success: "#43b477",
    statusBar: "light",
  },
};

export const themes: Record<ThemeName, Theme> = { light: lightTheme, dark: darkTheme };

/** Палитра аватаров: цвет выбирается детерминированно по userId, чтобы не менялся между запусками. */
const AVATAR_COLORS = ["#5b5bd6", "#2f9e63", "#d98324", "#c2447a", "#3a8fbd", "#7a52c7", "#b0562f", "#2f9e9e"];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}
