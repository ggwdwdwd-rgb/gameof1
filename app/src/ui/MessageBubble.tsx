import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as Sharing from "expo-sharing";
import React, { useEffect, useRef, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { formatFileSize, parseLocalMediaMeta } from "../chat/media";
import type { LocalMessage } from "../db/messages";
import type { Theme } from "../theme/theme";
import { Icon, type IconName } from "./Icon";
import { LinkedText } from "./LinkedText";

/** Строка списка сообщений: само сообщение плюс всё, что вычислено заранее. */
export interface Decorated {
  message: LocalMessage;
  showDay: boolean;
  /** Последнее в группе — только у него скруглённый «хвостик». */
  tail: boolean;
  /** Первое в группе — над ним больший отступ. */
  groupStart: boolean;
  /** Автор цитируемого сообщения, уже разрешённый в имя. */
  replyAuthor: string | null;
  replyPreview: string | null;
}

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

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Голосовое: проигрыватель создаётся только после первого нажатия.
 *
 * useAudioPlayer — это нативный объект на каждый вызов хука. Если создавать его
 * сразу для каждого голосового в переписке, открытие чата с десятком записей
 * заметно подвисает. До нажатия рисуем ту же строку, но без плеера.
 */
function VoiceContent({
  localUri,
  durationMs,
  tint,
  trackColor,
}: {
  localUri: string;
  durationMs: number | undefined;
  tint: string;
  trackColor: string;
}): React.ReactElement {
  const [started, setStarted] = useState(false);
  if (!started) {
    return (
      <VoiceRow
        tint={tint}
        trackColor={trackColor}
        playing={false}
        progress={0}
        label={formatSeconds(Math.round((durationMs ?? 0) / 1000))}
        onPress={() => setStarted(true)}
      />
    );
  }
  return <VoicePlayer localUri={localUri} durationMs={durationMs} tint={tint} trackColor={trackColor} />;
}

function VoicePlayer({
  localUri,
  durationMs,
  tint,
  trackColor,
}: {
  localUri: string;
  durationMs: number | undefined;
  tint: string;
  trackColor: string;
}): React.ReactElement {
  const player = useAudioPlayer(localUri);
  const status = useAudioPlayerStatus(player);
  const totalSec = Math.round(status.duration || (durationMs ?? 0) / 1000 || 0);
  const currentSec = Math.round(status.currentTime || 0);
  const progress = totalSec > 0 ? Math.min(1, currentSec / totalSec) : 0;

  // Первое нажатие уже было — начинаем играть, как только плеер готов.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !status.isLoaded) return;
    autoStarted.current = true;
    player.play();
  }, [player, status.isLoaded]);

  return (
    <VoiceRow
      tint={tint}
      trackColor={trackColor}
      playing={status.playing}
      progress={progress}
      label={`${currentSec > 0 ? `${formatSeconds(currentSec)} / ` : ""}${formatSeconds(totalSec)}`}
      onPress={() => (status.playing ? player.pause() : player.play())}
    />
  );
}

function VoiceRow({
  tint,
  trackColor,
  playing,
  progress,
  label,
  onPress,
}: {
  tint: string;
  trackColor: string;
  playing: boolean;
  progress: number;
  label: string;
  onPress: () => void;
}): React.ReactElement {
  return (
    <View style={styles.voiceRow}>
      <Pressable onPress={onPress} hitSlop={8} style={[styles.voiceButton, { borderColor: tint }]}>
        <Icon name={playing ? "pause" : "play"} size={15} color={tint} />
      </Pressable>
      <View style={styles.voiceMeter}>
        <View style={[styles.voiceTrack, { backgroundColor: trackColor }]}>
          <View style={[styles.voiceFill, { backgroundColor: tint, width: `${progress * 100}%` }]} />
        </View>
        <Text style={[styles.voiceTime, { color: tint }]}>{label}</Text>
      </View>
    </View>
  );
}

function MessageContent({
  item,
  textColor,
  metaColor,
  linkColor,
  onOpenImage,
}: {
  item: LocalMessage;
  textColor: string;
  metaColor: string;
  linkColor: string;
  onOpenImage: (uri: string) => void;
}): React.ReactElement {
  if (item.deletedAt) {
    return <Text style={[styles.deletedText, { color: metaColor }]}>Сообщение удалено</Text>;
  }

  if (item.contentType === "image") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={[styles.bubbleText, { color: textColor }]}>Фото недоступно</Text>;
    const localUri = meta.localUri;
    return (
      <Pressable onPress={() => onOpenImage(localUri)}>
        <Image source={{ uri: localUri }} style={styles.image} resizeMode="cover" />
      </Pressable>
    );
  }

  if (item.contentType === "voice") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={[styles.bubbleText, { color: textColor }]}>Голосовое недоступно</Text>;
    return (
      <VoiceContent localUri={meta.localUri} durationMs={meta.durationMs} tint={textColor} trackColor={metaColor} />
    );
  }

  if (item.contentType === "file") {
    const meta = parseLocalMediaMeta(item.plaintext);
    if (!meta) return <Text style={[styles.bubbleText, { color: textColor }]}>Файл недоступен</Text>;
    const fileUri = meta.localUri;
    return (
      <Pressable style={styles.fileRow} onPress={() => void shareFile(fileUri)}>
        <View style={[styles.fileIconCircle, { borderColor: metaColor }]}>
          <Icon name="file" size={19} color={textColor} />
        </View>
        <View style={styles.fileInfo}>
          <Text style={[styles.fileName, { color: textColor }]} numberOfLines={1}>
            {meta.fileName ?? "файл"}
          </Text>
          <Text style={[styles.fileSize, { color: metaColor }]}>{formatFileSize(meta.sizeBytes)}</Text>
        </View>
        <Icon name="share" size={17} color={metaColor} />
      </Pressable>
    );
  }

  if (item.contentType === "location") {
    const coords = parseCoords(item.plaintext);
    if (!coords) return <Text style={[styles.bubbleText, { color: textColor }]}>Геолокация недоступна</Text>;
    return (
      <Pressable onPress={() => void Linking.openURL(`https://maps.google.com/?q=${coords.lat},${coords.lng}`)}>
        <View style={styles.locationRow}>
          <Icon name="pin" size={18} color={textColor} />
          <Text style={[styles.bubbleText, { color: textColor }]}>Я тут</Text>
        </View>
        <Text style={[styles.locationCoords, { color: metaColor }]}>
          {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} — открыть карту
        </Text>
      </Pressable>
    );
  }

  if (item.plaintext === null) {
    return <Text style={[styles.bubbleText, { color: metaColor }]}>Не удалось расшифровать сообщение</Text>;
  }
  return <LinkedText text={item.plaintext} style={[styles.bubbleText, { color: textColor }]} linkColor={linkColor} />;
}

