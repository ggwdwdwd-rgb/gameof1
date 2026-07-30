import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCrypto } from "../crypto/sodium";
import { saveIdentity, type DeviceIdentity } from "../storage/identity";
import { WsClient } from "../net/wsClient";
import { useTheme } from "../theme/ThemeContext";
import { uuidv4 } from "../util/uuid";

const DEFAULT_SERVER_URL = process.env.EXPO_PUBLIC_SERVER_WS_URL ?? "";

type Stage = "form" | "scanning" | "submitting";

export function OnboardingScreen({
  onComplete,
}: {
  onComplete: (identity: DeviceIdentity) => void;
}): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>("form");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  function handleBarcodeScanned(data: string): void {
    // familymsg://invite/<CODE> либо голый код, если его передали текстом
    const match = /invite\/([A-Z0-9]{8})/i.exec(data) ?? /^([A-Z0-9]{8})$/i.exec(data.trim());
    if (match) {
      setCode(match[1]!.toUpperCase());
      setStage("form");
    }
  }

  async function handleSubmit(): Promise<void> {
    setError(null);
    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = displayName.trim();
    const trimmedUrl = serverUrl.trim();

    if (trimmedCode.length !== 8) return setError("Код приглашения состоит из 8 символов");
    if (!trimmedName) return setError("Укажите, как вас будут видеть остальные");
    if (!trimmedUrl) return setError("Укажите адрес сервера");

    setStage("submitting");
    try {
      const crypto = await getCrypto();
      const identityKeyPair = crypto.generateIdentityKeyPair();
      const encryptionKeyPair = crypto.generateEncryptionKeyPair();
      const deviceId = uuidv4();

      const ws = new WsClient(trimmedUrl, {
        kind: "invite",
        code: trimmedCode,
        deviceId,
        displayName: trimmedName,
        identityPublicKey: identityKeyPair.publicKey,
        encryptionPublicKey: encryptionKeyPair.publicKey,
      });

      const result = await new Promise<{ ok: true; userId: string } | { ok: false; message: string }>((resolve) => {
        const timeout = setTimeout(() => resolve({ ok: false, message: "Сервер не ответил вовремя" }), 15_000);
        ws.events.on("inviteOk", (payload) => {
          clearTimeout(timeout);
          resolve({ ok: true, userId: payload.userId });
        });
        ws.events.on("inviteError", (payload) => {
          clearTimeout(timeout);
          const messages: Record<string, string> = {
            NOT_FOUND: "Код не найден — проверьте, правильно ли он введён",
            EXPIRED: "Срок действия кода истёк — попросите новый",
            USED: "Этот код уже использован",
          };
          resolve({ ok: false, message: messages[payload.code] ?? "Не удалось зарегистрироваться" });
        });
        ws.connect();
      });

      ws.disconnect();

      if (!result.ok) {
        setError(result.message);
        setStage("form");
        return;
      }

      const identity: DeviceIdentity = {
        userId: result.userId,
        deviceId,
        displayName: trimmedName,
        serverUrl: trimmedUrl,
        identityPublicKey: identityKeyPair.publicKey,
        identitySecretKey: identityKeyPair.secretKey,
        encryptionPublicKey: encryptionKeyPair.publicKey,
        encryptionSecretKey: encryptionKeyPair.secretKey,
      };
      await saveIdentity(identity);
      onComplete(identity);
    } catch {
      setError("Не удалось подключиться к серверу — проверьте адрес и интернет");
      setStage("form");
    }
  }

  if (stage === "scanning") {
    if (!permission?.granted) {
      return (
        <View style={[styles.container, styles.centered, { backgroundColor: theme.colors.background }]}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Нужен доступ к камере</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
            Чтобы отсканировать QR-код приглашения
          </Text>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: theme.colors.accent }]}
            onPress={() => void requestPermission()}
          >
            <Text style={[styles.primaryButtonText, { color: theme.colors.onAccent }]}>Разрешить</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => setStage("form")}>
            <Text style={[styles.linkText, { color: theme.colors.accent }]}>Ввести код вручную</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={[styles.container, { backgroundColor: "#000" }]}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={(result) => handleBarcodeScanned(result.data)}
        />
        <View style={styles.scanOverlay}>
          <View style={styles.scanFrame} />
          <Text style={styles.scanHint}>Наведите камеру на QR-код приглашения</Text>
        </View>
        <Pressable style={[styles.cancelButton, { backgroundColor: theme.colors.surface }]} onPress={() => setStage("form")}>
          <Text style={[styles.primaryButtonText, { color: theme.colors.textPrimary }]}>Отмена</Text>
        </Pressable>
      </View>
    );
  }

  const disabled = stage === "submitting";

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior="padding"
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.logo, { backgroundColor: theme.colors.accent }]}>
          <Text style={styles.logoText}>C</Text>
        </View>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Cry</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
          Приватные сообщения по приглашению. Вход только с кодом от того, кто уже в мессенджере.
        </Text>

        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Код приглашения</Text>
          <TextInput
            style={[styles.input, styles.codeInput, { color: theme.colors.textPrimary, borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}
            placeholder="XXXXXXXX"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            value={code}
            onChangeText={setCode}
            editable={!disabled}
          />

          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Ваше имя</Text>
          <TextInput
            style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}
            placeholder="Как вас подписать"
            placeholderTextColor={theme.colors.textMuted}
            value={displayName}
            onChangeText={setDisplayName}
            editable={!disabled}
          />

          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Адрес сервера</Text>
          <TextInput
            style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}
            placeholder="wss://example.com/ws"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={serverUrl}
            onChangeText={setServerUrl}
            editable={!disabled}
          />
        </View>

        {error && <Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text>}

        {disabled ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
        ) : (
          <>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.colors.accent, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={() => void handleSubmit()}
            >
              <Text style={[styles.primaryButtonText, { color: theme.colors.onAccent }]}>Войти</Text>
            </Pressable>
            <Pressable style={styles.linkButton} onPress={() => setStage("scanning")}>
              <Text style={[styles.linkText, { color: theme.colors.accent }]}>Отсканировать QR-код</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center", padding: 28 },
  scroll: { padding: 24 },
  logo: { width: 68, height: 68, borderRadius: 20, alignSelf: "center", alignItems: "center", justifyContent: "center" },
  logoText: { color: "#fff", fontSize: 34, fontWeight: "700" },
  title: { fontSize: 28, fontWeight: "700", textAlign: "center", marginTop: 14 },
  subtitle: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 8, marginBottom: 24 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  label: { fontSize: 13, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  codeInput: { fontSize: 22, fontWeight: "700", letterSpacing: 6, textAlign: "center" },
  error: { fontSize: 14, textAlign: "center", marginTop: 14 },
  loader: { marginTop: 24 },
  primaryButton: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 20 },
  primaryButtonText: { fontSize: 16, fontWeight: "600" },
  linkButton: { paddingVertical: 14, alignItems: "center" },
  linkText: { fontSize: 15, fontWeight: "500" },
  scanOverlay: { flex: 1, alignItems: "center", justifyContent: "center", gap: 20 },
  scanFrame: { width: 240, height: 240, borderRadius: 24, borderWidth: 3, borderColor: "#ffffffcc" },
  scanHint: { color: "#fff", fontSize: 15, textAlign: "center", paddingHorizontal: 40 },
  cancelButton: { position: "absolute", bottom: 32, left: 24, right: 24, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
});
