import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { describeFailure, useApp } from "../context/AppContext";
import { contactTitle, type Contact } from "../db/contacts";
import { countMessages } from "../db/messages";
import { countOutbox } from "../db/outbox";
import { useTheme, useThemePreference } from "../theme/ThemeContext";
import type { Theme, ThemePreference } from "../theme/theme";
import { ActionSheet, type SheetAction } from "../ui/ActionSheet";
import { Avatar } from "../ui/Avatar";
import { Header } from "../ui/Header";
import { Icon, type IconName } from "../ui/Icon";
import { RenameModal } from "../ui/RenameModal";
import { describePresence } from "../ui/presence";
import { PinSetupModal } from "../ui/PinSetupModal";
import { isBiometricsSupported } from "../lock/biometrics";
import { getCrypto } from "../crypto/sodium";
import { clearLockConfig, loadLockConfig, saveLockConfig, type LockConfig } from "../storage/lock";
import { buildLabel } from "../util/buildInfo";
import { getPermissionState, requestPermission, showTest } from "../notify/notifications";
import { BACKGROUND_RUN_SETTING } from "../background/task";
import { getSetting } from "../db/settings";
import type { SelfTestStep } from "../context/AppContext";

/** «5 мин назад» из отметки о запуске фоновой задачи. */
function describeBackgroundRun(stored: string | null): string {
  const ts = stored === null ? NaN : Number(stored);
  if (!Number.isFinite(ts) || ts <= 0) return "ни разу";
  const minutes = Math.floor((Date.now() - ts) / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return new Date(ts).toLocaleString("ru-RU");
}

/**
 * Через сколько после сворачивания снова спрашивать код.
 *
 * «Сразу» не означает «после каждого выбора фото»: системные окна приложение
 * отмечает отдельно и уходом человека не считает (см. lock/systemPicker).
 */
const GRACE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Сразу" },
  { value: 60, label: "Через минуту" },
  { value: 300, label: "Через 5 минут" },
];

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

