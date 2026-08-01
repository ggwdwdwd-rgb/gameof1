import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { Icon, type IconName } from "./Icon";
import { DURATION, useTransition, usePulse } from "./motion";

/** Через столько после последнего нажатия клавиши сообщаем «перестал печатать». */
const TYPING_IDLE_MS = 3000;

/**
 * Аудиосессию переключаем только на iOS.
 *
 * allowsRecording в expo-audio помечен @platform ios — на Android этого поля в
 * нативной записи вообще нет. Зато сам вызов setAudioModeAsync на Android
 * выполняет audioManager.setSpeakerphoneOn(...), а это устаревший способ
 * управления маршрутизацией, который на части устройств уводит звук из
 * основного динамика. То есть на Android вызов не даёт ничего полезного и при
 * этом способен сломать воспроизведение записанных голосовых — ровно то, что и
 * происходило: записать получалось, а послушать нет.
 */
async function enterRecordingMode(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await setAudioModeAsync({ allowsRecording: true });
}

/** Возврат к обычному воспроизведению: иначе звук идёт в динамик у уха. */
async function leaveRecordingMode(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
}

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

  // Пульсация кнопки записи: 1 → 1.12 и обратно, пока идёт запись.
  const pulse = usePulse(recorderState.isRecording);
  const recordScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  /** Шторка вложений: выезжает и уезжает, а не мигает. */
  const attachProgress = useTransition(attachOpen, DURATION.fast);
  // Со сцены снимаем не сразу, иначе анимации закрытия не видно вовсе.
  const [attachMounted, setAttachMounted] = useState(false);
  useEffect(() => {
    if (attachOpen) {
      setAttachMounted(true);
      return;
    }
    const timer = setTimeout(() => setAttachMounted(false), DURATION.fast);
    return () => clearTimeout(timer);
  }, [attachOpen]);

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

  /**
   * Запись включается и выключается нажатием, а не удержанием.
   *
   * С удержанием она не работала вовсе: системный диалог разрешения забирал
   * фокус, палец «отпускался», onPressOut срабатывал сразу — и остановка
   * приходила раньше старта. Плюс нажатие честнее: держать палец минуту,
   * записывая длинное сообщение, неудобно.
   */
  const handleToggleRecording = useCallback(async () => {
    // try обязателен вокруг всего: раньше он покрывал только запуск записи, а
    // запрос разрешения и остановка были снаружи. Их исключение уходило в
    // unhandled rejection — по нажатию кнопки не происходило вообще ничего, и
    // выглядело это как «не запрашивает доступ и не записывает».
    try {
      if (recorderState.isRecording) {
        const durationMs = recorderState.durationMillis;
        await recorder.stop();
        await leaveRecordingMode();
        const uri = recorder.uri;
        if (!uri) {
          Alert.alert("Запись не получилась", "Файл не создан — попробуйте записать ещё раз.");
          return;
        }
        void onVoiceRecorded(uri, durationMs);
        return;
      }

      // Сначала спрашиваем текущее состояние: если разрешение уже отозвано
      // навсегда, системный диалог не появится, и об этом нужно сказать прямо,
      // а не молчать после нажатия.
      const current = await getRecordingPermissionsAsync();
      const permission = current.granted ? current : await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        // Android показывает системный диалог не больше двух раз. Дальше запрос
        // отклоняется молча, и «разрешите в настройках» превращается в тупик —
        // поэтому уводим прямо в настройки приложения.
        if (permission.canAskAgain) {
          Alert.alert("Нет доступа к микрофону", "Без доступа записать голосовое нельзя.");
        } else {
          Alert.alert(
            "Нет доступа к микрофону",
            "Android больше не будет спрашивать разрешение — его нужно включить вручную: Настройки → Приложения → Cry → Разрешения → Микрофон.",
            [
              { text: "Отмена", style: "cancel" },
              { text: "Открыть настройки", onPress: () => void Linking.openSettings() },
            ],
          );
        }
        return;
      }

      await enterRecordingMode();
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (error) {
      // Текст ошибки показываем как есть: иначе непонятно, дело в разрешении,
      // в занятом микрофоне или в чём-то ещё.
      Alert.alert("Голосовое не записалось", error instanceof Error ? error.message : String(error));
    }
  }, [onVoiceRecorded, recorder, recorderState.durationMillis, recorderState.isRecording]);

  const hasDraft = draft.trim().length > 0;
  const attachActions: { icon: IconName; label: string; onPress: () => void | Promise<void> }[] = [
    { icon: "image", label: "Фото", onPress: onPickImage },
    { icon: "file", label: "Файл", onPress: onPickFile },
    { icon: "pin", label: "Я тут", onPress: onShareLocation },
  ];

  return (
    <>
      {attachMounted && (
        <Animated.View
          style={[
            styles.attachSheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.divider,
              opacity: attachProgress,
              transform: [
                { translateY: attachProgress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
              ],
            },
          ]}
        >
          {attachActions.map((action) => (
            <Pressable
              key={action.label}
              style={({ pressed }) => [
                styles.attachAction,
                { opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] },
              ]}
              onPress={() => runAttach(action.onPress)}
            >
              <View style={[styles.attachIconCircle, { backgroundColor: theme.colors.accentSoft }]}>
                <Icon name={action.icon} size={24} color={theme.colors.accent} />
              </View>
              <Text style={[styles.attachLabel, { color: theme.colors.textSecondary }]}>{action.label}</Text>
            </Pressable>
          ))}
        </Animated.View>
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
            {/* Плюс поворачивается в крестик, а не подменяется другой иконкой:
                так видно, что это одна и та же кнопка. */}
            <Animated.View
              style={{
                transform: [
                  { rotate: attachProgress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "45deg"] }) },
                ],
              }}
            >
              <Icon name="plus" size={22} color={attachOpen ? theme.colors.accent : theme.colors.textMuted} />
            </Animated.View>
          </Pressable>
          <TextInput
            style={[styles.input, { color: theme.colors.textPrimary }]}
            value={draft}
            onChangeText={handleDraftChange}
            placeholder={
              recorderState.isRecording
                ? `Записываю… ${Math.floor(recorderState.durationMillis / 1000)} с — нажмите ✓`
                : "Сообщение"
            }
            placeholderTextColor={theme.colors.textMuted}
            multiline
            editable={!recorderState.isRecording}
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
          <Pressable onPress={() => void handleToggleRecording()}>
            {({ pressed }) => (
              <Animated.View
                style={[
                  styles.sendButton,
                  {
                    backgroundColor: recorderState.isRecording ? theme.colors.danger : theme.colors.accent,
                    // Во время записи кнопка «дышит» — видно, что запись идёт,
                    // даже не читая подсказку в поле ввода.
                    transform: [{ scale: Animated.multiply(recordScale, pressed ? 0.92 : 1) }],
                  },
                ]}
              >
                <Icon name={recorderState.isRecording ? "check" : "mic"} size={21} color={theme.colors.onAccent} />
              </Animated.View>
            )}
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
