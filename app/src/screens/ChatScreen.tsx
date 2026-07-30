import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  FlatList,
} from "react-native";
import { isGroupChat } from "../chat/chatId";
import { buildEnvelopeFromLocalFile, formatFileSize, parseLocalMediaMeta, persistLocalFile } from "../chat/media";
import { getCurrentLocationOnce, pickAndCompressImage, pickFile } from "../chat/pickers";
import { useApp } from "../context/AppContext";
import { listMessagesForChat, type LocalMessage } from "../db/messages";
import { uuidv4 } from "../util/uuid";

const STATUS_LABELS: Record<string, string> = {
  pending: "…",
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
  failed: "!",
};

function VoiceBubble({ localUri, durationMs }: { localUri: string; durationMs?: number }): React.ReactElement {
  const player = useAudioPlayer(localUri);
  const status = useAudioPlayerStatus(player);
  const totalSec = Math.round((status.duration || (durationMs ?? 0) / 1000) || 0);
  const currentSec = Math.round(status.currentTime || 0);

  return (
    <Pressable
      style={voiceStyles.row}
      onPress={() => (status.playing ? player.pause() : player.play())}
    >
      <Text style={voiceStyles.icon}>{status.playing ? "⏸" : "▶︎"}</Text>
      <Text style={voiceStyles.time}>
        {currentSec > 0 ? `${currentSec}s / ` : ""}
        {totalSec}s
      </Text>
    </Pressable>
  );
}

const voiceStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  icon: { fontSize: 18 },
  time: { fontSize: 14, color: "#444" },
});

