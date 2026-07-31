import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { describeFailure, useApp } from "../context/AppContext";
import { useTheme, useThemePreference } from "../theme/ThemeContext";
import type { ThemePreference } from "../theme/theme";
import { Avatar } from "../ui/Avatar";
import { Header } from "../ui/Header";
import { Icon, type IconName } from "../ui/Icon";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "light", label: "Светлая", icon: "sun" },
  { value: "dark", label: "Тёмная", icon: "moon" },
  { value: "system", label: "Как в системе", icon: "contrast" },
];

/** Заголовок группы — как в системных настройках: мелкий, приглушённый. */
function SectionTitle({ children }: { children: string }): React.ReactElement {
  const theme = useTheme();
  return <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>{children.toUpperCase()}</Text>;
}

function Card({ children }: { children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      {children}
    </View>
  );
}

export function SettingsScreen({ onBack }: { onBack: () => void }): React.ReactElement {
  const { identity, contacts, myFingerprint, connectionState, connectionFailure, reconnect } = useApp();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { preference, setPreference } = useThemePreference();
  const failureText = connectionState === "connected" ? "" : describeFailure(connectionFailure);
  const activeContacts = contacts.filter((c) => !c.isRevoked);
  const connected = connectionState === "connected";

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header title="Настройки" onBack={onBack} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.profileHead}>
          <Avatar name={identity.displayName} seed={identity.userId} size={78} />
          <Text style={[styles.profileName, { color: theme.colors.textPrimary }]}>{identity.displayName}</Text>
          <View style={styles.profileStatus}>
            <View
              style={[styles.statusDot, { backgroundColor: connected ? theme.colors.success : theme.colors.textMuted }]}
            />
            <Text style={[styles.profileStatusText, { color: theme.colors.textSecondary }]}>
              {connected ? "на связи" : "нет соединения"}
            </Text>
          </View>
        </View>

        <SectionTitle>Оформление</SectionTitle>
        <Card>
          {THEME_OPTIONS.map((option, index) => {
            const active = preference === option.value;
            return (
              <Pressable
                key={option.value}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
                  pressed && { backgroundColor: theme.colors.surfacePressed },
                ]}
                onPress={() => setPreference(option.value)}
              >
                <View style={[styles.rowIcon, { backgroundColor: theme.colors.accentSoft }]}>
                  <Icon name={option.icon} size={19} color={theme.colors.accent} />
                </View>
                <Text style={[styles.rowLabel, { color: theme.colors.textPrimary }]}>{option.label}</Text>
                {active && <Icon name="check" size={19} color={theme.colors.accent} />}
              </Pressable>
            );
          })}
        </Card>

        <SectionTitle>Безопасность</SectionTitle>
        <Card>
          <View style={styles.block}>
            <View style={styles.blockHead}>
              <Icon name="shield" size={19} color={theme.colors.accent} />
              <Text style={[styles.blockTitle, { color: theme.colors.textPrimary }]}>Отпечаток моего ключа</Text>
            </View>
            <Text style={[styles.fingerprint, { color: theme.colors.textPrimary }]}>{myFingerprint}</Text>
            <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
              Сверьте его вслух с собеседником: если совпадает — переписку никто не подменил.
            </Text>
          </View>
        </Card>

        <SectionTitle>Сервер</SectionTitle>
        <Card>
          <View style={styles.block}>
            <Text style={[styles.serverUrl, { color: theme.colors.textPrimary }]}>{identity.serverUrl}</Text>
            {/* Причина отказа видна здесь, чтобы не гадать, что именно не работает. */}
            {failureText !== "" && (
              <>
                <Text style={[styles.failure, { color: theme.colors.danger }]}>{failureText}</Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.reconnectButton,
                    { backgroundColor: theme.colors.accentSoft, opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={reconnect}
                >
                  <Icon name="refresh" size={18} color={theme.colors.accent} />
                  <Text style={[styles.reconnectText, { color: theme.colors.accent }]}>Подключиться заново</Text>
                </Pressable>
              </>
            )}
          </View>
        </Card>

        <SectionTitle>{`Участники · ${activeContacts.length}`}</SectionTitle>
        <Card>
          {activeContacts.length === 0 ? (
            <View style={styles.block}>
              <Text style={[styles.hint, { color: theme.colors.textMuted, marginTop: 0 }]}>
                Пока никого нет. Добавьте человека кнопкой «+» в списке чатов.
              </Text>
            </View>
          ) : (
            activeContacts.map((contact, index) => (
              <View
                key={contact.userId}
                style={[
                  styles.row,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
                ]}
              >
                <Avatar name={contact.displayName} seed={contact.userId} size={42} />
                <View style={styles.memberText}>
                  <Text style={[styles.memberName, { color: theme.colors.textPrimary }]}>{contact.displayName}</Text>
                  <Text style={[styles.memberFingerprint, { color: theme.colors.textMuted }]}>
                    {contact.fingerprint}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>

        <Text style={[styles.footer, { color: theme.colors.textMuted }]}>
          Cry · сообщения шифруются на устройстве, сервер видит только зашифрованные блобы и удаляет их после доставки.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16 },
  profileHead: { alignItems: "center", paddingTop: 14, paddingBottom: 8 },
  profileName: { fontSize: 22, fontWeight: "700", marginTop: 14, letterSpacing: -0.4 },
  profileStatus: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  profileStatusText: { fontSize: 13.5 },
  sectionTitle: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.8, marginBottom: 8, marginTop: 22, marginLeft: 6 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 15, paddingVertical: 13 },
  rowIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 16 },
  block: { paddingHorizontal: 15, paddingVertical: 15 },
  blockHead: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 10 },
  blockTitle: { fontSize: 15, fontWeight: "600" },
  fingerprint: { fontSize: 16, fontWeight: "600", letterSpacing: 1.2 },
  hint: { fontSize: 12.5, lineHeight: 18, marginTop: 9 },
  serverUrl: { fontSize: 15, fontWeight: "500" },
  failure: { fontSize: 13, lineHeight: 19, marginTop: 10 },
  reconnectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
    borderRadius: 12,
    paddingVertical: 12,
  },
  reconnectText: { fontSize: 15, fontWeight: "600" },
  memberText: { flex: 1 },
  memberName: { fontSize: 15.5, fontWeight: "600" },
  memberFingerprint: { fontSize: 11.5, marginTop: 3, letterSpacing: 0.4 },
  footer: { fontSize: 12, lineHeight: 18, marginTop: 26, textAlign: "center" },
});
