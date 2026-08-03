import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCrypto } from "../crypto/sodium";
import { WsClient } from "../net/wsClient";
import { saveIdentity, type DeviceIdentity } from "../storage/identity";
import { useTheme } from "../theme/ThemeContext";
import { LogoMark } from "../ui/LogoMark";
import { DURATION, useTransition } from "../ui/motion";
import { uuidv4 } from "../util/uuid";

const DEFAULT_SERVER_URL = process.env.EXPO_PUBLIC_SERVER_WS_URL ?? "";

/** Сколько ждём ответа сервера: Argon2id на входе считается около секунды. */
const AUTH_TIMEOUT_MS = 25_000;

type Mode = "login" | "register";

/**
 * Вход и регистрация по почте.
 *
 * Заменяет прежний онбординг по одноразовому коду. Ключи по-прежнему создаёт
 * устройство, а не сервер: пароль нужен только чтобы привязать это устройство к
 * аккаунту, и доступа к переписке не даёт — расшифровать её можно лишь ключами,
 * которые никогда не покидают телефон.
 *
 * Клиент здесь короткоживущий: получив ответ, экран сохраняет identity и
 * отключается, а дальше приложение подключается уже подписью устройства. Поэтому
 * пароль не хранится и не уходит на сервер при каждом переподключении.
 */
