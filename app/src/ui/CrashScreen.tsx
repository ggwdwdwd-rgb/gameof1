import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";
import { Icon } from "./Icon";

/**
 * Перехват фатальных ошибок JS.
 *
 * Обработчик по умолчанию в релизной сборке докладывает об ошибке нативной
 * стороне, а та закрывает приложение — снаружи это выглядит как «нажал назад, и
 * приложение просто вышло», без единой подсказки, что произошло. Здесь мы
 * показываем текст ошибки на экране: приложение остаётся открытым, а ошибку
 * можно скопировать и прислать.
 *
 * Нативные сбои (в самих модулях, не в JS) сюда, разумеется, не попадают.
 */
export function useCrashHandler(): { crash: string | null; clear: () => void } {
  const [crash, setCrash] = useState<string | null>(null);

  useEffect(() => {
    const previous = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
      if (isFatal) {
        // Обработчику по умолчанию фатальную ошибку не передаём: он завершит
        // процесс, и пользователь не увидит ничего.
        setCrash(message);
        return;
      }
      previous(error, isFatal);
    });
    return () => ErrorUtils.setGlobalHandler(previous);
  }, []);

  return { crash, clear: () => setCrash(null) };
}

export function CrashScreen({ message, onDismiss }: { message: string; onDismiss: () => void }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20 },
      ]}
    >
      <View style={styles.head}>
        <Icon name="alert" size={26} color={theme.colors.danger} />
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Что-то сломалось</Text>
      </View>

      <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
        Приложение поймало ошибку и не закрылось. Часть экранов может работать неправильно — надёжнее закрыть Cry и
        открыть заново. Текст ниже поможет понять причину.
      </Text>

      <ScrollView
        style={[styles.box, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
        contentContainerStyle={styles.boxContent}
      >
        <Text style={[styles.message, { color: theme.colors.textPrimary }]}>{message}</Text>
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.colors.accentSoft, opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={() => {
            void Clipboard.setStringAsync(message);
            setCopied(true);
          }}
        >
          <Icon name="copy" size={18} color={theme.colors.accent} />
          <Text style={[styles.buttonText, { color: theme.colors.accent }]}>
            {copied ? "Скопировано" : "Скопировать"}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, { backgroundColor: theme.colors.accent, opacity: pressed ? 0.85 : 1 }]}
          onPress={onDismiss}
        >
          <Text style={[styles.buttonText, { color: theme.colors.onAccent }]}>Продолжить</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 21, fontWeight: "700", letterSpacing: -0.3 },
  hint: { fontSize: 14, lineHeight: 20, marginTop: 12 },
  box: { flex: 1, marginTop: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  boxContent: { padding: 14 },
  message: { fontSize: 12.5, lineHeight: 18, fontFamily: "monospace" },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
});
