import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { avatarGradient } from "../theme/theme";

/**
 * Аватар с инициалом на градиенте: пара цветов выбирается по userId, поэтому у
 * человека всегда один и тот же цвет. Градиент рисуется через react-native-svg,
 * чтобы не тянуть отдельную библиотеку.
 */
function AvatarBase({
  name,
  seed,
  size = 52,
  online = false,
  ringColor,
}: {
  name: string;
  seed: string;
  size?: number;
  /** Зелёная точка «в сети» в правом нижнем углу. */
  online?: boolean;
  /** Цвет обводки точки — под фон, на котором нарисован аватар. */
  ringColor?: string;
}): React.ReactElement {
  const initials = initialsOf(name);
  const [from, to] = avatarGradient(seed);
  const gradientId = `avatar-${seed.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0.6" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} rx={size / 2} fill={`url(#${gradientId})`} />
      </Svg>
      <Text style={[styles.text, { fontSize: size * 0.4 }]}>{initials}</Text>
      {online && (
        <View
          style={[
            styles.onlineDot,
            {
              width: size * 0.28,
              height: size * 0.28,
              borderRadius: size * 0.14,
              borderWidth: Math.max(1.5, size * 0.05),
              borderColor: ringColor ?? "#fff",
            },
          ]}
        />
      )}
    </View>
  );
}

/** Мемо: аватары рисуются на каждой строке списка и в каждой шапке. */
export const Avatar = React.memo(AvatarBase);

/** Одна буква для одного слова, две — для «Имя Фамилия». */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase();
  return (words[0]!.slice(0, 1) + words[1]!.slice(0, 1)).toUpperCase();
}

const styles = StyleSheet.create({
  // overflow не скрываем: точка «в сети» выходит за круг аватара.
  wrap: { alignItems: "center", justifyContent: "center" },
  onlineDot: { position: "absolute", right: 0, bottom: 0, backgroundColor: "#3f9e63" },
  text: { color: "#fff", fontWeight: "600", letterSpacing: 0.3 },
});
