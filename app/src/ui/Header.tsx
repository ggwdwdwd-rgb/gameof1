import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";
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
}: {
  title: string;
  subtitle?: string | undefined;
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

  const titleBlock = (
    <View style={align === "left" ? styles.textLeft : styles.textCenter}>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Pressable onPress={onPressSubtitle} disabled={!onPressSubtitle} hitSlop={8}>
          <Text
            style={[styles.subtitle, { color: subtitleColor ?? theme.colors.textSecondary }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        </Pressable>
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
        <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
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
});
