import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { getSetting, setSetting } from "../db/settings";
import { themes, type Theme, type ThemePreference } from "./theme";

const SETTING_KEY = "theme_preference";

interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme() вызван вне ThemeProvider");
  return ctx.theme;
}

export function useThemePreference(): Pick<ThemeContextValue, "preference" | "setPreference"> {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemePreference() вызван вне ThemeProvider");
  return { preference: ctx.preference, setPreference: ctx.setPreference };
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    void getSetting(SETTING_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") setPreferenceState(stored);
    });
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const resolved = preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;
    return {
      theme: themes[resolved],
      preference,
      setPreference: (next) => {
        setPreferenceState(next);
        void setSetting(SETTING_KEY, next);
      },
    };
  }, [preference, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