function MessageContent({ item }: { item: LocalMessage }): React.ReactElement {
  if (item.deletedAt) {
    return <Text style={styles.deletedText}>Сообщение удалено</Text>;
  }

  if (item.contentType === "image") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={styles.bubbleText}>[не удалось загрузить фото]</Text>;
    return <Image source={{ uri: meta.localUri }} style={styles.image} resizeMode="cover" />;
  }

  if (item.contentType === "voice") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={styles.bubbleText}>[не удалось загрузить голосовое]</Text>;
    return <VoiceBubble localUri={meta.localUri} durationMs={meta.durationMs} />;
  }

  if (item.contentType === "file") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={styles.bubbleText}>[не удалось загрузить файл]</Text>;
    return (
      <View style={styles.fileRow}>
        <Text style={styles.fileIcon}>📎</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.fileName} numberOfLines={1}>
            {meta.fileName ?? "файл"}
          </Text>
          <Text style={styles.fileSize}>{formatFileSize(meta.sizeBytes)}</Text>
        </View>
      </View>
    );
  }

  if (item.contentType === "location") {
    try {
      const { lat, lng } = JSON.parse(item.plaintext ?? "{}") as { lat: number; lng: number };
      return (
        <Pressable onPress={() => void Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`)}>
          <Text style={styles.bubbleText}>📍 Геолокация</Text>
          <Text style={styles.locationCoords}>
            {lat.toFixed(5)}, {lng.toFixed(5)} — открыть на карте
          </Text>
        </Pressable>
      );
    } catch {
      return <Text style={styles.bubbleText}>[геолокация]</Text>;
    }
  }

  return <Text style={styles.bubbleText}>{item.plaintext ?? "[не удалось расшифровать]"}</Text>;
}

export function ChatScreen({
  chatId,
  title,
  onBack,
}: {
  chatId: string;
  title: string;
  onBack: () => void;
}): React.ReactElement {
  const { identity, contacts, chatEvents, sendText, sendMedia, sendLocation, deleteMessage, markRead, setTyping } = useApp();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<LocalMessage | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const listRef = useRef<FlatList<LocalMessage>>(null);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesByIdRef = useRef<Map<string, LocalMessage>>(new Map());

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  useEffect(() => {
    let mounted = true;

    async function refresh(): Promise<void> {
      const rows = await listMessagesForChat(chatId);
      if (!mounted) return;
      setMessages(rows);
      messagesByIdRef.current = new Map(rows.map((r) => [r.id, r]));
      for (const row of rows) {
        if (row.fromUserId !== identity.userId && row.status === "delivered") {
          markRead(row.id, chatId);
        }
      }
    }

    void refresh();
    const unsubscribe = chatEvents.on("messageInserted", (insertedChatId) => {
      if (insertedChatId === chatId) void refresh();
    });
    const unsubscribeStatus = chatEvents.on("messageStatusChanged", () => void refresh());
    const unsubscribeTyping = chatEvents.on("typingChanged", (typingChatId, _fromUserId, isTyping) => {
      if (typingChatId === chatId) setPeerTyping(isTyping);
    });
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeStatus();
      unsubscribeTyping();
    };
  }, [chatId, chatEvents, identity.userId, markRead]);

  function displayNameFor(userId: string): string {
    if (userId === identity.userId) return "Вы";
    return contacts.find((c) => c.userId === userId)?.displayName ?? "…";
  }

  function handleDraftChange(value: string): void {
    setDraft(value);
    setTyping(chatId, true);
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(() => setTyping(chatId, false), 3000);
  }

  async function handleSend(): Promise<void> {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const replyTo = replyingTo?.id ?? null;
    setReplyingTo(null);
    setTyping(chatId, false);
    await sendText(chatId, text, replyTo);
  }

  function handleLongPress(item: LocalMessage): void {
    if (item.deletedAt) return;
    const buttons: { text: string; onPress?: () => void; style?: "destructive" | "cancel" }[] = [
      { text: "Ответить", onPress: () => setReplyingTo(item) },
    ];
    if (item.fromUserId === identity.userId) {
      buttons.push({ text: "Удалить у всех", style: "destructive", onPress: () => void deleteMessage(item.id, chatId) });
    }
    buttons.push({ text: "Отмена", style: "cancel" });
    Alert.alert("Сообщение", undefined, buttons);
  }

  async function handlePickImage(): Promise<void> {
    const prepared = await pickAndCompressImage();
    if (!prepared) return;
    const replyTo = replyingTo?.id ?? null;
    setReplyingTo(null);
    await sendMedia(chatId, "image", prepared.envelopeJson, prepared.localMeta, replyTo);
  }

  async function handlePickFile(): Promise<void> {
    const prepared = await pickFile();
    if (!prepared) return;
    if ("error" in prepared) {
      Alert.alert("Файл слишком большой", "Максимальный размер файла — 25 МБ.");
      return;
    }
    const replyTo = replyingTo?.id ?? null;
    setReplyingTo(null);
    await sendMedia(chatId, "file", prepared.envelopeJson, prepared.localMeta, replyTo);
  }

  async function handleShareLocation(): Promise<void> {
    const location = await getCurrentLocationOnce();
    if (!location) {
      Alert.alert("Нет доступа к геолокации", "Разрешите доступ в настройках устройства.");
      return;
    }
    const replyTo = replyingTo?.id ?? null;
    setReplyingTo(null);
    await sendLocation(chatId, location.lat, location.lng, replyTo);
  }

  async function handleStartRecording(): Promise<void> {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Нет доступа к микрофону", "Разрешите доступ в настройках устройства.");
      return;
    }
    await setAudioModeAsync({ allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function handleStopRecording(): Promise<void> {
    const durationMs = recorderState.durationMillis;
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;
    const localUri = persistLocalFile(uri, `${uuidv4()}.m4a`);
    const envelopeJson = buildEnvelopeFromLocalFile(localUri, { mimeType: "audio/m4a", durationMs });
    const replyTo = replyingTo?.id ?? null;
    setReplyingTo(null);
    await sendMedia(chatId, "voice", envelopeJson, { localUri, mimeType: "audio/m4a", durationMs }, replyTo);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>{title}</Text>
          {peerTyping && <Text style={styles.typingLabel}>печатает…</Text>}
        </View>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const mine = item.fromUserId === identity.userId;
          const repliedMessage = item.replyTo ? messagesByIdRef.current.get(item.replyTo) : undefined;
          return (
            <Pressable
              style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
              onLongPress={() => handleLongPress(item)}
            >
              {!mine && isGroupChat(chatId) && <Text style={styles.sender}>{displayNameFor(item.fromUserId)}</Text>}
              {repliedMessage && (
                <View style={styles.replyQuote}>
                  <Text style={styles.replyQuoteAuthor}>{displayNameFor(repliedMessage.fromUserId)}</Text>
                  <Text style={styles.replyQuoteText} numberOfLines={1}>
                    {repliedMessage.contentType === "text" ? (repliedMessage.plaintext ?? "") : "[вложение]"}
                  </Text>
                </View>
              )}
              <MessageContent item={item} />
              {mine && !item.deletedAt && <Text style={styles.status}>{STATUS_LABELS[item.status] ?? ""}</Text>}
            </Pressable>
          );
        }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {replyingTo && (
        <View style={styles.replyBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarAuthor}>Ответ для {displayNameFor(replyingTo.fromUserId)}</Text>
            <Text style={styles.replyBarText} numberOfLines={1}>
              {replyingTo.contentType === "text" ? (replyingTo.plaintext ?? "") : "[вложение]"}
            </Text>
          </View>
          <Pressable onPress={() => setReplyingTo(null)} hitSlop={8}>
            <Text style={styles.replyBarClose}>✕</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.attachRow}>
        <Pressable style={styles.attachButton} onPress={() => void handlePickImage()}>
          <Text style={styles.attachIcon}>📷</Text>
        </Pressable>
        <Pressable style={styles.attachButton} onPress={() => void handlePickFile()}>
          <Text style={styles.attachIcon}>📎</Text>
        </Pressable>
        <Pressable style={styles.attachButton} onPress={() => void handleShareLocation()}>
          <Text style={styles.attachIcon}>📍</Text>
        </Pressable>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={handleDraftChange}
          placeholder="Сообщение…"
          multiline
        />
        {draft.trim() ? (
          <Pressable style={styles.sendButton} onPress={() => void handleSend()}>
            <Text style={styles.sendButtonText}>→</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.sendButton, recorderState.isRecording && styles.sendButtonRecording]}
            onPressIn={() => void handleStartRecording()}
            onPressOut={() => void handleStopRecording()}
          >
            <Text style={styles.sendButtonText}>🎤</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f4f4f4" },
  header: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  back: { fontSize: 28, width: 24, color: "#2f6f4f" },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  typingLabel: { fontSize: 12, color: "#2f6f4f" },
  list: { padding: 12, gap: 6 },
  bubble: { maxWidth: "80%", borderRadius: 12, padding: 10, marginVertical: 3 },
  bubbleMine: { backgroundColor: "#dcf3e4", alignSelf: "flex-end" },
  bubbleTheirs: { backgroundColor: "#fff", alignSelf: "flex-start" },
  sender: { fontSize: 12, fontWeight: "700", color: "#2f6f4f", marginBottom: 2 },
  bubbleText: { fontSize: 16 },
  deletedText: { fontSize: 15, color: "#999", fontStyle: "italic" },
  status: { fontSize: 11, color: "#888", textAlign: "right", marginTop: 2 },
  image: { width: 220, height: 220, borderRadius: 8 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: 220 },
  fileIcon: { fontSize: 24 },
  fileName: { fontSize: 15, fontWeight: "600" },
  fileSize: { fontSize: 12, color: "#777" },
  locationCoords: { fontSize: 12, color: "#2f6f4f", marginTop: 2 },
  replyQuote: {
    borderLeftWidth: 3,
    borderLeftColor: "#2f6f4f",
    paddingLeft: 8,
    marginBottom: 6,
  },
  replyQuoteAuthor: { fontSize: 12, fontWeight: "700", color: "#2f6f4f" },
  replyQuoteText: { fontSize: 13, color: "#555" },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eef6f0",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#dde",
  },
  replyBarAuthor: { fontSize: 12, fontWeight: "700", color: "#2f6f4f" },
  replyBarText: { fontSize: 13, color: "#555" },
  replyBarClose: { fontSize: 16, color: "#888", paddingHorizontal: 8 },
  attachRow: {
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 14,
    paddingTop: 8,
    backgroundColor: "#fff",
  },
  attachButton: { padding: 4 },
  attachIcon: { fontSize: 22 },
  inputRow: {
    flexDirection: "row",
    padding: 10,
    gap: 8,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#eee",
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
    fontSize: 16,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#2f6f4f",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonRecording: { backgroundColor: "#c0392b" },
  sendButtonText: { color: "#fff", fontSize: 20, fontWeight: "700" },
});
