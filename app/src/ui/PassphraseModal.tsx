import React, { useEffect, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { Icon } from "./Icon";
import { DURATION, useTransition } from "./motion";

/**
 * Минимальная длина кодовой фразы.
 *
 * Двенадцать, а не восемь как у пароля: пароль проверяет сервер и может
 * замедлить попытки, а копия лежит на сервере блобом — у того, кто получил
 * доступ к диску, попытки ничем не ограничены, кроме Argon2id. Против словарной
 * атаки этого мало, поэтому просим не «пароль», а фразу из нескольких слов.
 */
export const MIN_PASSPHRASE_LENGTH = 12;

export type PassphraseMode = "create" | "restore";

/**
 * Ввод кодовой фразы для резервной копии.
 *
 * Отдельное окно, а не RenameModal: у фразы своя длина, скрытый ввод и — при
 * создании — обязательное повторение. Опечатка в невидимом поле стоила бы всей
 * копии: расшифровать её потом было бы нечем, и человек узнал бы об этом только
 * на новом телефоне.
 */
export function PassphraseModal({
  visible,
  mode,
  busy = false,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  mode: PassphraseMode;
  /** Копия шифруется и уходит на сервер не мгновенно — окно не закрываем, пока идёт. */
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (passphrase: string) => void;
}): React.ReactElement {
  const theme = useTheme();
  const [value, setValue] = useState("");
  const [repeat, setRepeat] = useState("");
  const [reveal, setReveal] = useState(false);
  const progress = useTransition(visible, DURATION.normal);

  // Открывая окно заново, не показываем прошлый ввод: фраза — секрет, и
  // оставлять её в поле «на следующий раз» нельзя.
  useEffect(() => {
    if (visible) {
      setValue("");
      setRepeat("");
      setReveal(false);
    }
  }, [visible]);

  const creating = mode === "create";
  const tooShort = value.length > 0 && value.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = creating && repeat.length > 0 && repeat !== value;
  const canSubmit =
    !busy && value.length >= MIN_PASSPHRASE_LENGTH && (!creating || repeat === value);

  const problem = tooShort
    ? `Нужно хотя бы ${MIN_PASSPHRASE_LENGTH} символов.`
    : mismatch
      ? "Фразы не совпадают."
      : "";

  const inputStyle = [
    styles.input,
    {
      color: theme.colors.textPrimary,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={busy ? () => {} : onCancel} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onCancel} />

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
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
            {creating ? "Кодовая фраза копии" : "Фраза от копии"}
          </Text>
          <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
            {creating
              ? "Копия шифруется этой фразой на телефоне. Сервер получает только шифротекст и прочитать его не может — поэтому и восстановить фразу не сможет никто. Забыли фразу — копия потеряна."
              : "Введите фразу, которой была зашифрована копия. Другой фразой её не открыть."}
          </Text>

          <TextInput
            style={inputStyle}
            value={value}
            onChangeText={setValue}
            placeholder="несколько несвязанных слов"
            placeholderTextColor={theme.colors.textMuted}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            autoFocus
          />

          {creating && (
            <TextInput
              style={inputStyle}
              value={repeat}
              onChangeText={setRepeat}
              placeholder="повторите фразу"
              placeholderTextColor={theme.colors.textMuted}
              secureTextEntry={!reveal}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
          )}

          <Pressable style={styles.revealRow} onPress={() => setReveal((prev) => !prev)} hitSlop={6}>
            <Icon name={reveal ? "check" : "shield"} size={16} color={theme.colors.textMuted} />
            <Text style={[styles.revealText, { color: theme.colors.textMuted }]}>
              {reveal ? "Фраза видна" : "Показать фразу"}
            </Text>
          </Pressable>

          {problem !== "" && <Text style={[styles.problem, { color: theme.colors.danger }]}>{problem}</Text>}

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              onPress={onCancel}
              disabled={busy}
            >
              <Text style={[styles.actionText, { color: busy ? theme.colors.textMuted : theme.colors.textSecondary }]}>
                Отмена
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              onPress={() => onSubmit(value)}
              disabled={!canSubmit}
            >
              <Text style={[styles.actionText, { color: canSubmit ? theme.colors.accent : theme.colors.textMuted }]}>
                {busy ? "Подождите…" : creating ? "Создать" : "Восстановить"}
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
    marginTop: 14,
  },
  revealRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 12 },
  revealText: { fontSize: 12.5 },
  problem: { fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 6, marginTop: 14 },
  action: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  actionPressed: { opacity: 0.55 },
  actionText: { fontSize: 15, fontWeight: "600" },
});
