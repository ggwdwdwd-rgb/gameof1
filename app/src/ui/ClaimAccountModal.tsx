import React, { useEffect, useState } from "react";
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { DURATION, useTransition } from "./motion";

/** Столько же, сколько требует сервер (MIN_PASSWORD_LENGTH). */
const MIN_PASSWORD_LENGTH = 8;

export interface ClaimDraft {
  email: string;
  password: string;
  username: string;
}

/**
 * Привязка почты и пароля к уже существующему участнику.
 *
 * Отдельное окно, а не экран входа: человек уже вошёл, и регистрировать его
 * заново нельзя — это создало бы нового участника и отобрало бы контакты с
 * перепиской. Здесь добавляется только способ войти с нового телефона.
 */
export function ClaimAccountModal({
  visible,
  busy = false,
  suggestedUsername,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  busy?: boolean;
  /** Тег, если он уже есть: менять его заодно человек не просил. */
  suggestedUsername?: string | null;
  onCancel: () => void;
  onSubmit: (draft: ClaimDraft) => void;
}): React.ReactElement {
  const theme = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [username, setUsername] = useState("");
  const progress = useTransition(visible, DURATION.normal);

  // Пароль в поле «на следующий раз» не оставляем: это секрет.
  useEffect(() => {
    if (visible) {
      setEmail("");
      setPassword("");
      setRepeat("");
      setUsername(suggestedUsername ?? "");
    }
  }, [visible, suggestedUsername]);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== password;
  const canSubmit =
    !busy &&
    email.trim().length > 0 &&
    username.trim().length >= 3 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    repeat === password;

  const problem = tooShort
    ? `Пароль короче ${MIN_PASSWORD_LENGTH} символов.`
    : mismatch
      ? "Пароли не совпадают."
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
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={busy ? () => {} : onCancel}
      statusBarTranslucent
    >
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
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Привязать почту и пароль</Text>
            <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
              Вы вошли по одноразовому коду, поэтому войти с другого телефона сейчас нечем. Почта и пароль это
              исправят: аккаунт, переписка и контакты останутся теми же — добавится только способ входа.
            </Text>

            <TextInput
              style={inputStyle}
              value={email}
              onChangeText={setEmail}
              placeholder="почта"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              autoFocus
            />
            <TextInput
              style={inputStyle}
              value={username}
              onChangeText={setUsername}
              placeholder="@тег, по нему вас найдут"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            <TextInput
              style={inputStyle}
              value={password}
              onChangeText={setPassword}
              placeholder="пароль"
              placeholderTextColor={theme.colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            <TextInput
              style={inputStyle}
              value={repeat}
              onChangeText={setRepeat}
              placeholder="повторите пароль"
              placeholderTextColor={theme.colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />

            {problem !== "" && <Text style={[styles.problem, { color: theme.colors.danger }]}>{problem}</Text>}

            <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
              Пароль открывает только привязку нового устройства к аккаунту. Переписку он не расшифровывает — её
              ключи не покидают телефон, и сервер не может её прочитать ни с паролем, ни без него. Чтобы переписка
              переехала на новый телефон, нужна ещё резервная копия ниже.
            </Text>

            <View style={styles.actions}>
              <Pressable
                style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
                onPress={onCancel}
                disabled={busy}
              >
                <Text
                  style={[styles.actionText, { color: busy ? theme.colors.textMuted : theme.colors.textSecondary }]}
                >
                  Отмена
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
                onPress={() => onSubmit({ email, password, username })}
                disabled={!canSubmit}
              >
                <Text style={[styles.actionText, { color: canSubmit ? theme.colors.accent : theme.colors.textMuted }]}>
                  {busy ? "Подождите…" : "Привязать"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "85%",
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
  title: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  hint: { fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginTop: 12,
  },
  problem: { fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 6, marginTop: 14 },
  action: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  actionPressed: { opacity: 0.55 },
  actionText: { fontSize: 15, fontWeight: "600" },
});
