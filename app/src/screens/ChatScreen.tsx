import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
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
import { Avatar } from "../ui/Avatar";
import { Header } from "../ui/Header";
import { Icon, type IconName } from "../ui/Icon";
import { useKeyboardVisible } from "../ui/useKeyboardVisible";
import { Wallpaper } from "../ui/Wallpaper";
import { uuidv4 } from "../util/uuid";

/** Сообщения от одного автора в пределах этого времени склеиваются в группу. */
const GROUP_WINDOW_MS = 2 * 60 * 1000;

const STATUS_ICONS: Record<LocalMessage["status"], IconName> = {
  pending: "clock",
  sent: "check",
  delivered: "checkDouble",
  read: "checkDouble",
  failed: "alert",
};

function formatTime(ts: number): string {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDay(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const sameDay = (a: Date, b: Date): boolean =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameDay(date, now)) return "сегодня";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "вчера";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  }
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function isSameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getDate() === y.getDate() && x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear();
}

/** Что показать перед сообщением и насколько плотно прижать его к предыдущему. */
interface Decorated {
  message: LocalMessage;
  showDay: boolean;
  /** Последнее в группе — только у него скруглённый «хвостик». */
  tail: boolean;
  /** Первое в группе — над ним больший отступ. */
  groupStart: boolean;
}

function decorate(messages: LocalMessage[]): Decorated[] {
  return messages.map((message, index) => {
    const prev = index > 0 ? messages[index - 1] : undefined;
    const next = index + 1 < messages.length ? messages[index + 1] : undefined;
    const groupedWithPrev =
      prev !== undefined &&
      prev.fromUserId === message.fromUserId &&
      message.createdAt - prev.createdAt < GROUP_WINDOW_MS &&
      isSameDay(prev.createdAt, message.createdAt);
    const groupedWithNext =
      next !== undefined &&
      next.fromUserId === message.fromUserId &&
      next.createdAt - message.createdAt < GROUP_WINDOW_MS &&
      isSameDay(next.createdAt, message.createdAt);

    return {
      message,
      showDay: prev === undefined || !isSameDay(prev.createdAt, message.createdAt),
      tail: !groupedWithNext,
      groupStart: !groupedWithPrev,
    };
  });
}

