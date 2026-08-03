import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { buildEnvelopeFromLocalFile, persistLocalFile } from "../chat/media";
import { getCurrentLocationOnce, pickAndCompressImage, pickFile } from "../chat/pickers";
import { useApp, type SendResult } from "../context/AppContext";
import { contactTitle } from "../db/contacts";
import { listMessagesForChat, type LocalMessage } from "../db/messages";
import { useTheme } from "../theme/ThemeContext";
import { ActionSheet, type SheetAction } from "../ui/ActionSheet";
import { Avatar } from "../ui/Avatar";
import { Composer } from "../ui/Composer";
import { Header } from "../ui/Header";
import { Icon } from "../ui/Icon";
import { ImageViewer } from "../ui/ImageViewer";
import { MessageBubble, type Decorated } from "../ui/MessageBubble";
import { RenameModal } from "../ui/RenameModal";
import { Toast, useToast } from "../ui/Toast";
import { TypingDots } from "../ui/TypingDots";
import { describePresence } from "../ui/presence";
import { useKeyboard } from "../ui/useKeyboard";
import { Wallpaper } from "../ui/Wallpaper";
import { uuidv4 } from "../util/uuid";

/** Сообщения от одного автора в пределах этого времени склеиваются в группу. */
const GROUP_WINDOW_MS = 2 * 60 * 1000;

