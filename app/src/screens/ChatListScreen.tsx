import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dmChatId } from "../chat/chatId";
import { useApp } from "../context/AppContext";
import { getLastMessageForChat, type LocalMessage } from "../db/messages";
import { useTheme } from "../theme/ThemeContext";
import { Avatar } from "../ui/Avatar";
import { Header } from "../ui/Header";

interface ChatRow {
  chatId: string;
  userId: string;
  title: string;
  preview: string;
  ts: number;
}

const MEDIA_PREVIEWS: Record<string, string> = {
  image: "Фото",
  voice: "Голосовое сообщение",
  file: "Файл",
  location: "Геолокация",
};

const STATE_LABELS: Record<string, string> = {
  idle: "нет соединения",
  connecting: "подключение…",
  reconnecting: "переподключение…",
  connected: "на связи",
};

function previewText(message: LocalMessage | null): string {
  if (!message) return "Нет сообщений";
  if (message.deletedAt) return "Сообщение удалено";
  if (message.contentType === "text") return message.plaintext ?? "…";
  return MEDIA_PREVIEWS[message.contentType] ?? "Вложение";
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const date = new Date(ts);
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  if (sameDay) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
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
  const { identity, connectionState, contacts, chatEvents } = useApp();
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
          return {
            chatId,
            userId: contact.userId,
            title: contact.displayName,
            preview: previewText(last),
            ts: last?.createdAt ?? 0,
          };
        }),
    );
    setRows(contactRows.sort((a, b) => b.ts - a.ts));
  }, [contacts, identity.userId]);

  useEffect(() => {
    void refresh();
    const off = chatEvents.on("messageInserted", () => void refresh());
    return off;
  }, [refresh, chatEvents]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Cry"
        subtitle={STATE_LABELS[connectionState] ?? connectionState}
        left={<View />}
        right={
          <Pressable onPress={onOpenSettings} hitSlop={12} style={styles.headerButton}>
            <Text style={[styles.headerIcon, { color: theme.colors.textSecondary }]}>⚙︎</Text>
          </Pressable>
        }
      />

      <FlatList
        data={rows}
        keyExtractor={(row) => row.chatId}
        contentContainerStyle={[
          rows.length === 0 ? styles.emptyContainer : styles.list,
          // Кнопка «+» и панель навигации не должны перекрывать последний чат.
          { paddingBottom: insets.bottom + 96 },
        ]}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
            onPress={() => onOpenChat(item.chatId, item.title, item.userId)}
          >
            <Avatar name={item.title} seed={item.userId} />
            <View style={styles.rowText}>
              <View style={styles.rowTitleLine}>
                <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.rowTime, { color: theme.colors.textMuted }]}>{formatTime(item.ts)}</Text>
              </View>
              <Text style={[styles.rowPreview, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                {item.preview}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>Пока никого нет</Text>
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
              Нажмите «+», чтобы создать код приглашения и добавить человека.
            </Text>
          </View>
        }
      />

      <Pressable
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + 24, backgroundColor: theme.colors.accent, opacity: pressed ? 0.85 : 1 },
        ]}
        onPress={onAddPerson}
      >
        <Text style={[styles.fabText, { color: theme.colors.onAccent }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerIcon: { fontSize: 20 },
  list: { padding: 12, gap: 8 },
  emptyContainer: { flexGrow: 1, justifyContent: "center", padding: 32 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, marginLeft: 12 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowTitle: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  rowTime: { fontSize: 12 },
  rowPreview: { fontSize: 14, marginTop: 3 },
  empty: { alignItems: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  fab: {
    position: "absolute",
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: { fontSize: 30, fontWeight: "300", marginTop: -3 },
});
