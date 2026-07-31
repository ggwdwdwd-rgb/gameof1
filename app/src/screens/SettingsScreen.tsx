import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { describeFailure, useApp } from "../context/AppContext";
import { contactTitle, type Contact } from "../db/contacts";
import { useTheme, useThemePreference } from "../theme/ThemeContext";
import type { ThemePreference } from "../theme/theme";
import { Avatar } from "../ui/Avatar";
import { Header } from "../ui/Header";
import { Icon, type IconName } from "../ui/Icon";
import { RenameModal } from "../ui/RenameModal";
import { describePresence } from "../ui/presence";
import { getPermissionState, requestPermission, showTest } from "../notify/notifications";

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
  const {
    identity,
    contacts,
    myFingerprint,
    connectionState,
    connectionFailure,
    reconnect,
    displayName,
    notificationsEnabled,
    setNotificationsEnabled,
    renameSelf,
    renameContact,
    presence,
  } = useApp();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { preference, setPreference } = useThemePreference();
  const failureText = connectionState === "connected" ? "" : describeFailure(connectionFailure);
  const activeContacts = contacts.filter((c) => !c.isRevoked);
  const connected = connectionState === "connected";

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [savingName, setSavingName] = useState(false);
  /** Разрешение на уведомления могло быть отозвано в настройках телефона. */
  const [permissionDenied, setPermissionDenied] = useState(false);
  /** Контакт, которому меняем своё название. */
  const [renaming, setRenaming] = useState<Contact | null>(null);

  useEffect(() => {
    void getPermissionState().then((state) => setPermissionDenied(state === "denied"));
  }, []);

  const handleSaveName = useCallback(async () => {
    setSavingName(true);
    try {
      if (await renameSelf(nameDraft)) {
        setEditingName(false);
        return;
      }
      Alert.alert(
        "Имя не сохранено",
        nameDraft.trim().length === 0 || nameDraft.trim().length > 40
          ? "Имя должно быть от 1 до 40 символов."
          : "Нужно соединение с сервером: имя видят остальные участники, поэтому оно меняется сразу у всех.",
      );
    } finally {
      setSavingName(false);
    }
  }, [nameDraft, renameSelf]);

  const handleToggleNotifications = useCallback(
    async (next: boolean) => {
      if (!next) {
        await setNotificationsEnabled(false);
        return;
      }
      const state = await requestPermission();
      if (state !== "granted") {
        setPermissionDenied(state === "denied");
        Alert.alert(
          "Нет разрешения на уведомления",
          "Разрешите уведомления для Cry в настройках телефона — без этого показать их нельзя.",
        );
        return;
      }
      setPermissionDenied(false);
      await setNotificationsEnabled(true);
    },
    [setNotificationsEnabled],
  );

  /**
   * Пробное уведомление. Проверять уведомления «пусть кто-нибудь напишет»
   * неудобно, а причину молчания без такой кнопки не отличить: разрешение,
   * канал или системный запрет.
   */
  const handleTestNotification = useCallback(async () => {
    const state = await requestPermission();
    if (state !== "granted") {
      setPermissionDenied(state === "denied");
      Alert.alert("Нет разрешения", "Разрешите уведомления для Cry в настройках телефона.");
      return;
    }
    try {
      await showTest();
    } catch (error) {
      Alert.alert("Уведомление не показалось", error instanceof Error ? error.message : String(error));
    }
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header title="Настройки" onBack={onBack} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.profileHead}>
          <Avatar name={displayName} seed={identity.userId} size={78} />

          {editingName ? (
            <View style={styles.nameEditor}>
              <TextInput
                style={[
                  styles.nameInput,
                  {
                    color: theme.colors.textPrimary,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface,
                  },
                ]}
                value={nameDraft}
                onChangeText={setNameDraft}
                maxLength={40}
                autoFocus
                editable={!savingName}
                placeholder="Как вас видят остальные"
                placeholderTextColor={theme.colors.textMuted}
              />
              <View style={styles.nameActions}>
                <Pressable
                  style={styles.nameAction}
                  onPress={() => {
                    setNameDraft(displayName);
                    setEditingName(false);
                  }}
                  disabled={savingName}
                >
                  <Text style={[styles.nameActionText, { color: theme.colors.textSecondary }]}>Отмена</Text>
                </Pressable>
                <Pressable style={styles.nameAction} onPress={() => void handleSaveName()} disabled={savingName}>
                  {savingName ? (
                    <ActivityIndicator color={theme.colors.accent} />
                  ) : (
                    <Text style={[styles.nameActionText, { color: theme.colors.accent }]}>Сохранить</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              style={styles.nameRow}
              onPress={() => {
                setNameDraft(displayName);
                setEditingName(true);
              }}
              hitSlop={8}
            >
              <Text style={[styles.profileName, { color: theme.colors.textPrimary }]}>{displayName}</Text>
              <Icon name="edit" size={17} color={theme.colors.textMuted} />
            </Pressable>
          )}

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

        <SectionTitle>Уведомления</SectionTitle>
        <Card>
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: theme.colors.accentSoft }]}>
              <Icon name="bell" size={19} color={theme.colors.accent} />
            </View>
            <Text style={[styles.rowLabel, { color: theme.colors.textPrimary }]}>Новые сообщения</Text>
            <Switch
              value={notificationsEnabled}
              onValueChange={(next) => void handleToggleNotifications(next)}
              trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
              thumbColor={theme.colors.surface}
            />
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.row,
              { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
              pressed && { backgroundColor: theme.colors.surfacePressed },
            ]}
            onPress={() => void handleTestNotification()}
          >
            <View style={[styles.rowIcon, { backgroundColor: theme.colors.accentSoft }]}>
              <Icon name="check" size={19} color={theme.colors.accent} />
            </View>
            <Text style={[styles.rowLabel, { color: theme.colors.textPrimary }]}>Проверить уведомление</Text>
          </Pressable>
          <View style={[styles.block, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider }]}>
            <Text style={[styles.hint, { color: theme.colors.textMuted, marginTop: 0 }]}>
              Уведомление показывает само приложение, когда получает сообщение — сервер о содержимом не знает. Пока Cry
              свёрнут, соединение живёт и уведомления приходят; если система выгрузит приложение из памяти, сообщения
              появятся при следующем открытии.
            </Text>
            {permissionDenied && (
              <Text style={[styles.failure, { color: theme.colors.danger }]}>
                Уведомления запрещены в настройках телефона — включить их из приложения нельзя.
              </Text>
            )}
          </View>
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
            activeContacts.map((contact, index) => {
              const online = presence.get(contact.userId)?.online === true;
              const status = describePresence(presence.get(contact.userId));
              return (
                <Pressable
                  key={contact.userId}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
                    pressed && { backgroundColor: theme.colors.surfacePressed },
                  ]}
                  onPress={() => setRenaming(contact)}
                >
                  <Avatar
                    name={contactTitle(contact)}
                    seed={contact.userId}
                    size={42}
                    online={online}
                    ringColor={theme.colors.surface}
                  />
                  <View style={styles.memberText}>
                    <Text style={[styles.memberName, { color: theme.colors.textPrimary }]}>
                      {contactTitle(contact)}
                    </Text>
                    {/* Если название своё — показываем и настоящее имя, чтобы
                        человека можно было опознать. */}
                    <Text style={[styles.memberFingerprint, { color: theme.colors.textMuted }]}>
                      {contact.localName !== null ? `${contact.displayName} · ` : ""}
                      {status !== "" ? status : contact.fingerprint}
                    </Text>
                  </View>
                  <Icon name="edit" size={17} color={theme.colors.textMuted} />
                </Pressable>
              );
            })
          )}
        </Card>

        {activeContacts.length > 0 && (
          <Text style={[styles.hint, { color: theme.colors.textMuted, marginLeft: 6 }]}>
            Нажмите на участника, чтобы подписать его по-своему — это название видно только на вашем устройстве.
          </Text>
        )}

        <Text style={[styles.footer, { color: theme.colors.textMuted }]}>
          Cry · сообщения шифруются на устройстве, сервер видит только зашифрованные блобы и удаляет их после доставки.
        </Text>
      </ScrollView>

      <RenameModal
        visible={renaming !== null}
        title="Название контакта"
        hint={
          renaming
            ? `Как подписать ${renaming.displayName} на этом устройстве. Пустое поле вернёт настоящее имя.`
            : undefined
        }
        initialValue={renaming?.localName ?? ""}
        placeholder={renaming?.displayName ?? ""}
        allowEmpty
        onCancel={() => setRenaming(null)}
        onSubmit={(value) => {
          const target = renaming;
          setRenaming(null);
          if (target) void renameContact(target.userId, value);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16 },
  profileHead: { alignItems: "center", paddingTop: 14, paddingBottom: 8 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  profileName: { fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
  nameEditor: { alignSelf: "stretch", marginTop: 14 },
  nameInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    textAlign: "center",
  },
  nameActions: { flexDirection: "row", justifyContent: "center", gap: 18, marginTop: 10 },
  nameAction: { paddingVertical: 8, paddingHorizontal: 12, minWidth: 90, alignItems: "center" },
  nameActionText: { fontSize: 15, fontWeight: "600" },
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
