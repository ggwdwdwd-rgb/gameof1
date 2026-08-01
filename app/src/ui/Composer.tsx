import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import type { Theme } from "../theme/theme";
import { Icon, type IconName } from "./Icon";
import { DURATION, useTransition, usePulse } from "./motion";

/** Через столько после последнего нажатия клавиши сообщаем «перестал печатать». */
const TYPING_IDLE_MS = 3000;

/** Смахивание влево дальше этого расстояния отменяет запись. */
const CANCEL_DISTANCE = 90;

/**
 * Короче этого запись не отправляем.
 *
 * Иначе случайное касание кнопки микрофона улетало бы в чат обрывком в
 * полсекунды. Вместо отправки показываем подсказку, что кнопку надо держать.
 */
const MIN_RECORD_MS = 700;

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
  onNotice,
}: {
  /** Отступ снизу под панель навигации: под клавиатурой он не нужен. */
  bottomInset: number;
  onSendText: (text: string) => void | Promise<void>;
  onTyping: (isTyping: boolean) => void;
  onPickImage: () => void | Promise<void>;
  onPickFile: () => void | Promise<void>;
  onShareLocation: () => void | Promise<void>;
  onVoiceRecorded: (uri: string, durationMs: number) => void | Promise<void>;
  /** Короткое сообщение экрану: «отменено», «удерживайте кнопку». */
  onNotice: (text: string, icon?: IconName) => void;
}): React.ReactElement {
  const theme = useTheme();
  const [draft, setDraft] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  /** Идёт запись — влияет только на вид, решения принимаются по рефам. */
  const [recording, setRecording] = useState(false);
  /** Палец ушёл влево дальше порога: отпускание отменит запись. */
  const [cancelArmed, setCancelArmed] = useState(false);
  /**
   * Рефы, а не состояние: обработчики жеста создаются один раз и до
   * актуального состояния React не дотягиваются — они видели бы значения
   * момента создания.
   */
  const holdingRef = useRef(false);
  const cancelRef = useRef(false);
  const startingRef = useRef(false);
  const startedAtRef = useRef(0);
  /** Сдвиг панели записи вслед за пальцем. */
  const slide = useRef(new Animated.Value(0)).current;

  // Пульсация кнопки записи: 1 → 1.12 и обратно, пока идёт запись.
  const pulse = usePulse(recording);
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
      // Уходя с экрана с зажатой кнопкой, запись надо оборвать: иначе рекордер
      // остаётся включённым и держит микрофон уже после закрытия чата.
      holdingRef.current = false;
      if (recorder.isRecording) {
        void recorder.stop().then(leaveRecordingMode);
      }
    },
    [recorder],
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

  /** Разрешение спрашиваем один раз за сеанс, а не на каждое удержание. */
  const ensureMicPermission = useCallback(async (): Promise<boolean> => {
    const current = await getRecordingPermissionsAsync();
    if (current.granted) return true;
    const permission = await requestRecordingPermissionsAsync();
    if (permission.granted) return true;

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
    return false;
  }, []);

  /**
   * Запуск записи по удержанию.
   *
   * Между нажатием и реальным стартом проходит заметное время: запрос
   * разрешения, подготовка рекордера. Палец за это время могут отпустить,
   * поэтому после каждого await сверяемся с holdingRef — иначе запись
   * начиналась бы уже после того, как её отменили, и оставалась бы висеть.
   */
  const beginRecording = useCallback(async () => {
    startingRef.current = true;
    let denied = false;
    try {
      denied = !(await ensureMicPermission());
      if (denied || !holdingRef.current) return;

      await enterRecordingMode();
      await recorder.prepareToRecordAsync();
      if (!holdingRef.current) return;

      recorder.record();
      startedAtRef.current = Date.now();
      setRecording(true);
    } catch (error) {
      // Текст ошибки показываем как есть: иначе непонятно, дело в разрешении,
      // в занятом микрофоне или в чём-то ещё.
      Alert.alert("Голосовое не записалось", error instanceof Error ? error.message : String(error));
    } finally {
      startingRef.current = false;
      // Пока шла подготовка, палец могли отпустить. Обработчик отпускания об
      // этой записи ещё не знал (startingRef был поднят), поэтому доводим дело
      // до конца здесь.
      if (!holdingRef.current) {
        if (recorder.isRecording) {
          await recorder.stop();
          await leaveRecordingMode();
          setRecording(false);
        }
        // Отказ в разрешении уже объяснён диалогом — второй подсказки не надо.
        if (!denied) onNotice("Удерживайте кнопку, чтобы записать", "mic");
      }
    }
  }, [ensureMicPermission, onNotice, recorder]);

  /** Отпустили палец: отправляем или выбрасываем запись. */
  const finishRecording = useCallback(
    async (cancelled: boolean) => {
      // Старт ещё не завершился — beginRecording сам увидит, что holdingRef
      // сброшен, и остановит запись. Второй раз останавливать нельзя.
      if (startingRef.current) return;
      if (!recorder.isRecording) return;

      const durationMs = Date.now() - startedAtRef.current;
      try {
        await recorder.stop();
        await leaveRecordingMode();
      } finally {
        setRecording(false);
      }

      if (cancelled) {
        onNotice("Запись отменена", "trash");
        return;
      }
      if (durationMs < MIN_RECORD_MS) {
        onNotice("Удерживайте кнопку, чтобы записать", "mic");
        return;
      }
      const uri = recorder.uri;
      if (!uri) {
        Alert.alert("Запись не получилась", "Файл не создан — попробуйте записать ещё раз.");
        return;
      }
      void onVoiceRecorded(uri, durationMs);
    },
    [onNotice, onVoiceRecorded, recorder],
  );

  /**
   * Жест удержания. PanResponder, а не onPressIn/onPressOut у Pressable:
   * нужен ещё и сдвиг пальца, чтобы отменить запись смахиванием влево, как в
   * привычных мессенджерах.
   */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Жест не отдаём списку сообщений: иначе смахивание влево уехало бы в
        // прокрутку, а запись осталась бы висеть.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          holdingRef.current = true;
          cancelRef.current = false;
          setCancelArmed(false);
          slide.setValue(0);
          void beginRecording();
        },
        onPanResponderMove: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
          const shift = Math.min(0, gesture.dx);
          slide.setValue(shift);
          const armed = shift <= -CANCEL_DISTANCE;
          if (armed !== cancelRef.current) {
            cancelRef.current = armed;
            setCancelArmed(armed);
          }
        },
        onPanResponderRelease: () => {
          holdingRef.current = false;
          const cancelled = cancelRef.current;
          // Признак отмены обязательно сбрасываем здесь же. Без этого кнопка
          // навсегда оставалась красной мусоркой, а следующая запись
          // начиналась уже «готовой к отмене» и выбрасывалась при отпускании.
          cancelRef.current = false;
          setCancelArmed(false);
          Animated.timing(slide, { toValue: 0, duration: DURATION.fast, useNativeDriver: true }).start();
          void finishRecording(cancelled);
        },
        // Жест перехватила система (звонок, шторка) — это отмена, а не отправка.
        onPanResponderTerminate: () => {
          holdingRef.current = false;
          cancelRef.current = false;
          setCancelArmed(false);
          slide.setValue(0);
          void finishRecording(true);
        },
      }),
    [beginRecording, finishRecording, slide],
  );

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
        {recording ? (
          <RecordingBar
            durationMs={recorderState.durationMillis}
            cancelArmed={cancelArmed}
            slide={slide}
            theme={theme}
          />
        ) : (
          <View
            style={[styles.inputPill, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}
          >
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
              placeholder="Сообщение"
              placeholderTextColor={theme.colors.textMuted}
              multiline
            />
          </View>
        )}

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
          // Кнопка микрофона: удержание записывает, смахивание влево отменяет.
          <Animated.View
            {...panResponder.panHandlers}
            style={[
              styles.sendButton,
              {
                backgroundColor: cancelArmed ? theme.colors.danger : theme.colors.accent,
                transform: [
                  { scale: recording ? recordScale : 1 },
                  // Кнопка едет за пальцем, но вдвое медленнее — так видно, что
                  // жест поймали, и палец при этом не убегает от кнопки.
                  { translateX: Animated.multiply(slide, 0.5) },
                ],
              },
            ]}
          >
            <Icon name={cancelArmed ? "trash" : "mic"} size={21} color={theme.colors.onAccent} />
          </Animated.View>
        )}
      </View>
    </>
  );
}

