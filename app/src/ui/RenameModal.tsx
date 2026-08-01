import React, { useEffect, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { DURATION, useTransition } from "./motion";

/**
 * Диалог с одним полем ввода.
 *
 * Своё окно, а не Alert.prompt: тот есть только на iOS, а на Android просто
 * ничего не показывает.
 */
export function RenameModal({
  visible,
  title,
  hint,
  initialValue,
  placeholder,
  allowEmpty = false,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  hint?: string;
  initialValue: string;
  placeholder: string;
  /** Пустое значение разрешено — им сбрасывают своё название контакта. */
  allowEmpty?: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}): React.ReactElement {
  const theme = useTheme();
  const [value, setValue] = useState(initialValue);
  const progress = useTransition(visible, DURATION.normal);

  // Открывая диалог заново, показываем актуальное значение, а не прошлый ввод.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const canSubmit = allowEmpty || value.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />

        {/* Карточка не просто проявляется, а слегка «подрастает» — так она
            читается как появившаяся поверх, а не как подменившая экран. */}
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
            },
          ]}
        >
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{title}</Text>
          {hint !== undefined && <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>{hint}</Text>}

          <TextInput
            style={[
              styles.input,
              {
                color: theme.colors.textPrimary,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.background,
              },
            ]}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.textMuted}
            maxLength={40}
            autoFocus
          />

          <View style={styles.actions}>
            <Pressable style={({ pressed }) => [styles.action, pressed && styles.actionPressed]} onPress={onCancel}>
              <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>Отмена</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              onPress={() => onSubmit(value)}
              disabled={!canSubmit}
            >
              <Text style={[styles.actionText, { color: canSubmit ? theme.colors.accent : theme.colors.textMuted }]}>
                Сохранить
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 420, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  title: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginTop: 16,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 6, marginTop: 14 },
  action: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  actionPressed: { opacity: 0.55 },
  actionText: { fontSize: 15, fontWeight: "600" },
});
