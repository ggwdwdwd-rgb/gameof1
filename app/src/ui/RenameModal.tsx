import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";

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

  // Открывая диалог заново, показываем актуальное значение, а не прошлый ввод.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const canSubmit = allowEmpty || value.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />

        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
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
            <Pressable style={styles.action} onPress={onCancel}>
              <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>Отмена</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => onSubmit(value)} disabled={!canSubmit}>
              <Text style={[styles.actionText, { color: canSubmit ? theme.colors.accent : theme.colors.textMuted }]}>
                Сохранить
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
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
  action: { paddingVertical: 10, paddingHorizontal: 16 },
  actionText: { fontSize: 15, fontWeight: "600" },
});
