import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "../theme/ThemeContext";

/** Знак приложения: скруглённый квадрат с градиентом акцента и буквой «C». */
export function LogoMark({ size = 76 }: { size?: number }): React.ReactElement {
  const theme = useTheme();
  const radius = size * 0.29;

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: radius, shadowColor: theme.colors.accent },
      ]}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="logo" x1="0" y1="0" x2="0.9" y2="1">
            <Stop offset="0" stopColor={theme.name === "light" ? "#e79572" : "#e8967a"} />
            <Stop offset="1" stopColor={theme.name === "light" ? "#c25f38" : "#b8613f"} />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} rx={radius} fill="url(#logo)" />
      </Svg>
      <Text style={[styles.letter, { fontSize: size * 0.46 }]}>C</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    elevation: 8,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  letter: { color: "#fff", fontWeight: "700", letterSpacing: -1 },
});
