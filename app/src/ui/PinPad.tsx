import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { Icon } from "./Icon";
import { DURATION } from "./motion";

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * Ввод PIN-кода: точки, своя цифровая клавиатура, кнопка подтверждения.
 *
 * Своя клавиатура, а не TextInput с keyboardType="number-pad": системная
 * клавиатура на разных прошивках выглядит по-разному, показывает подсказки
 * автозаполнения и может подставить сохранённый где-то ранее код. Здесь же
 * нужны ровно цифры и ничего больше.
 */
export function PinPad({
  title,
  hint,
  error,
  busy = false,
  submitIcon = "check",
  onSubmit,
  onCancel,
  footer,
}: {
  title: string;
  hint?: string;
  /** Текст ошибки: непустое значение встряхивает точки и подсвечивает их. */
  error?: string;
  busy?: boolean;
  submitIcon?: "check" | "send";
  onSubmit: (pin: string) => void;
  onCancel?: () => void;
  /** Дополнительная кнопка под клавиатурой — например «Отпечаток». */
  footer?: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  const [value, setValue] = useState("");

  // Ошибку показываем встряхиванием: это понятнее, чем сменившаяся надпись,
  // особенно когда код набирают не глядя.
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!error) return;
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: DURATION.fast, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: DURATION.fast, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: DURATION.fast, useNativeDriver: true }),
    ]).start();
  }, [error, shake]);

  const canSubmit = value.length >= PIN_MIN_LENGTH && !busy;

  function press(digit: string): void {
    if (busy || value.length >= PIN_MAX_LENGTH) return;
    setValue(value + digit);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{title}</Text>
        {hint !== undefined && hint !== "" && (
          <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>{hint}</Text>
        )}
      </View>

      <Animated.View
        style={[
          styles.dots,
          { transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-11, 11] }) }] },
        ]}
      >
        {Array.from({ length: PIN_MAX_LENGTH }, (_, index) => {
          const filled = index < value.length;
          // Точки сверх минимальной длины показываем бледнее: видно, что код
          // может быть длиннее, но четырёх уже достаточно.
          const optional = index >= PIN_MIN_LENGTH;
          return (
            <View
              key={index}
              style={[
                styles.dot,
                {
                  borderColor: error ? theme.colors.danger : optional ? theme.colors.divider : theme.colors.border,
                  backgroundColor: filled ? (error ? theme.colors.danger : theme.colors.accent) : "transparent",
                },
              ]}
            />
          );
        })}
      </Animated.View>

      <Text style={[styles.error, { color: theme.colors.danger }]}>{error ?? ""}</Text>

      <View style={styles.keys}>
        {KEYS.map((digit) => (
          <PinKey key={digit} label={digit} onPress={() => press(digit)} />
        ))}

        {onCancel ? (
          <PinKey label="Отмена" small onPress={onCancel} />
        ) : (
          <View style={styles.key} />
        )}

        <PinKey label="0" onPress={() => press("0")} />

        {value.length > 0 ? (
          <PinKey icon="back" onPress={() => setValue(value.slice(0, -1))} />
        ) : (
          <View style={styles.key} />
        )}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.submit,
          {
            backgroundColor: canSubmit ? theme.colors.accent : theme.colors.surface,
            borderColor: theme.colors.border,
            opacity: pressed && canSubmit ? 0.85 : 1,
          },
        ]}
        disabled={!canSubmit}
        // Точки гасим сразу при отправке, а не по появлению ошибки: следующий
        // шаг (повтор кода) и повторная одна и та же ошибка иначе оставляли бы
        // на экране уже введённые цифры.
        onPress={() => {
          setValue("");
          onSubmit(value);
        }}
      >
        {busy ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : (
          <Icon
            name={submitIcon}
            size={22}
            color={canSubmit ? theme.colors.onAccent : theme.colors.textMuted}
          />
        )}
      </Pressable>

      {footer}
    </View>
  );
}

function PinKey({
  label,
  icon,
  small = false,
  onPress,
}: {
  label?: string;
  icon?: "back";
  small?: boolean;
  onPress: () => void;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.key,
        { backgroundColor: pressed ? theme.colors.surfacePressed : "transparent" },
      ]}
      onPress={onPress}
    >
      {icon === "back" ? (
        <Icon name="back" size={24} color={theme.colors.textSecondary} />
      ) : (
        <Text
          style={[
            small ? styles.keyTextSmall : styles.keyText,
            { color: small ? theme.colors.textSecondary : theme.colors.textPrimary },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingBottom: 18 },
  head: { alignItems: "center", marginBottom: 26 },
  title: { fontSize: 21, fontWeight: "700", letterSpacing: -0.4, textAlign: "center" },
  hint: { fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 10, maxWidth: 300 },
  dots: { flexDirection: "row", gap: 12 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
  error: { fontSize: 13, lineHeight: 18, marginTop: 12, minHeight: 18, textAlign: "center" },
  keys: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", width: 264, marginTop: 10 },
  key: { width: 88, height: 62, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  keyText: { fontSize: 27, fontWeight: "500" },
  keyTextSmall: { fontSize: 15, fontWeight: "500" },
  submit: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
});