/** Строка «показатель — значение» в блоке диагностики. */
function DiagRow({
  label,
  value,
  theme,
  alarm = false,
}: {
  label: string;
  value: string;
  theme: Theme;
  alarm?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.diagRow}>
      <Text style={[styles.diagLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.diagValue, { color: alarm ? theme.colors.danger : theme.colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      {children}
    </View>
  );
}

export function SettingsScreen({
  onBack,
  onLockChanged,
}: {
  onBack: () => void;
  /** Перечитать настройки блокировки: их держит App, а меняются они здесь. */
  onLockChanged: () => Promise<LockConfig | null>;
}): React.ReactElement {
  const {
    identity,
    contacts,
    myFingerprint,
    connectionState,
    connectionFailure,
    reconnect,
    displayName,
    username,
    notificationsEnabled,
    setNotificationsEnabled,
    renameSelf,
    renameContact,
    presence,
    selfTest,
    isAdmin,
    removeMember,
    revokeDevice,
    backgroundEnabled,
    backgroundAvailable,
    setBackgroundEnabled,
  } = useApp();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { preference, setPreference } = useThemePreference();
  const failureText = connectionState === "connected" ? "" : describeFailure(connectionFailure);
  const activeContacts = contacts.filter((c) => !c.isRevoked);
  // Отозванных показываем в конце списка, а не скрываем: иначе снять отзыв было
  // бы нечем, кроме командной строки на сервере, а сам факт отзыва выглядел бы
  // как «человек пропал».
  const listedContacts = useMemo(
    () => [...contacts].sort((a, b) => Number(a.isRevoked) - Number(b.isRevoked)),
    [contacts],
  );
  const connected = connectionState === "connected";

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [savingName, setSavingName] = useState(false);
  /** Разрешение на уведомления могло быть отозвано в настройках телефона. */
  const [permissionDenied, setPermissionDenied] = useState(false);
  /** Контакт, которому меняем своё название. */
  const [renaming, setRenaming] = useState<Contact | null>(null);
  /** Контакт, для которого открыт лист действий. */
  const [menuFor, setMenuFor] = useState<Contact | null>(null);

  /** Блокировка приложения: null — выключена. */
  const [lock, setLock] = useState<LockConfig | null>(null);
  // Нативной части биометрии может не быть в сборке — тогда переключатель
  // обещал бы то, чего приложение не умеет.
  const biometricsSupported = isBiometricsSupported();
  const [pinMode, setPinMode] = useState<"set" | "change" | "disable" | null>(null);

  const refreshLock = useCallback(async () => {
    setLock(await loadLockConfig());
  }, []);
  useEffect(() => {
    void refreshLock();
  }, [refreshLock]);

  /** Проверка текущего кода — нужна перед сменой и снятием блокировки. */
  const verifyCurrentPin = useCallback(
    async (pin: string): Promise<boolean> => {
      if (!lock) return false;
      const crypto = await getCrypto();
      return crypto.verifyPin(pin, lock.salt, lock.hash);
    },
    [lock],
  );

  /** Любое изменение блокировки сохраняем и сообщаем App: экран блокировки его. */
  const applyLock = useCallback(
    async (next: LockConfig | null) => {
      if (next === null) await clearLockConfig();
      else await saveLockConfig(next);
      setLock(next);
      await onLockChanged();
    },
    [onLockChanged],
  );

  /**
   * Диагностика. Когда «на связи», но сообщения не ходят, по экрану этого не
   * понять: очередь отправки, число контактов и число сообщений в базе
   * разделяют совершенно разные причины — сервер не принимает, список
   * участников не разобрался, база не пишется.
   */
  const [diag, setDiag] = useState<{ outbox: number; messages: number; backgroundRun: string } | null>(null);
  const refreshDiag = useCallback(async () => {
    setDiag({
      outbox: await countOutbox(),
      messages: await countMessages(),
      backgroundRun: describeBackgroundRun(await getSetting(BACKGROUND_RUN_SETTING)),
    });
  }, []);

  /** Результат самопроверки по шагам: видно, на каком именно всё встаёт. */
  const [steps, setSteps] = useState<SelfTestStep[] | null>(null);
  const [testing, setTesting] = useState(false);
  const runSelfTest = useCallback(async () => {
    setTesting(true);
    try {
      setSteps(await selfTest());
      await refreshDiag();
    } catch (error) {
      setSteps([
        { name: "Самопроверка", ok: false, detail: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setTesting(false);
    }
  }, [selfTest, refreshDiag]);

  useEffect(() => {
    void getPermissionState().then((state) => setPermissionDenied(state === "denied"));
    void refreshDiag();
  }, [refreshDiag]);

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

  /**
   * Удаление участника. Спрашиваем подтверждение: действие необратимо и
   * затрагивает всех — у каждого исчезнет чат с этим человеком.
   */
  const confirmRemove = useCallback(
    (contact: Contact) => {
      Alert.alert(
        `Удалить ${contactTitle(contact)}?`,
        "Участник исчезнет у всех вместе с перепиской. Вернуть его можно только новым кодом приглашения — и это будет уже новый человек с новыми ключами.",
        [
          { text: "Отмена", style: "cancel" },
          {
            text: "Удалить",
            style: "destructive",
            onPress: () => {
              void (async () => {
                const result = await removeMember(contact.userId);
                if (!result.ok) Alert.alert("Участник не удалён", result.detail);
              })();
            },
          },
        ],
      );
    },
    [removeMember],
  );

  /**
   * Отзыв доступа устройства: телефон потерян или украден.
   *
   * Мера обратимая и мягче удаления — переписка остаётся у всех, включая самого
   * отозванного. Спрашиваем всё равно: человек мгновенно теряет связь.
   */
  const confirmRevoke = useCallback(
    (contact: Contact) => {
      if (contact.isRevoked) {
        Alert.alert(
          `Вернуть доступ ${contactTitle(contact)}?`,
          "Устройство снова сможет подключаться и получать сообщения. Если ключи с телефона пропали (переустановка или сброс), вернуть доступ этим способом не получится — понадобится новый код приглашения.",
          [
            { text: "Отмена", style: "cancel" },
            {
              text: "Вернуть",
              onPress: () => {
                void (async () => {
                  const result = await revokeDevice(contact.userId, false);
                  if (!result.ok) Alert.alert("Доступ не возвращён", result.detail);
                })();
              },
            },
          ],
        );
        return;
      }
      Alert.alert(
        `Отозвать доступ ${contactTitle(contact)}?`,
        "Телефон этого участника сразу отключится от сервера и перестанет получать сообщения. Переписка у всех остаётся на месте, и доступ можно вернуть тем же способом.",
        [
          { text: "Отмена", style: "cancel" },
          {
            text: "Отозвать",
            style: "destructive",
            onPress: () => {
              void (async () => {
                const result = await revokeDevice(contact.userId, true);
                if (!result.ok) Alert.alert("Доступ не отозван", result.detail);
              })();
            },
          },
        ],
      );
    },
    [revokeDevice],
  );

  const memberActions = useMemo((): SheetAction[] => {
    const contact = menuFor;
    if (!contact) return [];
    const actions: SheetAction[] = [
      { label: "Переименовать у себя", icon: "edit", onPress: () => setRenaming(contact) },
    ];
    // Кнопки только у админа: у остальных сервер всё равно откажет, и показывать
    // их означало бы предлагать заведомо невозможное.
    if (isAdmin) {
      actions.push({
        label: contact.isRevoked ? "Вернуть доступ устройству" : "Отозвать доступ устройству",
        icon: contact.isRevoked ? "refresh" : "alert",
        destructive: !contact.isRevoked,
        onPress: () => confirmRevoke(contact),
      });
      actions.push({
        label: "Удалить участника",
        icon: "trash",
        destructive: true,
        onPress: () => confirmRemove(contact),
      });
    }
    return actions;
  }, [menuFor, isAdmin, confirmRemove, confirmRevoke]);

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

          {/* Свой @тег под именем: его дают другим, чтобы нашли. */}
          {username !== null && (
            <Text style={[styles.profileTag, { color: theme.colors.textMuted }]}>@{username}</Text>
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
          <View style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider }]}>
            <View style={[styles.rowIcon, { backgroundColor: theme.colors.accentSoft }]}>
              <Icon name="refresh" size={19} color={theme.colors.accent} />
            </View>
            <Text style={[styles.rowLabel, { color: theme.colors.textPrimary }]}>Работать в фоне</Text>
            <Switch
              value={backgroundEnabled && backgroundAvailable}
              disabled={!backgroundAvailable}
              onValueChange={(next) => void setBackgroundEnabled(next)}
              trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
              thumbColor={theme.colors.surface}
            />
          </View>
          <View style={[styles.block, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider }]}>
            <Text style={[styles.hint, { color: theme.colors.textMuted, marginTop: 0 }]}>
              {backgroundAvailable
                ? "Пока включено, Cry держит соединение и после сворачивания — уведомления приходят, даже если приложение закрыто. Android требует показывать при этом постоянное уведомление «Cry на связи»: убрать его нельзя, но оно беззвучное и лежит в самом низу шторки."
                : "Эта сборка приложения не умеет работать в фоне — нужен новый APK. Без неё уведомления приходят только пока Cry открыт."}
            </Text>
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
              Уведомление показывает само приложение, когда получает сообщение — сервер о содержимом не знает и
              рассылать их не может даже теоретически.
            </Text>
            <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
              Если уведомления приходят только пока Cry открыт, проверьте «Работать в фоне» выше, а затем в настройках
              телефона: Приложения → Cry → Батарея → «Без ограничений». На телефонах Samsung ещё Батарея → «Спящие
              приложения» — Cry там быть не должно, иначе система выгружает его сразу после сворачивания.
            </Text>
            {permissionDenied && (
              <Text style={[styles.failure, { color: theme.colors.danger }]}>
                Уведомления запрещены в настройках телефона — включить их из приложения нельзя.
              </Text>
            )}
          </View>
        </Card>

        <SectionTitle>Блокировка</SectionTitle>
        <Card>
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: theme.colors.accentSoft }]}>
              <Icon name="shield" size={19} color={theme.colors.accent} />
            </View>
            <Text style={[styles.rowLabel, { color: theme.colors.textPrimary }]}>Код при входе</Text>
            <Switch
              value={lock !== null}
              onValueChange={(next) => setPinMode(next ? "set" : "disable")}
              trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
              thumbColor={theme.colors.surface}
            />
          </View>

          {lock !== null && (
            <>
              <View
                style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider }]}
              >
                <View style={[styles.rowIcon, { backgroundColor: theme.colors.accentSoft }]}>
                  <Icon name="check" size={19} color={theme.colors.accent} />
                </View>
                <Text style={[styles.rowLabel, { color: theme.colors.textPrimary }]}>
                  Отпечаток или лицо
                  {!biometricsSupported && (
                    <Text style={{ color: theme.colors.textMuted }}>{"\nнет в этой сборке"}</Text>
                  )}
                </Text>
                <Switch
                  value={lock.biometrics && biometricsSupported}
                  disabled={!biometricsSupported}
                  onValueChange={(next) => void applyLock({ ...lock, biometrics: next })}
                  trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
                  thumbColor={theme.colors.surface}
                />
              </View>

              <View
                style={[
                  styles.block,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
                ]}
              >
                <Text style={[styles.hint, { color: theme.colors.textMuted, marginTop: 0 }]}>Запрашивать код</Text>
              </View>
              {GRACE_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  style={({ pressed }) => [
                    styles.row,
                    { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
                    pressed && { backgroundColor: theme.colors.surfacePressed },
                  ]}
                  onPress={() => void applyLock({ ...lock, graceSec: option.value })}
                >
                  <View style={[styles.rowIcon, { backgroundColor: theme.colors.accentSoft }]}>
                    <Icon name="clock" size={19} color={theme.colors.accent} />
                  </View>
                  <Text style={[styles.rowLabel, { color: theme.colors.textPrimary }]}>{option.label}</Text>
                  {lock.graceSec === option.value && <Icon name="check" size={19} color={theme.colors.accent} />}
                </Pressable>
              ))}

              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
                  pressed && { backgroundColor: theme.colors.surfacePressed },
                ]}
                onPress={() => setPinMode("change")}
              >
                <View style={[styles.rowIcon, { backgroundColor: theme.colors.accentSoft }]}>
                  <Icon name="edit" size={19} color={theme.colors.accent} />
                </View>
                <Text style={[styles.rowLabel, { color: theme.colors.textPrimary }]}>Сменить код</Text>
              </Pressable>
            </>
          )}

          <View style={[styles.block, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider }]}>
            <Text style={[styles.hint, { color: theme.colors.textMuted, marginTop: 0 }]}>
              Код закрывает переписку от того, кто взял разблокированный телефон в руки. Сообщения при этом продолжают
              приходить, а уведомления — показываться: блокировка не выключает связь.
            </Text>
            <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
              Код не восстанавливается: он никуда не отправляется и не хранится в открытом виде. Забыть его —
              значит переустановить приложение и потерять ключи вместе со всей перепиской.
            </Text>
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

        <SectionTitle>Диагностика</SectionTitle>
        <Card>
          <View style={styles.block}>
            {/* Версия сборки: APK раздаётся файлом, и «обновился ли человек»
                иначе не выяснить. nativeBuildVersion — это versionCode, он
                растёт с каждой сборкой (autoIncrement в eas.json). */}
            <DiagRow label="Версия" value={buildLabel} theme={theme} />
            <DiagRow
              label="Блокировка"
              value={lock === null ? "выключена" : lock.biometrics ? "код + биометрия" : "код"}
              theme={theme}
            />
            <DiagRow label="Соединение" value={connectionState} theme={theme} />
            <DiagRow label="Участников известно" value={String(activeContacts.length)} theme={theme} />
            <DiagRow label="Сообщений в базе" value={diag ? String(diag.messages) : "…"} theme={theme} />
            <DiagRow
              label="Ждут отправки"
              value={diag ? String(diag.outbox) : "…"}
              theme={theme}
              // Непустая очередь при живом соединении — это уже ответ: сервер
              // сообщения не подтверждает.
              alarm={diag !== null && diag.outbox > 0}
            />
            <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
              «Ждут отправки» больше нуля при соединении «connected» означает, что сервер не подтверждает приём —
              скорее всего, на нём старая версия. Ноль участников означает, что не разобрался список участников, и тогда
              шифровать сообщения не для кого.
            </Text>
            {steps !== null && (
              <View style={styles.steps}>
                {steps.map((step) => (
                  <View key={step.name} style={styles.stepRow}>
                    <Icon
                      name={step.ok ? "check" : "alert"}
                      size={16}
                      color={step.ok ? theme.colors.success : theme.colors.danger}
                    />
                    <Text style={[styles.stepText, { color: theme.colors.textPrimary }]}>
                      {step.name}
                      {step.detail !== "" && (
                        <Text style={{ color: theme.colors.textMuted }}>{` — ${step.detail}`}</Text>
                      )}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.reconnectButton,
                { backgroundColor: theme.colors.accentSoft, opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => void runSelfTest()}
              disabled={testing}
            >
              {testing ? (
                <ActivityIndicator color={theme.colors.accent} />
              ) : (
                <>
                  <Icon name="refresh" size={18} color={theme.colors.accent} />
                  <Text style={[styles.reconnectText, { color: theme.colors.accent }]}>Проверить отправку</Text>
                </>
              )}
            </Pressable>
          </View>
        </Card>

        <SectionTitle>{`Участники · ${activeContacts.length}`}</SectionTitle>
        <Card>
          {listedContacts.length === 0 ? (
            <View style={styles.block}>
              <Text style={[styles.hint, { color: theme.colors.textMuted, marginTop: 0 }]}>
                Пока никого нет. Добавьте человека кнопкой «+» в списке чатов.
              </Text>
            </View>
          ) : (
            listedContacts.map((contact, index) => {
              const online = !contact.isRevoked && presence.get(contact.userId)?.online === true;
              const status = contact.isRevoked
                ? "доступ устройства отозван"
                : describePresence(presence.get(contact.userId));
              return (
                <Pressable
                  key={contact.userId}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
                    pressed && { backgroundColor: theme.colors.surfacePressed },
                  ]}
                  onPress={() => setMenuFor(contact)}
                >
                  <Avatar
                    name={contactTitle(contact)}
                    seed={contact.userId}
                    size={42}
                    online={online}
                    ringColor={theme.colors.surface}
                  />
                  <View style={styles.memberText}>
                    <Text
                      style={[
                        styles.memberName,
                        { color: contact.isRevoked ? theme.colors.textMuted : theme.colors.textPrimary },
                      ]}
                    >
                      {contactTitle(contact)}
                    </Text>
                    {/* Если название своё — показываем и настоящее имя, чтобы
                        человека можно было опознать. */}
                    <Text
                      style={[
                        styles.memberFingerprint,
                        { color: contact.isRevoked ? theme.colors.danger : theme.colors.textMuted },
                      ]}
                    >
                      {contact.localName !== null ? `${contact.displayName} · ` : ""}
                      {status !== "" ? status : contact.fingerprint}
                    </Text>
                  </View>
                  <Icon
                    name={contact.isRevoked ? "alert" : "edit"}
                    size={17}
                    color={contact.isRevoked ? theme.colors.danger : theme.colors.textMuted}
                  />
                </Pressable>
              );
            })
          )}
        </Card>

        {listedContacts.length > 0 && (
          <Text style={[styles.hint, { color: theme.colors.textMuted, marginLeft: 6 }]}>
            {isAdmin
              ? "Нажмите на участника, чтобы подписать его по-своему, отозвать доступ его устройству (потерянный телефон — отзыв обратим и переписку не трогает) или удалить его из мессенджера совсем."
              : "Нажмите на участника, чтобы подписать его по-своему — это название видно только на вашем устройстве."}
          </Text>
        )}

        <Text style={[styles.footer, { color: theme.colors.textMuted }]}>
          Cry · сообщения шифруются на устройстве, сервер видит только зашифрованные блобы и удаляет их после доставки.
        </Text>
      </ScrollView>

      <ActionSheet
        visible={menuFor !== null}
        title={menuFor ? contactTitle(menuFor) : undefined}
        actions={memberActions}
        onClose={() => setMenuFor(null)}
      />

      <PinSetupModal
        visible={pinMode !== null}
        mode={pinMode ?? "set"}
        verify={verifyCurrentPin}
        onCancel={() => setPinMode(null)}
        onDone={(result) => {
          const mode = pinMode;
          setPinMode(null);
          void (async () => {
            if (result === null) {
              await applyLock(null);
              return;
            }
            // Остальные настройки при смене кода сохраняем: человек менял код, а
            // не сбрасывал биометрию и задержку. При первой установке — значения
            // по умолчанию: биометрия выключена (её надо включить осознанно),
            // код через минуту.
            await applyLock({
              salt: result.salt,
              hash: result.hash,
              biometrics: mode === "change" ? (lock?.biometrics ?? false) : false,
              graceSec: mode === "change" ? (lock?.graceSec ?? 60) : 60,
            });
          })();
        }}
      />

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
  profileTag: { fontSize: 14, marginTop: 5 },
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
  steps: { marginTop: 12, gap: 7 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  stepText: { flex: 1, fontSize: 13, lineHeight: 18 },
  diagRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  diagLabel: { fontSize: 14 },
  diagValue: { fontSize: 14, fontWeight: "600" },
  memberText: { flex: 1 },
  memberName: { fontSize: 15.5, fontWeight: "600" },
  memberFingerprint: { fontSize: 11.5, marginTop: 3, letterSpacing: 0.4 },
  footer: { fontSize: 12, lineHeight: 18, marginTop: 26, textAlign: "center" },
});
