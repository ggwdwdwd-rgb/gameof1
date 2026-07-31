import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "../theme/ThemeContext";

/**
 * Фон чата: очень мягкий вертикальный градиент плюс два едва заметных тёплых
 * пятна. Однотонный фон делал пузыри «плоскими», а картинка-обои утяжелила бы
 * сборку — этого достаточно и рисуется одним Svg.
 */
export function Wallpaper(): React.ReactElement {
  const theme = useTheme();
  const blobOpacity = theme.name === "light" ? 0.5 : 0.22;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="wallpaper" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.colors.wallpaperFrom} />
            <Stop offset="1" stopColor={theme.colors.wallpaperTo} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#wallpaper)" />
        <Circle cx="12%" cy="14%" r="140" fill={theme.colors.accentSoft} opacity={blobOpacity} />
        <Circle cx="96%" cy="72%" r="190" fill={theme.colors.accentSoft} opacity={blobOpacity * 0.8} />
      </Svg>
    </View>
  );
}
