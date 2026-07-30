import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../context/AppContext";
import { useTheme, useThemePreference } from "../theme/ThemeContext";
import type { ThemePreference } from "../theme/theme";
import { Avatar } from "../ui/Avatar";
import { Header } from "../ui/Header";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
  { value: "system", label: "Как в системе" },
];

export function SettingsScreen({ onBack }: { onBack: () => void }): React.ReactElement {
  const { identity, contacts, myFingerprint, connectionState } = useApp();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { preference, setPreference } = useThemePreference();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header title="Настройки" onBack={onBack} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>Оформление</Text>
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          {THEME_OPTIONS.map((option, index) => (
            <Pressable
              key={option.value}
              style={[
                styles.optionRow,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
              ]}
              onPress={() => setPreference(option.value)}
            >
              <Text style={[styles.optionLabel, { color: theme.colors.textPrimary }]}>{option.label}</Text>
              {preference === option.value && (
                <Text style={[styles.check, { color: theme.colors.accent }]}>✓</Text>
              )}
            </Pressable>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>Профиль</Text>
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={styles.profileRow}>
            <Avatar name={identity.displayName} seed={identity.userId} size={52} />
            <View style={styles.profileText}>
              <Text style={[styles.profileName, { color: theme.colors.textPrimary }]}>{identity.displayName}</Text>
              <Text style={[styles.profileMeta, { color: theme.colors.textSecondary }]}>
                {connectionState === "connected" ? "на связи" : "нет соединения"}
              </Text>
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Отпечаток моего ключа</Text>
          <Text style={[styles.fingerprint, { color: theme.colors.textPrimary }]}>{myFingerprint}</Text>
          <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
            Сверьте его вслух с собеседником: если совпадает — переписку никто не подменил.
          </Text>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Сервер</Text>
          <Text style={[styles.serverUrl, { color: theme.colors.textPrimary }]}>{identity.serverUrl}</Text>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
          Участники ({contacts.filter((c) => !c.isRevoked).length})
        </Text>
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          {contacts.filter((c) => !c.isRevoked).length === 0 ? (
            <Text style={[styles.hint, { color: theme.colors.textMuted, marginTop: 0 }]}>
              Пока никого нет. Добавьте человека кнопкой «+» в списке чатов.
            </Text>
          ) : (
            contacts
              .filter((c) => !c.isRevoked)
              .map((contact, index) => (
                <View
                  key={contact.userId}
                  style={[
                    styles.memberRow,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
                  ]}
                >
                  <Avatar name={contact.displayName} seed={contact.userId} size={40} />
                  <View style={styles.memberText}>
                    <Text style={[styles.memberName, { color: theme.colors.textPrimary }]}>
                      {contact.displayName}
                    </Text>
                    <Text style={[styles.memberFingerprint, { color: theme.colors.textMuted }]}>
                      {contact.fingerprint}
                    </Text>
                  </View>
                </View>
              ))
          )}
        </View>

        <Text style={[styles.footer, { color: theme.colors.textMuted }]}>
          Сообщения шифруются на устройстве: сервер видит только зашифрованные блобы и удаляет их после доставки.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  sectionTitle: { fontSize: 13, fontWeight: "600", marginBottom: 8, marginTop: 16, marginLeft: 4 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 4 },
  optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 },
  optionLabel: { fontSize: 16 },
  check: { fontSize: 16, fontWeight: "700" },
  profileRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  profileText: { marginLeft: 14, flex: 1 },
  profileName: { fontSize: 17, fontWeight: "600" },
  profileMeta: { fontSize: 13, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  label: { fontSize: 13, marginTop: 12 },
  fingerprint: { fontSize: 15, fontWeight: "600", letterSpacing: 1, marginTop: 6 },
  serverUrl: { fontSize: 15, marginTop: 6, marginBottom: 14 },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 8, marginBottom: 4 },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  memberText: { marginLeft: 12, flex: 1 },
  memberName: { fontSize: 15, fontWeight: "600" },
  memberFingerprint: { fontSize: 11, marginTop: 3, letterSpacing: 0.5 },
  footer: { fontSize: 12, lineHeight: 18, marginTop: 20, textAlign: "center" },
});