function VoiceBubble({
  localUri,
  durationMs,
  tint,
  trackColor,
}: {
  localUri: string;
  durationMs?: number | undefined;
  tint: string;
  trackColor: string;
}): React.ReactElement {
  const player = useAudioPlayer(localUri);
  const status = useAudioPlayerStatus(player);
  const totalSec = Math.round(status.duration || (durationMs ?? 0) / 1000 || 0);
  const currentSec = Math.round(status.currentTime || 0);
  const progress = totalSec > 0 ? Math.min(1, currentSec / totalSec) : 0;

  return (
    <View style={styles.voiceRow}>
      <Pressable
        onPress={() => (status.playing ? player.pause() : player.play())}
        hitSlop={8}
        style={[styles.voiceButton, { borderColor: tint }]}
      >
        <Icon name={status.playing ? "pause" : "play"} size={15} color={tint} />
      </Pressable>
      <View style={styles.voiceMeter}>
        <View style={[styles.voiceTrack, { backgroundColor: trackColor }]}>
          <View style={[styles.voiceFill, { backgroundColor: tint, width: `${progress * 100}%` }]} />
        </View>
        <Text style={[styles.voiceTime, { color: tint }]}>
          {currentSec > 0 ? `${formatSeconds(currentSec)} / ` : ""}
          {formatSeconds(totalSec)}
        </Text>
      </View>
    </View>
  );
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function MessageContent({
  item,
  textColor,
  metaColor,
}: {
  item: LocalMessage;
  textColor: string;
  metaColor: string;
}): React.ReactElement {
  if (item.deletedAt) {
    return <Text style={[styles.deletedText, { color: metaColor }]}>Сообщение удалено</Text>;
  }

  if (item.contentType === "image") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={[styles.bubbleText, { color: textColor }]}>Фото недоступно</Text>;
    return <Image source={{ uri: meta.localUri }} style={styles.image} resizeMode="cover" />;
  }

  if (item.contentType === "voice") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={[styles.bubbleText, { color: textColor }]}>Голосовое недоступно</Text>;
    return (
      <VoiceBubble localUri={meta.localUri} durationMs={meta.durationMs} tint={textColor} trackColor={metaColor} />
    );
  }

  if (item.contentType === "file") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={[styles.bubbleText, { color: textColor }]}>Файл недоступен</Text>;
    return (
      <View style={styles.fileRow}>
        <View style={[styles.fileIconCircle, { borderColor: metaColor }]}>
          <Icon name="file" size={19} color={textColor} />
        </View>
        <View style={styles.fileInfo}>
          <Text style={[styles.fileName, { color: textColor }]} numberOfLines={1}>
            {meta.fileName ?? "файл"}
          </Text>
          <Text style={[styles.fileSize, { color: metaColor }]}>{formatFileSize(meta.sizeBytes)}</Text>
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
          <View style={styles.locationRow}>
            <Icon name="pin" size={18} color={textColor} />
            <Text style={[styles.bubbleText, { color: textColor }]}>Я тут</Text>
          </View>
          <Text style={[styles.locationCoords, { color: metaColor }]}>
            {lat.toFixed(5)}, {lng.toFixed(5)} — открыть карту
          </Text>
        </Pressable>
      );
    } catch {
      return <Text style={[styles.bubbleText, { color: textColor }]}>Геолокация недоступна</Text>;
    }
  }

  return (
    <Text style={[styles.bubbleText, { color: item.plaintext === null ? metaColor : textColor }]}>
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
  const keyboardVisible = useKeyboardVisible();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<LocalMessage | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const listRef = useRef<FlatList<Decorated>>(null);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesByIdRef = useRef<Map<string, LocalMessage>>(new Map());

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const contact = contacts.find((c) => c.userId === peerUserId);
  const decorated = useMemo(() => decorate(messages), [messages]);

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

  // Клавиатура уменьшает список, но не меняет размер его содержимого, поэтому
  // onContentSizeChange не срабатывает — доскроллим до последнего сообщения сами.
  useEffect(() => {
    if (keyboardVisible) listRef.current?.scrollToEnd({ animated: true });
  }, [keyboardVisible]);

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

  const hasDraft = draft.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      // behavior нужен и на Android: приложение рисуется edge-to-edge, окно
      // само не сжимается, поэтому без этого клавиатура закрывала ввод.
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <Wallpaper />

      <Header
        align="left"
        title={title}
        subtitle={peerTyping ? "печатает…" : contact ? `отпечаток ${contact.fingerprint.slice(0, 9)}…` : undefined}
        subtitleColor={peerTyping ? theme.colors.accent : theme.colors.textMuted}
        onBack={onBack}
        avatar={<Avatar name={title} seed={peerUserId} size={38} />}
      />

      <FlatList
        ref={listRef}
        data={decorated}
        keyExtractor={(row) => row.message.id}
        contentContainerStyle={decorated.length === 0 ? styles.emptyContainer : styles.list}
        renderItem={({ item }) => {
          const { message, showDay, tail, groupStart } = item;
          const mine = message.fromUserId === identity.userId;
          const textColor = mine ? theme.colors.bubbleMineText : theme.colors.bubbleTheirsText;
          const metaColor = mine ? theme.colors.bubbleMineMeta : theme.colors.bubbleTheirsMeta;
          const repliedMessage = message.replyTo ? messagesByIdRef.current.get(message.replyTo) : undefined;
          const isImage = message.contentType === "image" && !message.deletedAt;

          return (
            <View>
              {showDay && (
                <View style={styles.dayWrap}>
                  <View style={[styles.dayChip, { backgroundColor: theme.colors.dateChip }]}>
                    <Text style={[styles.dayText, { color: theme.colors.dateChipText }]}>
                      {formatDay(message.createdAt)}
                    </Text>
                  </View>
                </View>
              )}

              <Pressable
                style={[
                  styles.bubble,
                  mine ? styles.bubbleMine : styles.bubbleTheirs,
                  // Хвостик только у последнего сообщения в группе — так серия
                  // сообщений читается одним блоком, как в мессенджерах.
                  tail && (mine ? styles.tailMine : styles.tailTheirs),
                  isImage && styles.bubbleImage,
                  {
                    backgroundColor: mine ? theme.colors.bubbleMine : theme.colors.bubbleTheirs,
                    borderColor: theme.colors.border,
                    marginTop: groupStart ? 8 : 2,
                    shadowColor: theme.colors.shadow,
                  },
                ]}
                onLongPress={() => handleLongPress(message)}
              >
                {repliedMessage && (
                  <View
                    style={[
                      styles.replyQuote,
                      {
                        borderLeftColor: mine ? theme.colors.bubbleMineText : theme.colors.accent,
                        backgroundColor: mine ? "rgba(255,255,255,0.14)" : theme.colors.accentSoft,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.replyQuoteAuthor, { color: mine ? theme.colors.bubbleMineText : theme.colors.accent }]}
                    >
                      {displayNameFor(repliedMessage.fromUserId)}
                    </Text>
                    <Text style={[styles.replyQuoteText, { color: mine ? theme.colors.bubbleMineText : theme.colors.textSecondary }]} numberOfLines={1}>
                      {repliedMessage.contentType === "text" ? (repliedMessage.plaintext ?? "") : "Вложение"}
                    </Text>
                  </View>
                )}

                <MessageContent item={message} textColor={textColor} metaColor={metaColor} />

                <View style={[styles.metaRow, isImage && styles.metaRowOnImage]}>
                  <Text style={[styles.time, { color: metaColor }]}>{formatTime(message.createdAt)}</Text>
                  {mine && !message.deletedAt && (
                    <Icon
                      name={STATUS_ICONS[message.status]}
                      size={15}
                      color={message.status === "read" ? theme.colors.readTick : metaColor}
                    />
                  )}
                </View>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Avatar name={title} seed={peerUserId} size={84} />
            <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>{title}</Text>
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={styles.emptyCardHead}>
                <Icon name="shield" size={18} color={theme.colors.accent} />
                <Text style={[styles.emptyCardTitle, { color: theme.colors.textPrimary }]}>Сквозное шифрование</Text>
              </View>
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                Сообщения шифруются на устройстве — сервер видит только зашифрованные блобы.
              </Text>
              {contact && (
                <Text style={[styles.emptyFingerprint, { color: theme.colors.textMuted }]}>
                  Отпечаток ключа: {contact.fingerprint}
                </Text>
              )}
            </View>
          </View>
        }
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {replyingTo && (
        <View style={[styles.replyBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.divider }]}>
          <Icon name="reply" size={19} color={theme.colors.accent} />
          <View style={styles.replyBarText}>
            <Text style={[styles.replyBarAuthor, { color: theme.colors.accent }]}>
              {displayNameFor(replyingTo.fromUserId)}
            </Text>
            <Text style={[styles.replyBarPreview, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {replyingTo.contentType === "text" ? (replyingTo.plaintext ?? "") : "Вложение"}
            </Text>
          </View>
          <Pressable onPress={() => setReplyingTo(null)} hitSlop={10} style={styles.replyBarClose}>
            <Icon name="close" size={18} color={theme.colors.textMuted} />
          </Pressable>
        </View>
      )}

      {attachOpen && (
        <View
          style={[styles.attachSheet, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.divider }]}
        >
          {(
            [
              { icon: "image", label: "Фото", onPress: handlePickImage },
              { icon: "file", label: "Файл", onPress: handlePickFile },
              { icon: "pin", label: "Я тут", onPress: handleShareLocation },
            ] as const
          ).map((action) => (
            <Pressable
              key={action.label}
              style={({ pressed }) => [styles.attachAction, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => void action.onPress()}
            >
              <View style={[styles.attachIconCircle, { backgroundColor: theme.colors.accentSoft }]}>
                <Icon name={action.icon} size={24} color={theme.colors.accent} />
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
            // Под открытой клавиатурой инсет не нужен: её высота уже включает
            // область навигации, иначе снизу оставалась бы пустая полоса.
            paddingBottom: 8 + (keyboardVisible ? 0 : insets.bottom),
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.divider,
          },
        ]}
      >
        <View
          style={[
            styles.inputPill,
            { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
          ]}
        >
          <Pressable onPress={() => setAttachOpen((open) => !open)} hitSlop={8} style={styles.attachButton}>
            <Icon
              name={attachOpen ? "close" : "plus"}
              size={22}
              color={attachOpen ? theme.colors.accent : theme.colors.textMuted}
            />
          </Pressable>
          <TextInput
            style={[styles.input, { color: theme.colors.textPrimary }]}
            value={draft}
            onChangeText={handleDraftChange}
            placeholder={recorderState.isRecording ? "Записываю…" : "Сообщение"}
            placeholderTextColor={theme.colors.textMuted}
            multiline
          />
        </View>

        {hasDraft ? (
          <Pressable
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: theme.colors.accent, transform: [{ scale: pressed ? 0.92 : 1 }] },
            ]}
            onPress={() => void handleSend()}
          >
            <Icon name="send" size={21} color={theme.colors.onAccent} />
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.sendButton,
              {
                backgroundColor: recorderState.isRecording ? theme.colors.danger : theme.colors.accent,
                transform: [{ scale: recorderState.isRecording ? 1.08 : 1 }],
              },
            ]}
            onPressIn={() => void handleStartRecording()}
            onPressOut={() => void handleStopRecording()}
          >
            <Icon name="mic" size={21} color={theme.colors.onAccent} />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 12 },
  emptyContainer: { flexGrow: 1, justifyContent: "center", padding: 28 },
  dayWrap: { alignItems: "center", marginVertical: 12 },
  dayChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  dayText: { fontSize: 12, fontWeight: "600" },
  bubble: {
    maxWidth: "80%",
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingTop: 8,
    paddingBottom: 6,
    elevation: 1,
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  bubbleMine: { alignSelf: "flex-end" },
  bubbleTheirs: { alignSelf: "flex-start", borderWidth: StyleSheet.hairlineWidth },
  tailMine: { borderBottomRightRadius: 7 },
  tailTheirs: { borderBottomLeftRadius: 7 },
  // У фото отступы убираем: картинка занимает пузырь целиком.
  bubbleImage: { paddingHorizontal: 3, paddingTop: 3, paddingBottom: 3, overflow: "hidden" },
  bubbleText: { fontSize: 16, lineHeight: 21.5 },
  deletedText: { fontSize: 15, fontStyle: "italic" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 3 },
  metaRowOnImage: {
    position: "absolute",
    right: 10,
    bottom: 9,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  time: { fontSize: 11.5 },
  image: { width: 238, height: 238, borderRadius: 17 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 11, minWidth: 190, paddingVertical: 2 },
  fileIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 15, fontWeight: "600" },
  fileSize: { fontSize: 12, marginTop: 2 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  locationCoords: { fontSize: 12, marginTop: 4 },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 11, minWidth: 168, paddingVertical: 2 },
  voiceButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.4,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceMeter: { flex: 1, gap: 5 },
  voiceTrack: { height: 3, borderRadius: 2, overflow: "hidden" },
  voiceFill: { height: 3, borderRadius: 2 },
  voiceTime: { fontSize: 12 },
  replyQuote: { borderLeftWidth: 3, paddingLeft: 8, paddingRight: 8, paddingVertical: 5, marginBottom: 6, borderRadius: 7 },
  replyQuoteAuthor: { fontSize: 12.5, fontWeight: "700" },
  replyQuoteText: { fontSize: 13, marginTop: 1, opacity: 0.85 },
  empty: { alignItems: "center" },
  emptyTitle: { fontSize: 21, fontWeight: "700", marginTop: 14, letterSpacing: -0.3 },
  emptyCard: { marginTop: 20, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  emptyCardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  emptyCardTitle: { fontSize: 15, fontWeight: "600" },
  emptyText: { fontSize: 14, lineHeight: 20 },
  emptyFingerprint: { fontSize: 11.5, letterSpacing: 0.4, marginTop: 10 },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyBarText: { flex: 1 },
  replyBarAuthor: { fontSize: 12.5, fontWeight: "700" },
  replyBarPreview: { fontSize: 13, marginTop: 1 },
  replyBarClose: { paddingHorizontal: 4 },
  attachSheet: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachAction: { alignItems: "center", gap: 8 },
  attachIconCircle: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
  attachLabel: { fontSize: 12.5 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    paddingLeft: 4,
    paddingRight: 12,
    minHeight: 44,
  },
  attachButton: { width: 38, height: 42, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, paddingTop: 11, paddingBottom: 11, maxHeight: 120, fontSize: 16, lineHeight: 21 },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
