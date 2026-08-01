import React, { useEffect, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";
import { Icon, type IconName } from "./Icon";
import { DURATION, useTransition } from "./motion";

export interface SheetAction {
  label: string;
  icon: IconName;
  /** Опасное действие — красным, как «удалить». */
  destructive?: boolean;
  onPress: () => void;
}

/**
 * Лист действий в оформлении приложения.
 *
 * Вместо Alert.alert: системный диалог Android выглядит как из другого
 * приложения — серая карточка с бирюзовыми надписями поперёк тёплой палитры, —
 * и не умеет ни иконок, ни внятного порядка кнопок. Здесь же обычная модалка:
 * подложка проявляется, лист выезжает снизу.
 */
export function ActionSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string | undefined;
  actions: SheetAction[];
  onClose: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const progress = useTransition(visible, DURATION.slow);

  // Modal убираем не сразу, а после анимации закрытия: иначе лист исчезал бы
  // мгновенно, и выезд наружу никто не увидел бы.
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), DURATION.slow);
    return () => clearTimeout(timer);
  }, [visible]);

  // Содержимое запоминаем: закрывая лист, вызывающая сторона сразу сбрасывает
  // выбранное сообщение, и без снимка кнопки исчезали бы прямо во время
  // анимации ухода — лист уезжал бы пустым.
  const [shown, setShown] = useState<{ title?: string | undefined; actions: SheetAction[] }>({ title, actions });
  useEffect(() => {
    if (visible) setShown({ title, actions });
  }, [visible, title, actions]);

  if (!mounted) return <></>;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [340, 0] });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              paddingBottom: insets.bottom + 10,
              opacity: progress,
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.border }]} />

          {shown.title !== undefined && shown.title !== "" && (
            <Text style={[styles.title, { color: theme.colors.textMuted }]} numberOfLines={2}>
              {shown.title}
            </Text>
          )}

          {shown.actions.map((action, index) => {
            const color = action.destructive ? theme.colors.danger : theme.colors.textPrimary;
            return (
              <Pressable
                key={action.label}
                style={({ pressed }) => [
                  styles.action,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
                  pressed && { backgroundColor: theme.colors.surfacePressed },
                ]}
                onPress={() => {
                  onClose();
                  action.onPress();
                }}
              >
                <View
                  style={[
                    styles.actionIcon,
                    { backgroundColor: action.destructive ? "transparent" : theme.colors.accentSoft },
                  ]}
                >
                  <Icon name={action.icon} size={19} color={action.destructive ? theme.colors.danger : theme.colors.accent} />
                </View>
                <Text style={[styles.actionLabel, { color }]}>{action.label}</Text>
              </Pressable>
            );
          })}

          <Pressable
            style={({ pressed }) => [
              styles.cancel,
              { backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.background },
            ]}
            onPress={onClose}
          >
            <Text style={[styles.cancelLabel, { color: theme.colors.textSecondary }]}>Отмена</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, marginBottom: 6 },
  title: { fontSize: 12.5, paddingHorizontal: 12, paddingVertical: 8 },
  action: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 10, paddingVertical: 14, borderRadius: 14 },
  actionIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  actionLabel: { flex: 1, fontSize: 16.5 },
  cancel: { marginTop: 8, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelLabel: { fontSize: 16, fontWeight: "600" },
});
