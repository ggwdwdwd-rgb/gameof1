import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCrypto } from "../crypto/sodium";
import { saveIdentity, type DeviceIdentity } from "../storage/identity";
import { WsClient } from "../net/wsClient";
import { useTheme } from "../theme/ThemeContext";
import { Icon } from "../ui/Icon";
import { LogoMark } from "../ui/LogoMark";
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
          <View style={[styles.permissionIcon, { backgroundColor: theme.colors.accentSoft }]}>
            <Icon name="camera" size={34} color={theme.colors.accent} />
          </View>
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
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
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
        <View style={styles.logoWrap}>
          <LogoMark size={78} />
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

        {error && (
          <View style={[styles.errorBox, { backgroundColor: theme.colors.accentSoft }]}>
            <Icon name="alert" size={18} color={theme.colors.danger} />
            <Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text>
          </View>
        )}

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
              <Icon name="qr" size={19} color={theme.colors.accent} />
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
  permissionIcon: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  logoWrap: { alignSelf: "center" },
  title: { fontSize: 30, fontWeight: "700", textAlign: "center", marginTop: 18, letterSpacing: -0.6 },
  subtitle: { fontSize: 14.5, textAlign: "center", lineHeight: 21, marginTop: 10, marginBottom: 26 },
  card: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
  label: { fontSize: 12.5, fontWeight: "600", marginBottom: 7, marginTop: 14 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
  },
  codeInput: { fontSize: 23, fontWeight: "700", letterSpacing: 7, textAlign: "center" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 13,
    padding: 13,
    marginTop: 16,
  },
  error: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  loader: { marginTop: 26 },
  primaryButton: { borderRadius: 15, paddingVertical: 16, alignItems: "center", marginTop: 22 },
  primaryButtonText: { fontSize: 16, fontWeight: "600" },
  linkButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16 },
  linkText: { fontSize: 15, fontWeight: "500" },
  scanOverlay: { flex: 1, alignItems: "center", justifyContent: "center", gap: 26 },
  // Рамка уголками: не перекрывает сам код и выглядит аккуратнее сплошной.
  scanFrame: { width: 246, height: 246 },
  corner: { position: "absolute", width: 40, height: 40, borderColor: "#fff" },
  cornerTopLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 20 },
  cornerTopRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 20 },
  cornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 20 },
  cornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 20 },
  scanHint: { color: "#fff", fontSize: 15, textAlign: "center", paddingHorizontal: 40, lineHeight: 21 },
  cancelButton: {
    position: "absolute",
    bottom: 36,
    left: 24,
    right: 24,
    borderRadius: 15,
    paddingVertical: 16,
    alignItems: "center",
  },
});
