import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dmChatId } from "../chat/chatId";
import { describeFailure, useApp } from "../context/AppContext";
import { countUnreadForChat, getLastMessageForChat, type LocalMessage } from "../db/messages";
import { useTheme } from "../theme/ThemeContext";
import { Avatar } from "../ui/Avatar";
import { Header } from "../ui/Header";
import { Icon, type IconName } from "../ui/Icon";

interface ChatRow {
  chatId: string;
  userId: string;
  title: string;
  preview: string;
  /** Иконка вложения перед текстом превью — как в мессенджерах. */
  previewIcon: IconName | null;
  ts: number;
  unread: number;
  /** Статус последнего сообщения, если оно наше: галочки рисуются в превью. */
  outgoingStatus: LocalMessage["status"] | null;
}

const MEDIA_PREVIEWS: Record<string, { label: string; icon: IconName }> = {
  image: { label: "Фото", icon: "image" },
  voice: { label: "Голосовое сообщение", icon: "mic" },
  file: { label: "Файл", icon: "file" },
  location: { label: "Геолокация", icon: "pin" },
};

const STATE_LABELS: Record<string, string> = {
  idle: "нет соединения",
  connecting: "подключение…",
  reconnecting: "переподключение…",
  connected: "на связи",
};

function previewOf(message: LocalMessage | null): { text: string; icon: IconName | null } {
  if (!message) return { text: "Нет сообщений", icon: null };
  if (message.deletedAt) return { text: "Сообщение удалено", icon: null };
  if (message.contentType === "text") return { text: message.plaintext ?? "…", icon: null };
  const media = MEDIA_PREVIEWS[message.contentType];
  return media ? { text: media.label, icon: media.icon } : { text: "Вложение", icon: "file" };
}

