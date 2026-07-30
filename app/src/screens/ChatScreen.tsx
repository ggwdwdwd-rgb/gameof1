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
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { buildEnvelopeFromLocalFile, formatFileSize, parseLocalMediaMeta, persistLocalFile } from "../chat/media";
import { getCurrentLocationOnce, pickAndCompressImage, pickFile } from "../chat/pickers";
import { useApp, type SendResult } from "../context/AppContext";
import { listMessagesForChat, type LocalMessage } from "../db/messages";
import { useTheme } from "../theme/ThemeContext";
import type { Theme } from "../theme/theme";
import { Avatar } from "../ui/Avatar";
import { Header } from "../ui/Header";
import { uuidv4 } from "../util/uuid";

const STATUS_LABELS: Record<string, string> = {
  pending: "○",
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
  failed: "!",
};

function formatTime(ts: number): string {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function VoiceBubble({
  localUri,
  durationMs,
  tint,
}: {
  localUri: string;
  durationMs?: number | undefined;
  tint: string;
}): React.ReactElement {
  const player = useAudioPlayer(localUri);
  const status = useAudioPlayerStatus(player);
  const totalSec = Math.round(status.duration || (durationMs ?? 0) / 1000 || 0);
  const currentSec = Math.round(status.currentTime || 0);

  return (
    <Pressable style={styles.voiceRow} onPress={() => (status.playing ? player.pause() : player.play())}>
      <Text style={[styles.voiceIcon, { color: tint }]}>{status.playing ? "❚❚" : "▶"}</Text>
      <Text style={[styles.voiceTime, { color: tint }]}>
        {currentSec > 0 ? `${currentSec} / ` : ""}
        {totalSec} с
      </Text>
    </Pressable>
  );
}

function MessageContent({
  item,
  textColor,
  theme,
}: {
  item: LocalMessage;
  textColor: string;
  theme: Theme;
}): React.ReactElement {
  if (item.deletedAt) {
    return <Text style={[styles.deletedText, { color: theme.colors.textMuted }]}>Сообщение удалено</Text>;
  }

  if (item.contentType === "image") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={[styles.bubbleText, { color: textColor }]}>Фото недоступно</Text>;
    return <Image source={{ uri: meta.localUri }} style={styles.image} resizeMode="cover" />;
  }

  if (item.contentType === "voice") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={[styles.bubbleText, { color: textColor }]}>Голосовое недоступно</Text>;
    return <VoiceBubble localUri={meta.localUri} durationMs={meta.durationMs} tint={textColor} />;
  }

  if (item.contentType === "file") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={[styles.bubbleText, { color: textColor }]}>Файл недоступен</Text>;
    return (
      <View style={styles.fileRow}>
        <Text style={[styles.fileIcon, { color: textColor }]}>📄</Text>
        <View style={styles.fileInfo}>
          <Text style={[styles.fileName, { color: textColor }]} numberOfLines={1}>
            {meta.fileName ?? "файл"}
          </Text>
          <Text style={[styles.fileSize, { color: textColor, opacity: 0.7 }]}>{formatFileSize(meta.sizeBytes)}</Text>
        </View>
      </View>
    );
  }

  if (item.contentType === "location") {
    try {
      const { lat, lng } = JSON.parse(item.plaintext ?? "{}") as { lat: number; lng: number };
      if (typeof lat !== "number" || typeof lng !== "number") throw new Error("bad payload");
      return (
        <Pressable onPress={() => void Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`)}>
          <Text style={[styles.bubbleText, { color: textColor }]}>📍 Я тут</Text>
          <Text style={[styles.locationCoords, { color: textColor, opacity: 0.75 }]}>
            {lat.toFixed(5)}, {lng.toFixed(5)} — открыть карту
          </Text>
        </Pressable>
      );
    } catch {
      return <Text style={[styles.bubbleText, { color: textColor }]}>Геолокация недоступна</Text>;
    }
  }

  return (
    <Text style={[styles.bubbleText, { color: textColor }]}>
      {item.plaintext ?? "Не удалось расшифровать сообщение"}
    </Text>
  );
}

export function ChatScreen({
  chatId,
  title,
  peerUserId,
  onBack,
}: {
  chatId: string;
  title: string;
  peerUserId: string;
  onBack: () => void;
}): React.ReactElement {
  const { identity, contacts, chatEvents, sendText, sendMedia, sendLocation, deleteMessage, markRead, setTyping } =
    useApp();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<LocalMessage | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const listRef = useRef<FlatList<LocalMessage>>(null);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesByIdRef = useRef<Map<string, LocalMessage>>(new Map());

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const contact = contacts.find((c) => c.userId === peerUserId);

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
    const offInserted = chatEvents.on("messageInserted", (insertedChatId) => {
      if (insertedChatId === chatId) void refresh();
    });
    const offStatus = chatEvents.on("messageStatusChanged", () => void refresh());
    const offTyping = chatEvents.on("typingChanged", (typingChatId, _fromUserId, isTyping) => {
      if (typingChatId === chatId) setPeerTyping(isTyping);
    });

    return () => {
      mounted = false;
      offInserted();
      offStatus();
      offTyping();
    };
  }, [chatId, chatEvents, identity.userId, markRead]);

  // Уходя с экрана, обязательно снимаем свой индикатор "печатает".
  useEffect(
    () => () => {
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
      setTyping(chatId, false);
    },
    [chatId, setTyping],
  );

  function displayNameFor(userId: string): string {
    if (userId === identity.userId) return "Вы";
    return contacts.find((c) => c.userId === userId)?.displayName ?? "…";
  }

  const SEND_ERRORS: Record<"NO_CONTACT" | "NOT_READY" | "CRYPTO_FAILED", string> = {
    NO_CONTACT: "Данные собеседника ещё не получены с сервера. Дождитесь подключения и попробуйте снова.",
    NOT_READY: "Приложение ещё инициализируется. Попробуйте через секунду.",
    CRYPTO_FAILED: "Не удалось зашифровать сообщение. Переустановите приложение — возможно, повреждены ключи.",
  };

  function reportIfFailed(result: SendResult): void {
    if (result.ok) return;
    Alert.alert("Сообщение не отправлено", SEND_ERRORS[result.reason]);
  }

  function handleDraftChange(value: string): void {
    setDraft(value);
    setTyping(chatId, true);
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(() => setTyping(chatId, false), 3000);
  }

  function takeReplyTo(): string | null {
    const replyTo = replyingTo?.id ?? null;
    setReplyingTo(null);
    return replyTo;
  }

  async function handleSend(): Promise<void> {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setTyping(chatId, false);
    reportIfFailed(await sendText(chatId, text, takeReplyTo()));
  }

  function handleLongPress(item: LocalMessage): void {
    if (item.deletedAt) return;
    const buttons: { text: string; onPress?: () => void; style?: "destructive" | "cancel" }[] = [
      { text: "Ответить", onPress: () => setReplyingTo(item) },
    ];
    if (item.fromUserId === identity.userId) {
      buttons.push({
        text: "Удалить у всех",
        style: "destructive",
        onPress: () => void deleteMessage(item.id, chatId),
      });
    }
    buttons.push({ text: "Отмена", style: "cancel" });
    Alert.alert("Сообщение", undefined, buttons);
  }

  async function handlePickImage(): Promise<void> {
    setAttachOpen(false);
    const prepared = await pickAndCompressImage();
    if (!prepared) return;
    reportIfFailed(await sendMedia(chatId, "image", prepared.envelopeJson, prepared.localMeta, takeReplyTo()));
  }

  async function handlePickFile(): Promise<void> {
    setAttachOpen(false);
    const prepared = await pickFile();
    if (!prepared) return;
    if ("error" in prepared) {
      Alert.alert("Файл слишком большой", "Максимальный размер файла — 25 МБ.");
      return;
    }
    reportIfFailed(await sendMedia(chatId, "file", prepared.envelopeJson, prepared.localMeta, takeReplyTo()));
  }

  async function handleShareLocation(): Promise<void> {
    setAttachOpen(false);
    const location = await getCurrentLocationOnce();
    if (!location) {
      Alert.alert("Нет доступа к геолокации", "Разрешите доступ в настройках устройства.");
      return;
    }
    reportIfFailed(await sendLocation(chatId, location.lat, location.lng, takeReplyTo()));
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
    if (!recorderState.isRecording) return;
    const durationMs = recorderState.durationMillis;
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;
    const localUri = persistLocalFile(uri, `${uuidv4()}.m4a`);
    const envelopeJson = buildEnvelopeFromLocalFile(localUri, { mimeType: "audio/m4a", durationMs });
    reportIfFailed(
      await sendMedia(chatId, "voice", envelopeJson, { localUri, mimeType: "audio/m4a", durationMs }, takeReplyTo()),
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      // behavior нужен и на Android: приложение рисуется edge-to-edge, окно
      // само не сжимается, поэтому без этого клавиатура закрывала ввод.
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <Header
        title={title}
        subtitle={peerTyping ? "печатает…" : undefined}
        onBack={onBack}
        right={<Avatar name={title} seed={peerUserId} size={34} />}
      />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={messages.length === 0 ? styles.emptyContainer : styles.list}
        renderItem={({ item }) => {
          const mine = item.fromUserId === identity.userId;
          const textColor = mine ? theme.colors.bubbleMineText : theme.colors.bubbleTheirsText;
          const repliedMessage = item.replyTo ? messagesByIdRef.current.get(item.replyTo) : undefined;
          return (
            <Pressable
              style={[
                styles.bubble,
                mine ? styles.bubbleMine : styles.bubbleTheirs,
                {
                  backgroundColor: mine ? theme.colors.bubbleMine : theme.colors.bubbleTheirs,
                  borderColor: theme.colors.border,
                },
              ]}
              onLongPress={() => handleLongPress(item)}
            >
              {repliedMessage && (
                <View style={[styles.replyQuote, { borderLeftColor: textColor }]}>
                  <Text style={[styles.replyQuoteAuthor, { color: textColor }]}>
                    {displayNameFor(repliedMessage.fromUserId)}
                  </Text>
                  <Text style={[styles.replyQuoteText, { color: textColor, opacity: 0.8 }]} numberOfLines={1}>
                    {repliedMessage.contentType === "text" ? (repliedMessage.plaintext ?? "") : "Вложение"}
                  </Text>
                </View>
              )}
              <MessageContent item={item} textColor={textColor} theme={theme} />
              <View style={styles.metaRow}>
                <Text style={[styles.time, { color: textColor, opacity: 0.65 }]}>{formatTime(item.createdAt)}</Text>
                {mine && !item.deletedAt && (
                  <Text
                    style={[
                      styles.status,
                      { color: item.status === "read" ? theme.colors.success : textColor, opacity: 0.8 },
                    ]}
                  >
                    {STATUS_LABELS[item.status] ?? ""}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Avatar name={title} seed={peerUserId} size={72} />
            <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>{title}</Text>
            {contact && (
              <Text style={[styles.emptyFingerprint, { color: theme.colors.textMuted }]}>
                Отпечаток ключа: {contact.fingerprint}
              </Text>
            )}
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
              Сообщений пока нет. Всё, что вы отправите, шифруется на устройстве.
            </Text>
          </View>
        }
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {replyingTo && (
        <View
          style={[styles.replyBar, { backgroundColor: theme.colors.accentSoft, borderTopColor: theme.colors.border }]}
        >
          <View style={styles.replyBarText}>
            <Text style={[styles.replyBarAuthor, { color: theme.colors.accent }]}>
              Ответ {displayNameFor(replyingTo.fromUserId)}
            </Text>
            <Text style={[styles.replyBarPreview, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {replyingTo.contentType === "text" ? (replyingTo.plaintext ?? "") : "Вложение"}
            </Text>
          </View>
          <Pressable onPress={() => setReplyingTo(null)} hitSlop={10}>
            <Text style={[styles.replyBarClose, { color: theme.colors.textMuted }]}>✕</Text>
          </Pressable>
        </View>
      )}

      {attachOpen && (
        <View style={[styles.attachSheet, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
          {[
            { icon: "🖼", label: "Фото", onPress: handlePickImage },
            { icon: "📄", label: "Файл", onPress: handlePickFile },
            { icon: "📍", label: "Я тут", onPress: handleShareLocation },
          ].map((action) => (
            <Pressable key={action.label} style={styles.attachAction} onPress={() => void action.onPress()}>
              <View style={[styles.attachIconCircle, { backgroundColor: theme.colors.accentSoft }]}>
                <Text style={styles.attachIcon}>{action.icon}</Text>
              </View>
              <Text style={[styles.attachLabel, { color: theme.colors.textSecondary }]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View
        style={[
          styles.inputRow,
          {
            // Нижние кнопки навигации перекрывали строку ввода — добавляем инсет.
            paddingBottom: 9 + insets.bottom,
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.border,
          },
        ]}
      >
        <Pressable onPress={() => setAttachOpen((open) => !open)} hitSlop={10} style={styles.plusButton}>
          <Text style={[styles.plusIcon, { color: attachOpen ? theme.colors.accent : theme.colors.textSecondary }]}>
            {attachOpen ? "✕" : "＋"}
          </Text>
        </Pressable>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.border,
              color: theme.colors.textPrimary,
            },
          ]}
          value={draft}
          onChangeText={handleDraftChange}
          placeholder={recorderState.isRecording ? "Записываю…" : "Сообщение"}
          placeholderTextColor={theme.colors.textMuted}
          multiline
        />
        {draft.trim() ? (
          <Pressable
            style={[styles.sendButton, { backgroundColor: theme.colors.accent }]}
            onPress={() => void handleSend()}
          >
            <Text style={[styles.sendIcon, { color: theme.colors.onAccent }]}>↑</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.sendButton,
              { backgroundColor: recorderState.isRecording ? theme.colors.danger : theme.colors.accent },
            ]}
            onPressIn={() => void handleStartRecording()}
            onPressOut={() => void handleStopRecording()}
          >
            <Text style={[styles.sendIcon, { color: theme.colors.onAccent }]}>🎤</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 12, paddingBottom: 16 },
  emptyContainer: { flexGrow: 1, justifyContent: "center", padding: 32 },
  bubble: {
    maxWidth: "82%",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    marginVertical: 3,
  },
  bubbleMine: { alignSelf: "flex-end", borderBottomRightRadius: 6 },
  bubbleTheirs: { alignSelf: "flex-start", borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  bubbleText: { fontSize: 16, lineHeight: 21 },
  deletedText: { fontSize: 15, fontStyle: "italic" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, marginTop: 3 },
  time: { fontSize: 11 },
  status: { fontSize: 11, fontWeight: "600" },
  image: { width: 232, height: 232, borderRadius: 12, marginBottom: 2 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 180 },
  fileIcon: { fontSize: 26 },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 15, fontWeight: "600" },
  fileSize: { fontSize: 12, marginTop: 2 },
  locationCoords: { fontSize: 12, marginTop: 3 },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4, minWidth: 130 },
  voiceIcon: { fontSize: 15 },
  voiceTime: { fontSize: 14, fontWeight: "500" },
  replyQuote: { borderLeftWidth: 3, paddingLeft: 8, marginBottom: 6, opacity: 0.9 },
  replyQuoteAuthor: { fontSize: 12, fontWeight: "700" },
  replyQuoteText: { fontSize: 13, marginTop: 1 },
  empty: { alignItems: "center", gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: "700", marginTop: 6 },
  emptyFingerprint: { fontSize: 11, letterSpacing: 0.5 },
  emptyText: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 4 },
  replyBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
  replyBarText: { flex: 1 },
  replyBarAuthor: { fontSize: 12, fontWeight: "700" },
  replyBarPreview: { fontSize: 13, marginTop: 1 },
  replyBarClose: { fontSize: 16, paddingHorizontal: 8 },
  attachSheet: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachAction: { alignItems: "center", gap: 7 },
  attachIconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  attachIcon: { fontSize: 24 },
  attachLabel: { fontSize: 12 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  plusButton: { width: 38, height: 42, alignItems: "center", justifyContent: "center" },
  plusIcon: { fontSize: 24 },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
    fontSize: 16,
  },
  sendButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  sendIcon: { fontSize: 19, fontWeight: "700" },
});
