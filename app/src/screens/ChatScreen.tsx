import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { buildEnvelopeFromLocalFile, persistLocalFile } from "../chat/media";
import { getCurrentLocationOnce, pickAndCompressImage, pickFile } from "../chat/pickers";
import { useApp, type SendResult } from "../context/AppContext";
import { listMessagesForChat, type LocalMessage } from "../db/messages";
import { useTheme } from "../theme/ThemeContext";
import { Avatar } from "../ui/Avatar";
import { Composer } from "../ui/Composer";
import { Header } from "../ui/Header";
import { Icon } from "../ui/Icon";
import { MessageBubble, type Decorated } from "../ui/MessageBubble";
import { useKeyboardVisible } from "../ui/useKeyboardVisible";
import { Wallpaper } from "../ui/Wallpaper";
import { uuidv4 } from "../util/uuid";

/** Сообщения от одного автора в пределах этого времени склеиваются в группу. */
const GROUP_WINDOW_MS = 2 * 60 * 1000;

const SEND_ERRORS: Record<"NO_CONTACT" | "NOT_READY" | "CRYPTO_FAILED", string> = {
  NO_CONTACT: "Данные собеседника ещё не получены с сервера. Дождитесь подключения и попробуйте снова.",
  NOT_READY: "Приложение ещё инициализируется. Попробуйте через секунду.",
  CRYPTO_FAILED: "Не удалось зашифровать сообщение. Переустановите приложение — возможно, повреждены ключи.",
};

function isSameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getDate() === y.getDate() && x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear();
}

function previewOf(message: LocalMessage): string {
  if (message.deletedAt) return "Сообщение удалено";
  if (message.contentType === "text") return message.plaintext ?? "";
  return "Вложение";
}

/**
 * Готовим для каждого сообщения всё, что нужно строке: разделитель дня,
 * положение в группе и уже разрешённую цитату. Строки сравниваются по
 * простым значениям, поэтому React.memo реально спасает от перерисовок.
 */