const SEND_ERRORS: Record<"NO_CONTACT" | "NOT_READY" | "CRYPTO_FAILED" | "FAILED", string> = {
  NO_CONTACT: "Данные собеседника ещё не получены с сервера. Дождитесь подключения и попробуйте снова.",
  NOT_READY: "Приложение ещё инициализируется. Попробуйте через секунду.",
  CRYPTO_FAILED: "Не удалось зашифровать сообщение. Переустановите приложение — возможно, повреждены ключи.",
  FAILED: "Сообщение не удалось сохранить на устройстве.",
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
function decorate(
  messages: LocalMessage[],
  nameFor: (userId: string) => string,
  freshIds: ReadonlySet<string>,
): Decorated[] {
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
      fresh: freshIds.has(message.id),
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
  const {
    identity,
    contacts,
    presence,
    chatEvents,
    sendText,
    sendMedia,
    sendLocation,
    deleteMessage,
    markChatRead,
    setTyping,
    setActiveChat,
    renameContact,
  } = useApp();
  const theme = useTheme();
  const keyboard = useKeyboard();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [replyingTo, setReplyingTo] = useState<LocalMessage | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  /** Сообщение, для которого открыт лист действий. */
  const [menuFor, setMenuFor] = useState<LocalMessage | null>(null);
  const { toast, showToast, hideToast } = useToast();
  const listRef = useRef<FlatList<Decorated>>(null);

  const contact = contacts.find((c) => c.userId === peerUserId);
  // Имя берём из контакта, а не только из пропса: если его переименовали, пока
  // чат открыт, шапка должна обновиться сама.
  const peerTitle = contact ? contactTitle(contact) : title;
  const presenceText = describePresence(presence.get(peerUserId));

  const nameFor = useCallback(
    (userId: string): string => {
      if (userId === identity.userId) return "Вы";
      return contacts.find((c) => c.userId === userId)?.displayName ?? "…";
    },
    [contacts, identity.userId],
  );

  /**
   * Сообщения, появившиеся уже при открытом чате, — только их и анимируем.
   *
   * Раньше «свежесть» определялась по времени создания, и сообщение,
   * пришедшее пару секунд назад, проигрывало появление ещё раз при входе в
   * чат. Здесь же сравнение с тем, что экран уже показывал: при первой
   * загрузке новых нет вовсе, поэтому переписка просто рисуется.
   *
   * Ref, а не состояние: набор меняется в той же операции, что и messages, и
   * отдельная перерисовка на него не нужна.
   */
  const seenIds = useRef<Set<string>>(new Set());
  const freshIds = useRef<Set<string>>(new Set());
  /** Отдельный флаг: в пустом чате по размеру seenIds первую загрузку не отличить. */
  const loadedOnce = useRef(false);

  // Список inverted: элемент 0 рисуется внизу, поэтому порядок обратный.
  // Разметку строки это не меняет — внутри ячейки порядок остаётся обычным.
  const decorated = useMemo(() => decorate(messages, nameFor, freshIds.current).reverse(), [messages, nameFor]);

  useEffect(() => {
    let mounted = true;
    seenIds.current = new Set();
    freshIds.current = new Set();
    loadedOnce.current = false;

    async function refresh(): Promise<void> {
      const rows = await listMessagesForChat(chatId);
      if (!mounted) return;
      freshIds.current = loadedOnce.current
        ? new Set(rows.filter((r) => !seenIds.current.has(r.id)).map((r) => r.id))
        : new Set();
      for (const row of rows) seenIds.current.add(row.id);
      loadedOnce.current = true;
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

  // Уходя с экрана, обязательно снимаем свой индикатор "печатает".
  useEffect(() => () => setTyping(chatId, false), [chatId, setTyping]);

  // Пока чат открыт, уведомления по нему не нужны: сообщение видно на экране.
  useEffect(() => {
    setActiveChat(chatId);
    return () => setActiveChat(null);
  }, [chatId, setActiveChat]);

  const reportIfFailed = useCallback((result: SendResult): void => {
    if (result.ok) return;
    // detail — настоящий текст ошибки; без него причина остаётся догадкой.
    const detail = result.detail !== undefined ? `\n\n${result.detail}` : "";
    Alert.alert("Сообщение не отправлено", `${SEND_ERRORS[result.reason]}${detail}`);
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

  // Меню сообщения — свой лист действий вместо Alert.alert: системный диалог
  // выглядел чужим (серая карточка с бирюзовыми надписями) и не показывал даже,
  // о каком сообщении речь.
  const handleLongPress = useCallback((item: LocalMessage): void => {
    if (item.deletedAt) return;
    setMenuFor(item);
  }, []);

  const menuActions = useMemo((): SheetAction[] => {
    const item = menuFor;
    if (!item) return [];
    const actions: SheetAction[] = [{ label: "Ответить", icon: "reply", onPress: () => setReplyingTo(item) }];
    // Копировать имеет смысл только текст: у вложений в plaintext лежат
    // метаданные файла, а не то, что видит пользователь.
    if (item.contentType === "text" && item.plaintext !== null) {
      const text = item.plaintext;
      actions.push({
        label: "Копировать",
        icon: "copy",
        onPress: () => {
          void Clipboard.setStringAsync(text);
          showToast("Скопировано", "copy");
        },
      });
    }
    if (item.fromUserId === identity.userId) {
      actions.push({
        label: "Удалить у всех",
        icon: "trash",
        destructive: true,
        onPress: () => void deleteMessage(item.id, chatId),
      });
    }
    return actions;
  }, [menuFor, chatId, deleteMessage, identity.userId, showToast]);

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

  const handleOpenImage = useCallback((uri: string) => setViewerUri(uri), []);

  const renderItem = useCallback(
    ({ item }: { item: Decorated }) => (
      <MessageBubble
        row={item}
        mine={item.message.fromUserId === identity.userId}
        theme={theme}
        onLongPress={handleLongPress}
        onOpenImage={handleOpenImage}
      />
    ),
    [handleLongPress, handleOpenImage, identity.userId, theme],
  );

  return (
    // Отступ снизу — ровно та часть высоты клавиатуры, которую система не
    // освободила сама (см. useKeyboard). KeyboardAvoidingView здесь не
    // подходит: он считает отступ по onLayout содержимого, и с растущим
    // multiline-вводом получалась петля «ввод вырос → отступ изменился →
    // ввод пересчитался», из-за которой приложение подвисало ровно тогда,
    // когда сообщение перестаёт влезать в одну строку.
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingBottom: keyboard.avoidOffset }]}>
      <Wallpaper />

      <Header
        align="left"
        title={peerTitle}
        // «Печатает» важнее статуса, статус важнее отпечатка ключа. Для
        // «печатает» — отдельный элемент с анимированными точками: статичная
        // надпись читается как состояние, а не как процесс.
        subtitleNode={peerTyping ? <TypingDots color={theme.colors.accent} /> : undefined}
        subtitle={peerTyping ? undefined : presenceText !== "" ? presenceText : undefined}
        subtitleColor={
          presence.get(peerUserId)?.online === true ? theme.colors.success : theme.colors.textMuted
        }
        onBack={onBack}
        // Нажатие по имени в шапке — переименование, как в мессенджерах: там же,
        // где на него смотрят. В настройках оно тоже есть, но искать его там
        // никто не станет.
        onPressTitle={contact ? () => setRenaming(true) : undefined}
        avatar={
          <Avatar
            name={peerTitle}
            seed={peerUserId}
            size={38}
            online={presence.get(peerUserId)?.online === true}
            ringColor={theme.colors.surface}
          />
        }
        right={
          contact ? (
            <Pressable onPress={() => setRenaming(true)} hitSlop={12} style={styles.headerAction}>
              <Icon name="edit" size={20} color={theme.colors.textSecondary} />
            </Pressable>
          ) : undefined
        }
      />

      <FlatList
        ref={listRef}
        data={decorated}
        keyExtractor={keyExtractor}
        contentContainerStyle={decorated.length === 0 ? styles.emptyContainer : styles.list}
        renderItem={renderItem}
        // Открывается сразу на последних сообщениях: в inverted-списке начало
        // данных — это низ экрана, поэтому ручной доскролл не нужен вовсе.
        // Раньше чат открывался посередине, пока scrollToEnd не сработает.
        inverted
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
            <Avatar name={peerTitle} seed={peerUserId} size={84} />
            <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>{peerTitle}</Text>
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

      {/* Отозванному устройству сообщения не доставляются, поэтому строку ввода
          убираем совсем: иначе отправленное молча висело бы «отправлено» без
          надежды дойти. Переписку при этом видно — отзыв обратим. */}
      {contact?.isRevoked ? (
        <View
          style={[
            styles.revokedBar,
            {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.divider,
              paddingBottom: 14 + keyboard.safeBottom,
            },
          ]}
        >
          <Icon name="alert" size={19} color={theme.colors.danger} />
          <Text style={[styles.revokedText, { color: theme.colors.textSecondary }]}>
            Доступ устройства отозван — писать этому участнику нельзя. Переписка сохранена, доступ возвращается в
            настройках.
          </Text>
        </View>
      ) : (
        <Composer
          // Отступ считает useKeyboard: при открытой клавиатуре системный инсет
          // обнуляется, хотя место под навигацию всё ещё нужно, и строка ввода
          // уезжала под клавиатуру.
          bottomInset={keyboard.safeBottom}
          onSendText={handleSendText}
          onTyping={handleTyping}
          onPickImage={handlePickImage}
          onPickFile={handlePickFile}
          onShareLocation={handleShareLocation}
          onVoiceRecorded={handleVoiceRecorded}
          onNotice={showToast}
        />
      )}

      <Toast state={toast} onHide={hideToast} />

      <ActionSheet
        visible={menuFor !== null}
        title={menuFor ? previewOf(menuFor).slice(0, 90) : undefined}
        actions={menuActions}
        onClose={() => setMenuFor(null)}
      />

      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />

      {contact && (
        <RenameModal
          visible={renaming}
          title="Название контакта"
          hint={`Как подписать ${contact.displayName} на этом устройстве. Пустое поле вернёт настоящее имя.`}
          initialValue={contact.localName ?? ""}
          placeholder={contact.displayName}
          allowEmpty
          onCancel={() => setRenaming(false)}
          onSubmit={(value) => {
            setRenaming(false);
            void renameContact(contact.userId, value);
          }}
        />
      )}
    </View>
  );
}

function keyExtractor(row: Decorated): string {
  return row.message.id;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerAction: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
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
  revokedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  revokedText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