async function shareFile(uri: string): Promise<void> {
  try {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
  } catch {
    // Нечем открыть — молча ничего не делаем, ронять чат из-за этого незачем.
  }
}

function parseCoords(raw: string | null): { lat: number; lng: number } | null {
  try {
    const { lat, lng } = JSON.parse(raw ?? "{}") as { lat: unknown; lng: unknown };
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

interface BubbleProps {
  row: Decorated;
  mine: boolean;
  theme: Theme;
  onLongPress: (message: LocalMessage) => void;
  onOpenImage: (uri: string) => void;
}

function MessageBubbleBase({ row, mine, theme, onLongPress, onOpenImage }: BubbleProps): React.ReactElement {
  const { message, showDay, tail, groupStart, replyAuthor, replyPreview } = row;
  const textColor = mine ? theme.colors.bubbleMineText : theme.colors.bubbleTheirsText;
  const metaColor = mine ? theme.colors.bubbleMineMeta : theme.colors.bubbleTheirsMeta;
  const isImage = message.contentType === "image" && !message.deletedAt;

  return (
    <View>
      {showDay && (
        <View style={styles.dayWrap}>
          <View style={[styles.dayChip, { backgroundColor: theme.colors.dateChip }]}>
            <Text style={[styles.dayText, { color: theme.colors.dateChipText }]}>{formatDay(message.createdAt)}</Text>
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
        onLongPress={() => onLongPress(message)}
      >
        {replyAuthor !== null && (
          <View
            style={[
              styles.replyQuote,
              {
                borderLeftColor: mine ? theme.colors.bubbleMineText : theme.colors.accent,
                backgroundColor: mine ? "rgba(255,255,255,0.14)" : theme.colors.accentSoft,
              },
            ]}
          >
            <Text style={[styles.replyQuoteAuthor, { color: mine ? theme.colors.bubbleMineText : theme.colors.accent }]}>
              {replyAuthor}
            </Text>
            <Text
              style={[styles.replyQuoteText, { color: mine ? theme.colors.bubbleMineText : theme.colors.textSecondary }]}
              numberOfLines={1}
            >
              {replyPreview}
            </Text>
          </View>
        )}

        <MessageContent
          item={message}
          textColor={textColor}
          metaColor={metaColor}
          // В своём пузыре акцент — это фон, ссылка на нём была бы не видна.
          linkColor={mine ? theme.colors.bubbleMineText : theme.colors.accent}
          onOpenImage={onOpenImage}
        />

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
}

/**
 * Сравниваем по значениям, а не по ссылке на сообщение: перечитывание из sqlite
 * каждый раз возвращает новые объекты, и без этого FlatList перерисовывал бы
 * все видимые строки на любое обновление.
 */
export const MessageBubble = React.memo(MessageBubbleBase, (a, b) => {
  return (
    a.mine === b.mine &&
    a.theme === b.theme &&
    a.onLongPress === b.onLongPress &&
    a.onOpenImage === b.onOpenImage &&
    a.row.showDay === b.row.showDay &&
    a.row.tail === b.row.tail &&
    a.row.groupStart === b.row.groupStart &&
    a.row.replyAuthor === b.row.replyAuthor &&
    a.row.replyPreview === b.row.replyPreview &&
    a.row.message.id === b.row.message.id &&
    a.row.message.status === b.row.message.status &&
    a.row.message.plaintext === b.row.message.plaintext &&
    a.row.message.deletedAt === b.row.message.deletedAt &&
    a.row.message.createdAt === b.row.message.createdAt
  );
});

const styles = StyleSheet.create({
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
  // У фото отступы убираем явными longhand-свойствами: короткое `padding`
  // в RN проигрывает более специфичному `paddingHorizontal` базового стиля.
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
  replyQuote: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 5,
    marginBottom: 6,
    borderRadius: 7,
  },
  replyQuoteAuthor: { fontSize: 12.5, fontWeight: "700" },
  replyQuoteText: { fontSize: 13, marginTop: 1, opacity: 0.85 },
});