function decorate(messages: LocalMessage[], nameFor: (userId: string) => string): Decorated[] {
  const byId = new Map(messages.map((m) => [m.id, m]));

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

    const replied = message.replyTo ? byId.get(message.replyTo) : undefined;

    return {
      message,
      showDay: prev === undefined || !isSameDay(prev.createdAt, message.createdAt),
      tail: !groupedWithNext,
      groupStart: !groupedWithPrev,
      replyAuthor: replied ? nameFor(replied.fromUserId) : null,
      replyPreview: replied ? previewOf(replied) : null,
    };
  });
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
  const { identity, contacts, chatEvents, sendText, sendMedia, sendLocation, deleteMessage, markChatRead, setTyping } =
    useApp();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [replyingTo, setReplyingTo] = useState<LocalMessage | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const listRef = useRef<FlatList<Decorated>>(null);

  const contact = contacts.find((c) => c.userId === peerUserId);

  const nameFor = useCallback(
    (userId: string): string => {
      if (userId === identity.userId) return "Вы";
      return contacts.find((c) => c.userId === userId)?.displayName ?? "…";
    },
    [contacts, identity.userId],
  );

  const decorated = useMemo(() => decorate(messages, nameFor), [messages, nameFor]);

  useEffect(() => {
    let mounted = true;

    async function refresh(): Promise<void> {
      const rows = await listMessagesForChat(chatId);
      if (!mounted) return;
      setMessages(rows);
      // Прочитанность отмечаем одним запросом, и только для реально
      // непрочитанных: раньше на каждое обновление уходила квитанция по
      // каждому входящему сообщению, что и создавало поток событий.
      void markChatRead(chatId);
    }

    void refresh();
    const offInserted = chatEvents.on("messageInserted", (insertedChatId) => {
      if (insertedChatId === chatId) void refresh();
    });
    // Оба события фильтруем по чату: обновления в других чатах этот экран
    // не касаются.
    const offStatus = chatEvents.on("messageStatusChanged", (changedChatId) => {
      if (changedChatId === chatId) void refresh();
    });
    const offTyping = chatEvents.on("typingChanged", (typingChatId, _fromUserId, isTyping) => {
      if (typingChatId === chatId) setPeerTyping(isTyping);
    });

    return () => {
      mounted = false;
      offInserted();
      offStatus();
      offTyping();
    };
  }, [chatId, chatEvents, markChatRead]);

  // Клавиатура уменьшает список, но не меняет размер его содержимого, поэтому
  // onContentSizeChange не срабатывает — доскроллим до последнего сообщения сами.
  useEffect(() => {
    if (keyboardVisible) listRef.current?.scrollToEnd({ animated: true });
  }, [keyboardVisible]);

  // Уходя с экрана, обязательно снимаем свой индикатор "печатает".
  useEffect(() => () => setTyping(chatId, false), [chatId, setTyping]);

  const reportIfFailed = useCallback((result: SendResult): void => {
    if (result.ok) return;
    Alert.alert("Сообщение не отправлено", SEND_ERRORS[result.reason]);
  }, []);

  /** Забирает и сбрасывает выбранное сообщение-ответ. */
  const takeReplyTo = useCallback((): string | null => {
    const replyTo = replyingTo?.id ?? null;
    if (replyTo !== null) setReplyingTo(null);
    return replyTo;
  }, [replyingTo]);

  const handleSendText = useCallback(
    async (text: string): Promise<void> => {
      reportIfFailed(await sendText(chatId, text, takeReplyTo()));
    },
    [chatId, reportIfFailed, sendText, takeReplyTo],
  );

  const handleLongPress = useCallback(
    (item: LocalMessage): void => {
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
    },
    [chatId, deleteMessage, identity.userId],
  );

  const handlePickImage = useCallback(async (): Promise<void> => {
    const prepared = await pickAndCompressImage();
    if (!prepared) return;
    reportIfFailed(await sendMedia(chatId, "image", prepared.envelopeJson, prepared.localMeta, takeReplyTo()));
  }, [chatId, reportIfFailed, sendMedia, takeReplyTo]);

  const handlePickFile = useCallback(async (): Promise<void> => {
    const prepared = await pickFile();
    if (!prepared) return;
    if ("error" in prepared) {
      Alert.alert("Файл слишком большой", "Максимальный размер файла — 25 МБ.");
      return;
    }
    reportIfFailed(await sendMedia(chatId, "file", prepared.envelopeJson, prepared.localMeta, takeReplyTo()));
  }, [chatId, reportIfFailed, sendMedia, takeReplyTo]);

  const handleShareLocation = useCallback(async (): Promise<void> => {
    const location = await getCurrentLocationOnce();
    if (!location) {
      Alert.alert("Нет доступа к геолокации", "Разрешите доступ в настройках устройства.");
      return;
    }
    reportIfFailed(await sendLocation(chatId, location.lat, location.lng, takeReplyTo()));
  }, [chatId, reportIfFailed, sendLocation, takeReplyTo]);

  const handleVoiceRecorded = useCallback(
    async (uri: string, durationMs: number): Promise<void> => {
      const localUri = persistLocalFile(uri, `${uuidv4()}.m4a`);
      const envelopeJson = buildEnvelopeFromLocalFile(localUri, { mimeType: "audio/m4a", durationMs });
      reportIfFailed(
        await sendMedia(chatId, "voice", envelopeJson, { localUri, mimeType: "audio/m4a", durationMs }, takeReplyTo()),
      );
    },
    [chatId, reportIfFailed, sendMedia, takeReplyTo],
  );

  const handleTyping = useCallback((isTyping: boolean) => setTyping(chatId, isTyping), [chatId, setTyping]);

  const renderItem = useCallback(
    ({ item }: { item: Decorated }) => (
      <MessageBubble
        row={item}
        mine={item.message.fromUserId === identity.userId}
        theme={theme}
        onLongPress={handleLongPress}
      />
    ),
    [handleLongPress, identity.userId, theme],
  );

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
        keyExtractor={keyExtractor}
        contentContainerStyle={decorated.length === 0 ? styles.emptyContainer : styles.list}
        renderItem={renderItem}
        // Длинная переписка не должна отрисовываться целиком: держим окно
        // вокруг видимой области. removeClippedSubviews сознательно не включаю —
        // на Android он периодически оставляет пустые строки, а выигрыш здесь
        // невелик.
        initialNumToRender={18}
        maxToRenderPerBatch={12}
        windowSize={9}
        keyboardShouldPersistTaps="handled"
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
              {nameFor(replyingTo.fromUserId)}
            </Text>
            <Text style={[styles.replyBarPreview, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {previewOf(replyingTo)}
            </Text>
          </View>
          <Pressable onPress={() => setReplyingTo(null)} hitSlop={10} style={styles.replyBarClose}>
            <Icon name="close" size={18} color={theme.colors.textMuted} />
          </Pressable>
        </View>
      )}

      <Composer
        bottomInset={keyboardVisible ? 0 : insets.bottom}
        onSendText={handleSendText}
        onTyping={handleTyping}
        onPickImage={handlePickImage}
        onPickFile={handlePickFile}
        onShareLocation={handleShareLocation}
        onVoiceRecorded={handleVoiceRecorded}
      />
    </KeyboardAvoidingView>
  );
}

function keyExtractor(row: Decorated): string {
  return row.message.id;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 12 },
  emptyContainer: { flexGrow: 1, justifyContent: "center", padding: 28 },
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
});