/** Сегодня — время, вчера — «вчера», в этом году — день и месяц, иначе с годом. */
function formatStamp(ts: number): string {
  if (!ts) return "";
  const date = new Date(ts);
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  if (sameDay) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return "вчера";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
  }
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function ChatListScreen({
  onOpenChat,
  onOpenSettings,
  onAddPerson,
}: {
  onOpenChat: (chatId: string, title: string, userId: string) => void;
  onOpenSettings: () => void;
  onAddPerson: () => void;
}): React.ReactElement {
  const { identity, connectionState, connectionFailure, contacts, chatEvents, reconnect } = useApp();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<ChatRow[]>([]);

  const refresh = useCallback(async () => {
    const contactRows = await Promise.all(
      contacts
        .filter((c) => !c.isRevoked)
        .map(async (contact) => {
          const chatId = dmChatId(identity.userId, contact.userId);
          const last = await getLastMessageForChat(chatId);
          const preview = previewOf(last);
          return {
            chatId,
            userId: contact.userId,
            title: contact.displayName,
            preview: preview.text,
            previewIcon: preview.icon,
            ts: last?.createdAt ?? 0,
            unread: await countUnreadForChat(chatId, identity.userId),
            outgoingStatus: last && last.fromUserId === identity.userId && !last.deletedAt ? last.status : null,
          };
        }),
    );
    setRows(contactRows.sort((a, b) => b.ts - a.ts));
  }, [contacts, identity.userId]);

  useEffect(() => {
    void refresh();
    const offInserted = chatEvents.on("messageInserted", () => void refresh());
    const offStatus = chatEvents.on("messageStatusChanged", () => void refresh());
    return () => {
      offInserted();
      offStatus();
    };
  }, [refresh, chatEvents]);

  const connected = connectionState === "connected";

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Cry"
        subtitle={connected ? STATE_LABELS.connected : `${STATE_LABELS[connectionState] ?? connectionState} · обновить`}
        // Ручное переподключение: быстрее, чем ждать backoff или перезапускать приложение.
        onPressSubtitle={connected ? undefined : reconnect}
        subtitleColor={connected ? theme.colors.success : theme.colors.accent}
        left={<View style={styles.headerSlot} />}
        right={
          <Pressable onPress={onOpenSettings} hitSlop={12} style={styles.headerSlot}>
            <Icon name="settings" size={22} color={theme.colors.textSecondary} />
          </Pressable>
        }
      />

      {/* Фатальную ошибку показываем полосой: она не пройдёт сама, и молчать
          о ней нельзя — иначе приложение просто «не работает» без объяснений. */}
      {connectionFailure?.kind === "fatal" && (
        <View style={[styles.banner, { backgroundColor: theme.colors.danger }]}>
          <Icon name="alert" size={18} color="#fff" />
          <Text style={styles.bannerText}>{describeFailure(connectionFailure)}</Text>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(row) => row.chatId}
        contentContainerStyle={[
          rows.length === 0 ? styles.emptyContainer : styles.list,
          // Кнопка «+» и панель навигации не должны перекрывать последний чат.
          { paddingBottom: insets.bottom + 96 },
        ]}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.colors.divider }]} />
        )}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? theme.colors.surfacePressed : "transparent" },
            ]}
            onPress={() => onOpenChat(item.chatId, item.title, item.userId)}
          >
            <Avatar name={item.title} seed={item.userId} size={54} />

            <View style={styles.rowText}>
              <View style={styles.rowTopLine}>
                <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.rowStamp, { color: theme.colors.textMuted }]}>{formatStamp(item.ts)}</Text>
              </View>

              <View style={styles.rowBottomLine}>
                {item.outgoingStatus && (
                  <View style={styles.previewTick}>
                    <Icon
                      name={item.outgoingStatus === "pending" ? "clock" : item.outgoingStatus === "sent" ? "check" : "checkDouble"}
                      size={15}
                      color={item.outgoingStatus === "read" ? theme.colors.accent : theme.colors.textMuted}
                    />
                  </View>
                )}
                {item.previewIcon && (
                  <View style={styles.previewIcon}>
                    <Icon name={item.previewIcon} size={15} color={theme.colors.textMuted} />
                  </View>
                )}
                <Text style={[styles.rowPreview, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                  {item.preview}
                </Text>
                {item.unread > 0 && (
                  <View style={[styles.badge, { backgroundColor: theme.colors.accent }]}>
                    <Text style={[styles.badgeText, { color: theme.colors.onAccent }]}>
                      {item.unread > 99 ? "99+" : item.unread}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.accentSoft }]}>
              <Icon name="shield" size={34} color={theme.colors.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>Пока никого нет</Text>
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
              Создайте код приглашения и передайте его тому, с кем хотите переписываться. Всё шифруется на устройстве.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.emptyButton,
                { backgroundColor: theme.colors.accent, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={onAddPerson}
            >
              <Text style={[styles.emptyButtonText, { color: theme.colors.onAccent }]}>Добавить человека</Text>
            </Pressable>
          </View>
        }
      />

      <Pressable
        style={({ pressed }) => [
          styles.fab,
          {
            bottom: insets.bottom + 22,
            backgroundColor: theme.colors.accent,
            shadowColor: theme.colors.shadow,
            transform: [{ scale: pressed ? 0.94 : 1 }],
          },
        ]}
        onPress={onAddPerson}
      >
        <Icon name="plus" size={26} color={theme.colors.onAccent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerSlot: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  bannerText: { flex: 1, color: "#fff", fontSize: 13, lineHeight: 18, fontWeight: "500" },
  list: { paddingTop: 4 },
  emptyContainer: { flexGrow: 1, justifyContent: "center", padding: 32 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 82 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10 },
  rowText: { flex: 1, marginLeft: 14 },
  rowTopLine: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  rowTitle: { fontSize: 16.5, fontWeight: "600", flexShrink: 1, letterSpacing: -0.2 },
  rowStamp: { fontSize: 12 },
  rowBottomLine: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  previewTick: { marginRight: 4 },
  previewIcon: { marginRight: 4 },
  rowPreview: { flex: 1, fontSize: 14.5, lineHeight: 19 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  badgeText: { fontSize: 12.5, fontWeight: "700" },
  empty: { alignItems: "center" },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  emptyTitle: { fontSize: 20, fontWeight: "700", marginBottom: 8, letterSpacing: -0.3 },
  emptyText: { fontSize: 14.5, textAlign: "center", lineHeight: 21 },
  emptyButton: { marginTop: 22, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 26 },
  emptyButtonText: { fontSize: 15.5, fontWeight: "600" },
  fab: {
    position: "absolute",
    right: 18,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});
