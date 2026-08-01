import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";
import { DURATION, EASE_OUT } from "./motion";

/**
 * Появление экрана: выезд сбоку (для «вглубь») или снизу (для возврата).
 *
 * Полноценной навигации здесь нет — экраны просто подменяются условным
 * рендером, поэтому уходящий экран анимировать нечем: он размонтируется
 * сразу. Анимируем входящий, и этого достаточно, чтобы переход перестал быть
 * мгновенной подменой картинки.
 *
 * key на этом компоненте обязателен: без него React переиспользует узел, и
 * второй экран появился бы без анимации.
 */
export function ScreenTransition({
  from = "right",
  children,
}: {
  from?: "right" | "left" | "bottom";
  children: React.ReactNode;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION.slow,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  const offset = from === "right" ? 90 : from === "left" ? -90 : 60;
  const shift = progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] });

  return (
    <Animated.View
      style={[
        styles.fill,
        {
          opacity: progress,
          transform: from === "bottom" ? [{ translateY: shift }] : [{ translateX: shift }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
