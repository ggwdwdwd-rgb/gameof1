import React, { useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { isGroupChat } from "../chat/chatId";
import { useApp } from "../context/AppContext";
import { listMessagesForChat, type LocalMessage } from "../db/messages";

const STATUS_LABELS: Record<string, string> = {
  pending: "…",
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
  failed: "!",
};

export function ChatScreen({
  chatId,
  title,
  onBack,
}: {
  chatId: string;
  title: string;
  onBack: () => void;
}): React.ReactElement {
  const { identity, contacts, chatEvents, sendText, markRead } = useApp();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const listRef = useRef<FlatList<LocalMessage>>(null);

  useEffect(() => {
    let mounted = true;

    async function refresh(): Promise<void> {
      const rows = await listMessagesForChat(chatId);
      if (!mounted) return;
      setMessages(rows);
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
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeStatus();
    };
  }, [chatId, chatEvents, identity.userId, markRead]);

  function displayNameFor(userId: string): string {
    if (userId === identity.userId) return "Вы";
    return contacts.find((c) => c.userId === userId)?.displayName ?? "…";
  }

  async function handleSend(): Promise<void> {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendText(chatId, text);
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
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        ref={listRef}
        data={messages.filter((m) => !m.deletedAt)}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const mine = item.fromUserId === identity.userId;
          return (
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
              {!mine && isGroupChat(chatId) && <Text style={styles.sender}>{displayNameFor(item.fromUserId)}</Text>}
              <Text style={styles.bubbleText}>{item.plaintext ?? "[не удалось расшифровать]"}</Text>
              {mine && <Text style={styles.status}>{STATUS_LABELS[item.status] ?? ""}</Text>}
            </View>
          );
        }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Сообщение…"
          multiline
        />
        <Pressable style={styles.sendButton} onPress={() => void handleSend()}>
          <Text style={styles.sendButtonText}>→</Text>
        </Pressable>
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
  list: { padding: 12, gap: 6 },
  bubble: { maxWidth: "80%", borderRadius: 12, padding: 10, marginVertical: 3 },
  bubbleMine: { backgroundColor: "#dcf3e4", alignSelf: "flex-end" },
  bubbleTheirs: { backgroundColor: "#fff", alignSelf: "flex-start" },
  sender: { fontSize: 12, fontWeight: "700", color: "#2f6f4f", marginBottom: 2 },
  bubbleText: { fontSize: 16 },
  status: { fontSize: 11, color: "#888", textAlign: "right", marginTop: 2 },
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
  sendButtonText: { color: "#fff", fontSize: 20, fontWeight: "700" },
});
