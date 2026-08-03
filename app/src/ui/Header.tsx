import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";
import { DURATION, EASE_OUT } from "./motion";
import { Icon } from "./Icon";

/**
 * Шапка двух видов:
 *  - `align="center"` — заголовок по центру (список чатов, настройки);
 *  - `align="left"` — как в чате мессенджеров: стрелка, аватар, имя и статус
 *    прижаты влево, потому что читать имя собеседника удобнее у края.
 */
export function Header({
  title,
  subtitle,
  onBack,
  right,
  left,
  onPressSubtitle,
  onPressTitle,
  avatar,
  align = "center",
  subtitleColor,
  subtitleNode,
}: {
  title: string;
  subtitle?: string | undefined;
  /**
   * Подзаголовок отдельным элементом вместо строки — для «печатает» с
   * анимированными точками. Имеет приоритет над subtitle.
   */
  subtitleNode?: React.ReactNode;
  onBack?: (() => void) | undefined;
  right?: React.ReactNode;
  left?: React.ReactNode;
  onPressSubtitle?: (() => void) | undefined;
  onPressTitle?: (() => void) | undefined;
  avatar?: React.ReactNode;
  align?: "center" | "left";
  subtitleColor?: string | undefined;
}): React.ReactElement {
  const theme = useTheme();
  // Отступ сверху берём из системных инсетов, а не фиксированным числом:
  // на Android приложение рисуется под строкой состояния (edge-to-edge).
  const insets = useSafeAreaInsets();

  /**
   * Подзаголовок меняется не подменой, а перетеканием.
   *
   * В чате он переключается между «был(а) недавно» и «печатает…» — то есть
   * дёргается ровно в тот момент, когда человек смотрит на шапку. Мгновенная
   * подмена читается как рывок; сдвиг на два пикселя с проявлением — как одна
   * строка, которая сменилась.
   */
  const subtitleKey = subtitleNode ? "node" : (subtitle ?? "");
  const swap = useRef(new Animated.Value(1)).current;
  const shown = useRef(subtitleKey);
  useEffect(() => {
    if (shown.current === subtitleKey) return;
    shown.current = subtitleKey;
    swap.setValue(0);
    Animated.timing(swap, { toValue: 1, duration: DURATION.fast, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [subtitleKey, swap]);

  const subtitleStyle = {
    opacity: swap,
    transform: [{ translateY: swap.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }],
  };

  const titleBlock = (
    <View style={align === "left" ? styles.textLeft : styles.textCenter}>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>
        {title}
      </Text>
      {subtitleNode ? (
        <Animated.View style={[styles.subtitleNode, subtitleStyle]}>{subtitleNode}</Animated.View>
      ) : subtitle ? (
        <Animated.View style={subtitleStyle}>
          <Pressable onPress={onPressSubtitle} disabled={!onPressSubtitle} hitSlop={8}>
            <Text
              style={[styles.subtitle, { color: subtitleColor ?? theme.colors.textSecondary }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 8,
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.divider,
        },
      ]}
    >
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.5 : 1, transform: [{ scale: pressed ? 0.9 : 1 }] }]}
        >
          <Icon name="back" size={24} color={theme.colors.accent} />
        </Pressable>
      ) : (
        left
      )}

      {avatar ? <View style={styles.avatarSlot}>{avatar}</View> : null}

      {align === "left" ? (
        <Pressable style={styles.leftGrow} onPress={onPressTitle} disabled={!onPressTitle}>
          {titleBlock}
        </Pressable>
      ) : (
        <View style={styles.centerGrow}>{titleBlock}</View>
      )}

      <View style={styles.rightSlot}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 10,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  avatarSlot: { marginLeft: 2, marginRight: 10 },
  leftGrow: { flex: 1, justifyContent: "center" },
  // При центрированном заголовке слоты по бокам одинаковой ширины, иначе
  // заголовок «съезжает» относительно середины экрана.
  centerGrow: { flex: 1, alignItems: "center", marginHorizontal: 4 },
  rightSlot: { minWidth: 36, alignItems: "flex-end", justifyContent: "center" },
  textLeft: { alignItems: "flex-start" },
  textCenter: { alignItems: "center" },
  title: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
  subtitle: { fontSize: 12.5, marginTop: 1.5 },
  subtitleNode: { marginTop: 1.5 },
});
