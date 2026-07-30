import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useApp } from "../context/AppContext";
import type { InviteCreatedPayload } from "../net/protocol";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";
import { Header } from "../ui/Header";

const INVITE_ERRORS: Record<"OFFLINE" | "TIMEOUT" | "SERVER_OUTDATED", string> = {
  OFFLINE:
    "Не удалось подключиться к серверу — код выдаёт он, поэтому нужен интернет. " +
    "Проверьте связь и нажмите «Попробовать снова».",
  TIMEOUT: "Сервер не ответил вовремя. Попробуйте ещё раз.",
  SERVER_OUTDATED:
    "Сервер работает на старой версии и не умеет выпускать коды. Обновите его на VPS:\n\n" +
    "cd family-messenger && git pull && docker compose up -d --build",
};

export function AddPersonScreen({ onBack }: { onBack: () => void }): React.ReactElement {
  const { createInvite, identity } = useApp();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [invite, setInvite] = useState<InviteCreatedPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await createInvite();
      if (result.ok) {
        setInvite(result.invite);
      } else {
        // Конкретная причина (отказ сервера, недоступный домен) полезнее общей
        // фразы «нет соединения» — по ней сразу понятно, что делать.
        setError([INVITE_ERRORS[result.reason], result.detail].filter(Boolean).join("\n\n"));
      }
    } catch {
      setError("Не удалось создать код — попробуйте ещё раз.");
    } finally {
      // Снимаем индикатор в любом случае: раньше исключение оставляло
      // экран в бесконечной загрузке.
      setLoading(false);
    }
  }, [createInvite]);

  useEffect(() => {
    void generate();
    // генерируем один код при открытии экрана; повтор — по кнопке
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleShare(): Promise<void> {
    if (!invite) return;
    await Share.share({
      message:
        `Приглашение в Cry\n\n` +
        `Код: ${invite.code}\n` +
        `Адрес сервера: ${identity.serverUrl}\n\n` +
        `Код одноразовый и действует ${invite.ttlHours} ч.`,
    });
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header title="Добавить человека" onBack={onBack} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {loading && (
          <View style={styles.loader}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={[styles.loaderText, { color: theme.colors.textSecondary }]}>Запрашиваем код у сервера…</Text>
          </View>
        )}

        {error && (
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.errorText, { color: theme.colors.danger }]}>{error}</Text>
            {/* Адрес видно и при ошибке: опечатка в нём — частая причина отказа. */}
            <Text style={[styles.hint, { color: theme.colors.textMuted }]}>Адрес сервера: {identity.serverUrl}</Text>
          </View>
        )}

        {invite && (
          <>
            <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Код приглашения</Text>
              <Text style={[styles.code, { color: theme.colors.textPrimary }]}>{invite.code}</Text>
              <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
                Одноразовый, действует {invite.ttlHours} ч. (до{" "}
                {new Date(invite.expiresAt).toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                )
              </Text>
            </View>

            <View style={[styles.card, styles.qrCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={styles.qrBox}>
                <QRCode value={invite.qrPayload} size={196} backgroundColor="#ffffff" color="#000000" />
              </View>
              <Text style={[styles.hint, { color: theme.colors.textMuted, textAlign: "center" }]}>
                Пусть новый участник отсканирует этот код при первом запуске приложения
              </Text>
            </View>

            <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Адрес сервера</Text>
              <Text style={[styles.serverUrl, { color: theme.colors.textPrimary }]}>{identity.serverUrl}</Text>
              <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
                Его тоже нужно ввести на новом устройстве
              </Text>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.colors.accent, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={() => void handleShare()}
            >
              <Text style={[styles.primaryButtonText, { color: theme.colors.onAccent }]}>Поделиться</Text>
            </Pressable>
          </>
        )}

        {!loading && (
          <Pressable style={styles.secondaryButton} onPress={() => void generate()}>
            <Text style={[styles.secondaryButtonText, { color: theme.colors.accent }]}>
              {invite ? "Создать ещё один код" : "Попробовать снова"}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  loader: { marginTop: 24, alignItems: "center", gap: 10 },
  loaderText: { fontSize: 13 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  qrCard: { alignItems: "center", gap: 12 },
  qrBox: { backgroundColor: "#fff", padding: 12, borderRadius: 12 },
  label: { fontSize: 13, marginBottom: 6 },
  code: { fontSize: 34, fontWeight: "700", letterSpacing: 4 },
  serverUrl: { fontSize: 15, fontWeight: "500" },
  hint: { fontSize: 12, marginTop: 8, lineHeight: 17 },
  errorText: { fontSize: 14 },
  primaryButton: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  primaryButtonText: { fontSize: 16, fontWeight: "600" },
  secondaryButton: { paddingVertical: 14, alignItems: "center" },
  secondaryButtonText: { fontSize: 15, fontWeight: "500" },
});