/** Секунды в 0:07. */
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Панель на месте поля ввода, пока идёт запись.
 *
 * Заменяет собой строку ввода, а не подписывается снизу: во время записи
 * писать всё равно нельзя, а свободное место нужно под таймер и подсказку про
 * отмену.
 */
function RecordingBar({
  durationMs,
  cancelArmed,
  slide,
  theme,
}: {
  durationMs: number;
  cancelArmed: boolean;
  slide: Animated.Value;
  theme: Theme;
}): React.ReactElement {
  // Красная точка мигает — тот же язык, что у любого индикатора записи.
  const blink = usePulse(true);

  return (
    <Animated.View
      style={[
        styles.inputPill,
        styles.recordingPill,
        {
          backgroundColor: theme.colors.background,
          borderColor: cancelArmed ? theme.colors.danger : theme.colors.border,
          // Вся панель тоже смещается за пальцем — жест ощущается цельным.
          transform: [{ translateX: Animated.multiply(slide, 0.35) }],
        },
      ]}
    >
      <Animated.View style={[styles.recordingDot, { backgroundColor: theme.colors.danger, opacity: blink }]} />
      <Text style={[styles.recordingTime, { color: theme.colors.textPrimary }]}>{formatDuration(durationMs)}</Text>
      {cancelArmed ? (
        <View style={styles.recordingCancel}>
          <Icon name="trash" size={17} color={theme.colors.danger} />
          <Text style={[styles.recordingHint, { color: theme.colors.danger }]} numberOfLines={1}>
            Отпустите — не отправится
          </Text>
        </View>
      ) : (
        // Подсказка тает по мере сдвига: к порогу отмены она уже не нужна,
        // а её место занимает мусорка.
        <Animated.Text
          style={[
            styles.recordingHint,
            {
              color: theme.colors.textMuted,
              opacity: slide.interpolate({
                inputRange: [-CANCEL_DISTANCE, 0],
                outputRange: [0.15, 1],
                extrapolate: "clamp",
              }),
            },
          ]}
          numberOfLines={1}
        >
          ‹ смахните влево, чтобы отменить
        </Animated.Text>
      )}
    </Animated.View>
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
  recordingPill: { alignItems: "center", gap: 9, paddingLeft: 14, paddingVertical: 11 },
  recordingDot: { width: 9, height: 9, borderRadius: 5 },
  recordingTime: { fontSize: 15.5, fontWeight: "600", fontVariant: ["tabular-nums"], minWidth: 42 },
  recordingHint: { flex: 1, fontSize: 13, textAlign: "right" },
  recordingCancel: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 7 },
  attachButton: { width: 38, height: 42, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, paddingTop: 11, paddingBottom: 11, maxHeight: 120, fontSize: 16, lineHeight: 21 },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
