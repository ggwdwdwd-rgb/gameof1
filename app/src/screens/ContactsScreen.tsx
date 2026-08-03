import * as Clipboard from "expo-clipboard";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dmChatId } from "../chat/chatId";
import { useApp, type FoundUser } from "../context/AppContext";
import { contactTitle } from "../db/contacts";
import { useTheme } from "../theme/ThemeContext";
import { Avatar } from "../ui/Avatar";
import { Header } from "../ui/Header";
import { Icon } from "../ui/Icon";
import { RenameModal } from "../ui/RenameModal";
import { Toast, useToast } from "../ui/Toast";
import { DURATION, useAppear } from "../ui/motion";

/**
 * Контакты: свой @тег, поиск людей и список тех, кто уже добавлен.
 *
 * Общего списка участников в системе нет — сервер его не отдаёт (см.
 * ARCHITECTURE.md §2.6). Поэтому человека нужно найти самому: по тегу, почте или
 * телефону, и только точным совпадением. Поиск по части тега позволил бы
 * собрать всех участников сервера, а этого быть не должно.
 */
export function ContactsScreen({
  onBack,
  onOpenChat,
}: {
  onBack: () => void;
  onOpenChat: (chatId: string, title: string, userId: string) => void;
}): React.ReactElement {
  const { identity, contacts, username, presence, findUser, addContact, changeUsername } = useApp();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { toast, showToast, hideToast } = useToast();

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  /** undefined — ещё не искали, null — искали и не нашли. */
  const [found, setFound] = useState<FoundUser | null | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [editingTag, setEditingTag] = useState(false);

  const search = useCallback(async () => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    setSearching(true);
    setFound(undefined);
    try {
      setFound(await findUser(trimmed));
    } finally {
      setSearching(false);
    }
  }, [findUser, query]);

  const add = useCallback(
    async (user: FoundUser) => {
      setAdding(true);
      try {
        const result = await addContact(user);
        if (!result.ok) {
          showToast(result.detail, "alert");
          return;
        }
        showToast(`${user.displayName} добавлен`, "check");
        setFound(undefined);
        setQuery("");
      } finally {
        setAdding(false);
      }
    },
    [addContact, showToast],
  );

  const alreadyAdded = found ? contacts.some((c) => c.userId === found.userId) : false;
  const resultAppear = useAppear(found !== undefined, DURATION.normal);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header title="Контакты" onBack={onBack} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
        {/* Свой тег — первым делом: чтобы его дать другому, его надо видеть. */}
        <Pressable
          style={({ pressed }) => [
            styles.myTag,
            {
              backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}
          onPress={() => {
            if (username === null) {
              setEditingTag(true);
              return;
            }
            void Clipboard.setStringAsync(`@${username}`);
            showToast("Тег скопирован", "copy");
          }}
          onLongPress={() => setEditingTag(true)}
        >
          <Avatar name={identity.displayName} seed={identity.userId} size={46} />
          <View style={styles.myTagText}>
            <Text style={[styles.myTagValue, { color: theme.colors.textPrimary }]}>
              {username === null ? "Тег не задан" : `@${username}`}
            </Text>
            <Text style={[styles.myTagHint, { color: theme.colors.textMuted }]}>
              {username === null ? "Нажмите, чтобы задать" : "Нажмите, чтобы скопировать · удержание — сменить"}
            </Text>
          </View>
          <Icon name={username === null ? "edit" : "copy"} size={19} color={theme.colors.textMuted} />
        </Pressable>

        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>НАЙТИ ЧЕЛОВЕКА</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={[
              styles.searchInput,
              {
                color: theme.colors.textPrimary,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
              },
            ]}
            value={query}
            onChangeText={setQuery}
            placeholder="@тег, почта или телефон"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void search()}
            editable={!searching}
          />
          <Pressable
            style={({ pressed }) => [
              styles.searchButton,
              { backgroundColor: theme.colors.accent, opacity: pressed || searching ? 0.85 : 1 },
            ]}
            onPress={() => void search()}
            disabled={searching}
          >
            {searching ? (
              <ActivityIndicator color={theme.colors.onAccent} />
            ) : (
              <Icon name="send" size={20} color={theme.colors.onAccent} />
            )}
          </Pressable>
        </View>
        <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
          Нужно точное совпадение: по части тега поиск ничего не найдёт. Так участники сервера остаются невидимыми для
          посторонних.
        </Text>

        {found === null && (
          <View style={{ opacity: resultAppear }}>
            <Text style={[styles.notFound, { color: theme.colors.textSecondary }]}>
              Никого не нашли. Проверьте тег — он должен совпадать полностью.
            </Text>
          </View>
        )}

        {found !== null && found !== undefined && (
          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: resultAppear },
            ]}
          >
            <Avatar name={found.displayName} seed={found.userId} size={48} />
            <View style={styles.cardText}>
              <Text style={[styles.cardName, { color: theme.colors.textPrimary }]}>{found.displayName}</Text>
              {found.username !== null && (
                <Text style={[styles.cardTag, { color: theme.colors.textMuted }]}>@{found.username}</Text>
              )}
            </View>
            {alreadyAdded ? (
              <Text style={[styles.addedMark, { color: theme.colors.textMuted }]}>уже добавлен</Text>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.addButton,
                  { backgroundColor: theme.colors.accent, opacity: pressed || adding ? 0.85 : 1 },
                ]}
                onPress={() => void add(found)}
                disabled={adding}
              >
                {adding ? (
                  <ActivityIndicator color={theme.colors.onAccent} />
                ) : (
                  <Text style={[styles.addButtonText, { color: theme.colors.onAccent }]}>Добавить</Text>
                )}
              </Pressable>
            )}
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>{`МОИ КОНТАКТЫ · ${contacts.length}`}</Text>
        <View style={[styles.list, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          {contacts.length === 0 ? (
            <Text style={[styles.empty, { color: theme.colors.textMuted }]}>
              Пока никого. Найдите человека по тегу — или он найдёт вас и напишет первым.
            </Text>
          ) : (
            contacts.map((contact, index) => (
              <Pressable
                key={contact.userId}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
                  pressed && { backgroundColor: theme.colors.surfacePressed },
                ]}
                onPress={() => onOpenChat(dmChatId(identity.userId, contact.userId), contactTitle(contact), contact.userId)}
              >
                <Avatar
                  name={contactTitle(contact)}
                  seed={contact.userId}
                  size={42}
                  online={!contact.isRevoked && presence.get(contact.userId)?.online === true}
                  ringColor={theme.colors.surface}
                />
                <View style={styles.rowText}>
                  <Text style={[styles.rowName, { color: theme.colors.textPrimary }]}>{contactTitle(contact)}</Text>
                  <Text style={[styles.rowTag, { color: theme.colors.textMuted }]}>
                    {contact.isRevoked
                      ? "доступ устройства отозван"
                      : contact.username !== null
                        ? `@${contact.username}`
                        : contact.fingerprint}
                  </Text>
                </View>
                {/* Иконка «назад», повёрнутая: отдельной «вперёд» в наборе нет,
                    а рисовать почти такую же ради поворота незачем. */}
                <View style={styles.chevron}>
                  <Icon name="back" size={17} color={theme.colors.textMuted} />
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>

      <RenameModal
        visible={editingTag}
        title="Свой тег"
        hint="Латиница, цифры и подчёркивание, от 3 до 24 символов. По тегу вас находят другие."
        initialValue={username ?? ""}
        placeholder="anna_k"
        onCancel={() => setEditingTag(false)}
        onSubmit={(value) => {
          setEditingTag(false);
          void (async () => {
            const result = await changeUsername(value);
            showToast(result.ok ? "Тег сохранён" : result.detail, result.ok ? "check" : "alert");
          })();
        }}
      />

      <Toast state={toast} onHide={hideToast} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16 },
  myTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  myTagText: { flex: 1 },
  myTagValue: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
  myTagHint: { fontSize: 12, marginTop: 3 },
  sectionTitle: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.8, marginTop: 24, marginBottom: 9, marginLeft: 6 },
  searchRow: { flexDirection: "row", gap: 9 },
  searchInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  searchButton: { width: 50, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 9, marginLeft: 4 },
  notFound: { fontSize: 13.5, lineHeight: 19, marginTop: 14, marginLeft: 4 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    marginTop: 14,
  },
  cardText: { flex: 1 },
  cardName: { fontSize: 16.5, fontWeight: "600" },
  cardTag: { fontSize: 13, marginTop: 2 },
  addButton: { borderRadius: 11, paddingHorizontal: 16, paddingVertical: 10, minWidth: 96, alignItems: "center" },
  addButtonText: { fontSize: 14.5, fontWeight: "600" },
  addedMark: { fontSize: 13 },
  list: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  empty: { fontSize: 13, lineHeight: 19, padding: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 14, paddingVertical: 12 },
  rowText: { flex: 1 },
  rowName: { fontSize: 15.5, fontWeight: "600" },
  rowTag: { fontSize: 12.5, marginTop: 2 },
  chevron: { transform: [{ rotate: "180deg" }] },
});
