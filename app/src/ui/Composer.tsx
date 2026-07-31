import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { Icon, type IconName } from "./Icon";

/** Через столько после последнего нажатия клавиши сообщаем «перестал печатать». */
const TYPING_IDLE_MS = 3000;

/**
 * Строка ввода со шторкой вложений и записью голоса.
 *
 * Вынесена из экрана чата намеренно: черновик, открытая шторка и состояние
 * записи меняются очень часто, а раньше они жили в состоянии экрана — и каждое
 * нажатие клавиши перерисовывало шапку, обои и весь список сообщений. Отсюда
 * были заметные подлагивания при наборе. Теперь это состояние не выходит за
 * пределы строки ввода.
 */
function ComposerBase({
  bottomInset,
  onSendText,
  onTyping,
  onPickImage,
  onPickFile,
  onShareLocation,
  onVoiceRecorded,
}: {
  /** Отступ снизу под панель навигации: под клавиатурой он не нужен. */
  bottomInset: number;
  onSendText: (text: string) => void | Promise<void>;
  onTyping: (isTyping: boolean) => void;
  onPickImage: () => void | Promise<void>;
  onPickFile: () => void | Promise<void>;
  onShareLocation: () => void | Promise<void>;
  onVoiceRecorded: (uri: string, durationMs: number) => void | Promise<void>;
}): React.ReactElement {
  const theme = useTheme();
  const [draft, setDraft] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  useEffect(
    () => () => {
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    },
    [],
  );

  const handleDraftChange = useCallback(
    (value: string) => {
      setDraft(value);
      onTyping(true);
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
      typingStopTimer.current = setTimeout(() => onTyping(false), TYPING_IDLE_MS);
    },
    [onTyping],
  );

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    // Черновик очищаем сразу: ждать ответа сервера незачем — сообщение
    // ложится в локальную БД и очередь отправки мгновенно.
    setDraft("");
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    onTyping(false);
    void onSendText(text);
  }, [draft, onSendText, onTyping]);

  const runAttach = useCallback((action: () => void | Promise<void>) => {
    setAttachOpen(false);
    void action();
  }, []);

  const handleStartRecording = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Нет доступа к микрофону", "Разрешите доступ в настройках устройства.");
      return;
    }
    await setAudioModeAsync({ allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }, [recorder]);

  const handleStopRecording = useCallback(async () => {
    if (!recorderState.isRecording) return;
    const durationMs = recorderState.durationMillis;
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;
    void onVoiceRecorded(uri, durationMs);
  }, [onVoiceRecorded, recorder, recorderState.durationMillis, recorderState.isRecording]);

  const hasDraft = draft.trim().length > 0;
  const attachActions: { icon: IconName; label: string; onPress: () => void | Promise<void> }[] = [
    { icon: "image", label: "Фото", onPress: onPickImage },
    { icon: "file", label: "Файл", onPress: onPickFile },
    { icon: "pin", label: "Я тут", onPress: onShareLocation },
  ];

  return (
    <>
      {attachOpen && (
        <View
          style={[styles.attachSheet, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.divider }]}
        >
          {attachActions.map((action) => (
            <Pressable
              key={action.label}
              style={({ pressed }) => [styles.attachAction, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => runAttach(action.onPress)}
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
            paddingBottom: 8 + bottomInset,
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.divider,
          },
        ]}
      >
        <View style={[styles.inputPill, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
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
            onPress={handleSend}
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
    </>
  );
}

/**
 * Мемо: внутри TextInput, и лишние перерисовки при каждом входящем сообщении
 * ему ни к чему. Обработчики из экрана чата стабильны, поэтому сравнение по
 * ссылкам здесь действительно работает.
 */
export const Composer = React.memo(ComposerBase);

const styles = StyleSheet.create({
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
