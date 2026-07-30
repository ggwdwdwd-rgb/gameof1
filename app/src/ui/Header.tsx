import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";

export function Header({
  title,
  subtitle,
  onBack,
  right,
  left,
  onPressSubtitle,
}: {
  title: string;
  subtitle?: string | undefined;
  onBack?: (() => void) | undefined;
  right?: React.ReactNode;
  left?: React.ReactNode;
  onPressSubtitle?: (() => void) | undefined;
}): React.ReactElement {
  const theme = useTheme();
  // Отступ сверху берём из системных инсетов, а не фиксированным числом:
  // на Android приложение рисуется под строкой состояния (edge-to-edge).
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 10,
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.side}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={14} style={styles.backButton}>
            <Text style={[styles.back, { color: theme.colors.accent }]}>‹</Text>
          </Pressable>
        ) : (
          left
        )}
      </View>

      <View style={styles.center}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Pressable onPress={onPressSubtitle} disabled={!onPressSubtitle} hitSlop={10}>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { width: 76, justifyContent: "center" },
  sideRight: { alignItems: "flex-end" },
  backButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  back: { fontSize: 34, lineHeight: 36, fontWeight: "300" },
  center: { flex: 1, alignItems: "center" },
  title: { fontSize: 17, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 2 },
});
