import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getCrypto } from "../crypto/sodium";
import { saveIdentity, type DeviceIdentity } from "../storage/identity";
import { WsClient } from "../net/wsClient";
import { uuidv4 } from "../util/uuid";

const DEFAULT_SERVER_URL = process.env.EXPO_PUBLIC_SERVER_WS_URL ?? "";

type Stage = "form" | "scanning" | "submitting";

export function OnboardingScreen({
  onComplete,
}: {
  onComplete: (identity: DeviceIdentity) => void;
}): React.ReactElement {
  const [stage, setStage] = useState<Stage>("form");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  function handleBarcodeScanned(data: string): void {
    // familymsg://invite/<CODE> либо просто голый код, если кто-то передал текстом
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

    if (trimmedCode.length !== 8) {
      setError("Код инвайта — 8 символов");
      return;
    }
    if (!trimmedName) {
      setError("Введите своё имя");
      return;
    }
    if (!trimmedUrl) {
      setError("Укажите адрес сервера");
      return;
    }

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
        <View style={styles.container}>
          <Text style={styles.title}>Нужен доступ к камере</Text>
          <Pressable style={styles.button} onPress={() => void requestPermission()}>
            <Text style={styles.buttonText}>Разрешить</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => setStage("form")}>
            <Text style={styles.linkText}>Ввести код вручную</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.container}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={(result) => handleBarcodeScanned(result.data)}
        />
        <Pressable style={[styles.button, styles.cancelButton]} onPress={() => setStage("form")}>
          <Text style={styles.buttonText}>Отмена</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Семейный мессенджер</Text>
      <Text style={styles.subtitle}>Вход только по инвайту от того, кто уже в семье</Text>

      <TextInput
        style={styles.input}
        placeholder="Код инвайта (8 символов)"
        autoCapitalize="characters"
        maxLength={8}
        value={code}
        onChangeText={setCode}
        editable={stage === "form"}
      />
      <TextInput
        style={styles.input}
        placeholder="Ваше имя"
        value={displayName}
        onChangeText={setDisplayName}
        editable={stage === "form"}
      />
      <TextInput
        style={styles.input}
        placeholder="Адрес сервера (wss://...)"
        autoCapitalize="none"
        autoCorrect={false}
        value={serverUrl}
        onChangeText={setServerUrl}
        editable={stage === "form"}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      {stage === "submitting" ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <>
          <Pressable style={styles.button} onPress={() => void handleSubmit()}>
            <Text style={styles.buttonText}>Продолжить</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => setStage("scanning")}>
            <Text style={styles.linkText}>Сканировать QR вместо ввода</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4, textAlign: "center" },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 24, textAlign: "center" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  error: { color: "#c0392b", marginBottom: 12, textAlign: "center" },
  button: { backgroundColor: "#2f6f4f", borderRadius: 8, padding: 14, alignItems: "center" },
  cancelButton: { position: "absolute", bottom: 40, left: 24, right: 24 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  linkButton: { marginTop: 16, alignItems: "center" },
  linkText: { color: "#2f6f4f", fontSize: 14 },
  spinner: { marginTop: 8 },
});
