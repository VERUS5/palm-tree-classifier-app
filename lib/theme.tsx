import React, { createContext, useContext, useState, useMemo, ReactNode, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";
import Colors, { type ThemeColors } from "@/constants/colors";

export type Theme = "light" | "dark";

const THEME_KEY = "palm_classifier_theme";

interface ThemeContextValue {
  theme: Theme;
  colors: ThemeColors;
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [userTheme, setUserTheme] = useState<Theme | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((saved) => {
      if (saved === "light" || saved === "dark") setUserTheme(saved);
    });
  }, []);

  const theme: Theme = userTheme || (systemScheme === "dark" ? "dark" : "light");

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setUserTheme(next);
    AsyncStorage.setItem(THEME_KEY, next);
  };

  const value = useMemo(
    () => ({
      theme,
      colors: Colors[theme],
      isDark: theme === "dark",
      toggleTheme,
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
