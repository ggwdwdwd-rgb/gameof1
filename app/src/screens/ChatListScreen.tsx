import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { GROUP_CHAT_ID, dmChatId } from "../chat/chatId";
import { useApp } from "../context/AppContext";
import { getLastMessageForChat, type LocalMessage } from "../db/messages";

interface ChatRow {
  chatId: string;
  title: string;
  preview: string;
  ts: number;
}

const STATE_LABELS: Record<string, string> = {
  idle: "Не подключено",
  connecting: "Подключение…",
  reconnecting: "Переподключение…",
  connected: "В сети",
};

const MEDIA_PREVIEWS: Record<string, string> = {
  image: "📷 Фото",
  voice: "🎤 Голосовое",
  file: "📎 Файл",
  location: "📍 Геолокация",
};

function previewText(message: LocalMessage | null): string {
  if (!message) return "Нет сообщений";
  if (message.deletedAt) return "Сообщение удалено";
  if (message.contentType === "text") return message.plaintext ?? "…";
  return MEDIA_PREVIEWS[message.contentType] ?? "[вложение]";
}

export function ChatListScreen({ onOpenChat }: { onOpenChat: (chatId: string, title: string) => void }): React.ReactElement {
  const { identity, connectionState, contacts, chatEvents } = useApp();
  const [rows, setRows] = useState<ChatRow[]>([]);

  const refresh = useCallback(async () => {
    const groupLast = await getLastMessageForChat(GROUP_CHAT_ID);
    const groupRow: ChatRow = {
      chatId: GROUP_CHAT_ID,
      title: "Семья",
      preview: previewText(groupLast),
      ts: groupLast?.createdAt ?? 0,
    };

    const contactRows = await Promise.all(
      contacts
        .filter((c) => !c.isRevoked)
        .map(async (contact) => {
          const chatId = dmChatId(identity.userId, contact.userId);
          const last = await getLastMessageForChat(chatId);
          return { chatId, title: contact.displayName, preview: previewText(last), ts: last?.createdAt ?? 0 };
        }),
    );

    setRows([groupRow, ...contactRows].sort((a, b) => b.ts - a.ts));
  }, [contacts, identity.userId]);

  useEffect(() => {
    void refresh();
    return chatEvents.on("messageInserted", () => void refresh());
  }, [refresh, chatEvents]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Чаты</Text>
        <Text style={styles.headerState}>{STATE_LABELS[connectionState] ?? connectionState}</Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.chatId}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onOpenChat(item.chatId, item.title)}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.title.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowPreview} numberOfLines={1}>
                {item.preview}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Пока никого нет в семье</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerTitle: { fontSize: 24, fontWeight: "700" },
  headerState: { fontSize: 12, color: "#888" },
  row: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#2f6f4f",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 18 },
  rowText: { flex: 1, marginLeft: 12 },
  rowTitle: { fontSize: 16, fontWeight: "600" },
  rowPreview: { fontSize: 14, color: "#777", marginTop: 2 },
  empty: { textAlign: "center", marginTop: 40, color: "#999" },
});
