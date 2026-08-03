import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

/**
 * «печатает» с тремя пульсирующими точками.
 *
 * Раньше в шапке была просто надпись «печатает…» — статичный текст читается как
 * состояние, а не как процесс, и на него не смотрят. Анимация ловится боковым
 * зрением, а стоит недорого: три значения, native driver, только пока
 * собеседник действительно печатает.
 */
export function TypingDots({ color }: { color: string }): React.ReactElement {
  // Три анимации со сдвигом фазы — точки поднимаются волной, а не разом.
  const dots = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;

  useEffect(() => {
    const animations = dots.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 160),
          Animated.timing(value, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          // Пауза в конце цикла, иначе волна идёт без передышки и мельтешит.
          Animated.delay(480 - index * 160),
        ]),
      ),
    );
    for (const animation of animations) animation.start();
    return () => {
      for (const animation of animations) animation.stop();
    };
  }, [dots]);

  return (
    <View style={styles.row}>
      <Text style={[styles.text, { color }]}>печатает</Text>
      <View style={styles.dots}>
        {dots.map((value, index) => (
          <Animated.View
            key={index}
            style={[
              styles.dot,
              {
                backgroundColor: color,
                opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5 },
  text: { fontSize: 13 },
  dots: { flexDirection: "row", alignItems: "flex-end", gap: 3, paddingBottom: 2 },
  dot: { width: 3.5, height: 3.5, borderRadius: 2 },
});
