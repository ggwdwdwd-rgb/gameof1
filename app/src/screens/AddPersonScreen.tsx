import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../context/AppContext";
import type { InviteCreatedPayload } from "../net/protocol";
import { useTheme } from "../theme/ThemeContext";
import { Header } from "../ui/Header";
import { Icon } from "../ui/Icon";

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
            <View style={styles.errorHead}>
              <Icon name="alert" size={20} color={theme.colors.danger} />
              <Text style={[styles.errorTitle, { color: theme.colors.danger }]}>Код не получен</Text>
            </View>
            <Text style={[styles.errorText, { color: theme.colors.textSecondary }]}>{error}</Text>
            {/* Адрес видно и при ошибке: опечатка в нём — частая причина отказа. */}
            <Text style={[styles.hint, { color: theme.colors.textMuted }]}>Адрес сервера: {identity.serverUrl}</Text>
          </View>
        )}

        {invite && (
          <>
            {/* QR на белом поле всегда: сканеры плохо читают инвертированный код. */}
            <View style={[styles.qrCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={styles.qrBox}>
                <QRCode value={invite.qrPayload} size={208} backgroundColor="#ffffff" color="#141413" />
              </View>
              <Text style={[styles.code, { color: theme.colors.textPrimary }]}>{invite.code}</Text>
              <Text style={[styles.codeHint, { color: theme.colors.textMuted }]}>
                Одноразовый, действует {invite.ttlHours} ч. — до{" "}
                {new Date(invite.expiresAt).toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.colors.accent, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={() => void handleShare()}
            >
              <Icon name="share" size={19} color={theme.colors.onAccent} />
              <Text style={[styles.primaryButtonText, { color: theme.colors.onAccent }]}>Поделиться кодом</Text>
            </Pressable>

            <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={[styles.label, { color: theme.colors.textMuted }]}>АДРЕС СЕРВЕРА</Text>
              <Text style={[styles.serverUrl, { color: theme.colors.textPrimary }]}>{identity.serverUrl}</Text>
              <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
                Его тоже нужно ввести на новом устройстве — или он подставится сам при сканировании QR.
              </Text>
            </View>

            <View style={[styles.steps, { borderColor: theme.colors.border }]}>
              {[
                "Покажите QR-код или продиктуйте код из 8 символов",
                "Новый участник вводит его при первом запуске Cry",
                "После входа он появится в списке чатов у всех",
              ].map((step, index) => (
                <View key={step} style={styles.step}>
                  <View style={[styles.stepNumber, { backgroundColor: theme.colors.accentSoft }]}>
                    <Text style={[styles.stepNumberText, { color: theme.colors.accent }]}>{index + 1}</Text>
                  </View>
                  <Text style={[styles.stepText, { color: theme.colors.textSecondary }]}>{step}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {!loading && (
          <Pressable style={styles.secondaryButton} onPress={() => void generate()}>
            <Icon name="refresh" size={18} color={theme.colors.accent} />
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
  content: { padding: 16, gap: 14 },
  loader: { marginTop: 28, alignItems: "center", gap: 12 },
  loaderText: { fontSize: 13.5 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  qrCard: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 20, alignItems: "center" },
  qrBox: { backgroundColor: "#fff", padding: 14, borderRadius: 16 },
  code: { fontSize: 34, fontWeight: "700", letterSpacing: 6, marginTop: 18 },
  codeHint: { fontSize: 12.5, marginTop: 8, textAlign: "center", lineHeight: 18 },
  errorHead: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 10 },
  errorTitle: { fontSize: 15, fontWeight: "600" },
  errorText: { fontSize: 13.5, lineHeight: 19 },
  label: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.8, marginBottom: 7 },
  serverUrl: { fontSize: 15, fontWeight: "500" },
  hint: { fontSize: 12.5, marginTop: 10, lineHeight: 18 },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 15,
    paddingVertical: 16,
  },
  primaryButtonText: { fontSize: 16, fontWeight: "600" },
  steps: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 14 },
  step: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepNumber: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  stepNumberText: { fontSize: 13, fontWeight: "700" },
  stepText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  secondaryButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15 },
  secondaryButtonText: { fontSize: 15, fontWeight: "500" },
});
