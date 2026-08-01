import React, { useCallback, useEffect, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";
import { Icon, type IconName } from "./Icon";
import { DURATION, useTransition } from "./motion";

/** Сколько тост висит до самозакрытия. */
const VISIBLE_MS = 2200;

export interface ToastState {
  text: string;
  icon?: IconName;
}

/**
 * Короткое сообщение внизу экрана.
 *
 * Для «скопировано» и «фото сохранено» Alert — это перебор: он перекрывает
 * экран и требует нажать «ОК» на том, о чём и так всё понятно. А раньше,
 * например, копирование сообщения вообще не давало никакого отклика, и было не
 * ясно, сработало ли оно.
 */
export function Toast({ state, onHide }: { state: ToastState | null; onHide: () => void }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const visible = state !== null;
  const progress = useTransition(visible, DURATION.normal);

  // Текст держим в своём состоянии: на время анимации ухода он должен остаться
  // на экране, хотя снаружи его уже сбросили в null.
  const [shown, setShown] = useState<ToastState | null>(state);
  useEffect(() => {
    if (state !== null) setShown(state);
  }, [state]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onHide, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [visible, onHide, state]);

  if (shown === null) return <></>;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 88 }]} pointerEvents="none">
      <Animated.View
        style={[
          styles.toast,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.border,
            shadowColor: theme.colors.shadow,
            opacity: progress,
            transform: [{ translateY }],
          },
        ]}
      >
        {shown.icon !== undefined && <Icon name={shown.icon} size={17} color={theme.colors.accent} />}
        <Text style={[styles.text, { color: theme.colors.textPrimary }]}>{shown.text}</Text>
      </Animated.View>
    </View>
  );
}

/** Состояние тоста плюс готовый показыватель — чтобы экраны не повторяли это. */
export function useToast(): {
  toast: ToastState | null;
  showToast: (text: string, icon?: IconName) => void;
  hideToast: () => void;
} {
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback((text: string, icon?: IconName) => setToast({ text, icon }), []);
  const hideToast = useCallback(() => setToast(null), []);
  return { toast, showToast, hideToast };
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    maxWidth: "88%",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { fontSize: 14.5, flexShrink: 1 },
});