export function AuthScreen({ onComplete }: { onComplete: (identity: DeviceIdentity) => void }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registering = mode === "register";
  // Поля регистрации не появляются рывком: переключение режима — это смена
  // смысла экрана, и её стоит показать движением.
  const extra = useTransition(registering, DURATION.normal);

  const submit = useCallback(async (): Promise<void> => {
    setError(null);

    const trimmedEmail = email.trim();
    const trimmedUrl = serverUrl.trim();
    const trimmedName = displayName.trim();
    const trimmedTag = username.trim().replace(/^@+/, "");

    if (!trimmedUrl) return setError("Укажите адрес сервера");
    if (!trimmedEmail.includes("@")) return setError("Введите адрес почты");
    if (password.length < 8) return setError("Пароль — минимум 8 символов");
    if (registering && trimmedName.length === 0) return setError("Укажите, как вас будут видеть");
    if (registering && trimmedTag.length < 3) return setError("Тег — минимум 3 символа");

    setBusy(true);
    let ws: WsClient | null = null;
    try {
      const crypto = await getCrypto();
      const identityKeyPair = crypto.generateIdentityKeyPair();
      const encryptionKeyPair = crypto.generateEncryptionKeyPair();
      const deviceId = uuidv4();

      ws = new WsClient(
        trimmedUrl,
        registering
          ? {
              kind: "register",
              email: trimmedEmail,
              password,
              username: trimmedTag,
              displayName: trimmedName,
              deviceId,
              identityPublicKey: identityKeyPair.publicKey,
              encryptionPublicKey: encryptionKeyPair.publicKey,
            }
          : {
              kind: "login",
              email: trimmedEmail,
              password,
              deviceId,
              identityPublicKey: identityKeyPair.publicKey,
              encryptionPublicKey: encryptionKeyPair.publicKey,
            },
      );

      const client = ws;
      const result = await new Promise<
        { ok: true; userId: string; username: string | null; displayName: string } | { ok: false; message: string }
      >((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, message: "Сервер не ответил вовремя" }), AUTH_TIMEOUT_MS);
        const finish = (value: Parameters<typeof resolve>[0]): void => {
          clearTimeout(timer);
          resolve(value);
        };
        client.events.on("accountOk", (payload) =>
          finish({
            ok: true,
            userId: payload.userId,
            username: payload.username,
            displayName: payload.displayName,
          }),
        );
        // Текст отказа приходит от сервера готовым: он один и тот же в логах, в
        // тестах и на экране, и переводить его здесь заново незачем.
        client.events.on("accountError", (payload) => finish({ ok: false, message: payload.message }));
        client.events.on("failure", (failure) => {
          if (failure.kind === "network") {
            finish({ ok: false, message: "Сервер недоступен — проверьте адрес и интернет" });
          }
        });
        client.connect();
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const identity: DeviceIdentity = {
        userId: result.userId,
        deviceId,
        displayName: result.displayName,
        username: result.username,
        email: trimmedEmail,
        serverUrl: trimmedUrl,
        identityPublicKey: identityKeyPair.publicKey,
        identitySecretKey: identityKeyPair.secretKey,
        encryptionPublicKey: encryptionKeyPair.publicKey,
        encryptionSecretKey: encryptionKeyPair.secretKey,
      };
      await saveIdentity(identity);
      onComplete(identity);
    } catch (caught) {
      // Молчаливый отказ здесь — это экран входа, который «ничего не делает».
      setError(caught instanceof Error ? caught.message : "Не удалось подключиться к серверу");
    } finally {
      ws?.disconnect();
      setBusy(false);
    }
  }, [displayName, email, onComplete, password, registering, serverUrl, username]);

  const field = (
    label: string,
    value: string,
    onChangeText: (next: string) => void,
    options: {
      placeholder?: string;
      secure?: boolean;
      keyboard?: "email-address" | "url" | "default";
      autoCapitalize?: "none" | "sentences";
      hint?: string;
    } = {},
  ): React.ReactElement => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>{label.toUpperCase()}</Text>
      <TextInput
        style={[
          styles.input,
          {
            color: theme.colors.textPrimary,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        editable={!busy}
        placeholder={options.placeholder}
        placeholderTextColor={theme.colors.textMuted}
        secureTextEntry={options.secure ?? false}
        keyboardType={options.keyboard ?? "default"}
        autoCapitalize={options.autoCapitalize ?? "none"}
        autoCorrect={false}
      />
      {options.hint !== undefined && (
        <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{options.hint}</Text>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.head}>
          <LogoMark size={64} />
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Cry</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
            {registering ? "Создайте аккаунт на своём сервере" : "Войдите в аккаунт"}
          </Text>
        </View>

        {/* Переключатель как сегменты, а не две кнопки: видно, что это один и тот
            же экран в двух состояниях, а не разные пути. */}
        <View style={[styles.tabs, { backgroundColor: theme.colors.accentSoft }]}>
          {(["register", "login"] as const).map((tab) => {
            const active = mode === tab;
            return (
              <Pressable
                key={tab}
                style={[styles.tab, active && { backgroundColor: theme.colors.accent }]}
                onPress={() => {
                  setMode(tab);
                  setError(null);
                }}
                disabled={busy}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: active ? theme.colors.onAccent : theme.colors.textSecondary },
                  ]}
                >
                  {tab === "register" ? "Регистрация" : "Вход"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {field("Почта", email, setEmail, { placeholder: "you@example.com", keyboard: "email-address" })}
        {field("Пароль", password, setPassword, { placeholder: "минимум 8 символов", secure: true })}

        {registering && (
          <View style={{ opacity: extra }}>
            {field("Тег", username, setUsername, {
              placeholder: "anna_k",
              hint: "По нему вас найдут: латиница, цифры и подчёркивание",
            })}
            {field("Имя", displayName, setDisplayName, {
              placeholder: "Анна",
              autoCapitalize: "sentences",
              hint: "Так вас увидят те, кто вас добавит",
            })}
          </View>
        )}

        {field("Сервер", serverUrl, setServerUrl, { placeholder: "wss://example.com/ws", keyboard: "url" })}

        {error !== null && <Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text>}

        <Pressable
          style={({ pressed }) => [
            styles.submit,
            { backgroundColor: theme.colors.accent, opacity: pressed || busy ? 0.85 : 1 },
          ]}
          onPress={() => void submit()}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.onAccent} />
          ) : (
            <Text style={[styles.submitText, { color: theme.colors.onAccent }]}>
              {registering ? "Создать аккаунт" : "Войти"}
            </Text>
          )}
        </Pressable>

        <Text style={[styles.footer, { color: theme.colors.textMuted }]}>
          Пароль открывает только привязку нового устройства к аккаунту. Переписка шифруется ключами, которые никогда
          не покидают телефон, — сервер не может её прочитать ни с паролем, ни без него.
          {registering ? "" : " После входа с нового телефона чаты будут пустыми: прежние сообщения расшифровываются ключами прежнего устройства."}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 22 },
  head: { alignItems: "center", marginBottom: 26 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6, marginTop: 14 },
  subtitle: { fontSize: 14.5, marginTop: 6, textAlign: "center" },
  tabs: { flexDirection: "row", borderRadius: 13, padding: 3, marginBottom: 22 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10 },
  tabText: { fontSize: 15, fontWeight: "600" },
  field: { marginBottom: 15 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7, marginBottom: 7, marginLeft: 3 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
  },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 6, marginLeft: 3 },
  error: { fontSize: 13.5, lineHeight: 19, marginBottom: 14, marginTop: 2 },
  submit: { borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  submitText: { fontSize: 16, fontWeight: "600" },
  footer: { fontSize: 12, lineHeight: 18, marginTop: 22, textAlign: "center" },
});
