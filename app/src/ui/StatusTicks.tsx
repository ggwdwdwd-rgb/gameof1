import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import type { MessageStatus } from "../db/messages";
import { Icon } from "./Icon";

/**
 * Галочки статуса своего сообщения, с анимацией перехода между состояниями.
 *
 * Это самая заметная мелочь мессенджера: человек смотрит на неё после каждой
 * отправки. Статичная иконка честно показывает состояние, но не показывает
 * СМЕНУ состояния — а интересна именно смена: «ушло», «дошло», «прочитано».
 *
 * Что происходит:
 *   pending   — часы;
 *   sent      — одна галочка;
 *   delivered — вторая выезжает из-под первой вправо;
 *   read      — пара перекрашивается.
 * Любое продвижение сопровождается коротким подскоком масштаба.
 *
 * Первую отрисовку не анимируем: при открытии чата все прежние сообщения
 * дёрнулись бы разом, и это выглядело бы поломкой, а не подсказкой.
 */
const RANK: Record<MessageStatus, number> = { failed: -1, pending: 0, sent: 1, delivered: 2, read: 3 };

/** Толщина линии в единицах viewBox — совпадает с STROKE_WIDTH в Icon.tsx. */
const STROKE = 1.9 * 1.55;

function Tick({ size, color }: { size: number; color: string }): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polyline
        points="4 13 9 18 19.6 6.6"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function StatusTicks({
  status,
  color,
  readColor,
  size = 15,
}: {
  status: MessageStatus;
  color: string;
  readColor: string;
  size?: number;
}): React.ReactElement {
  /** Насколько выехала вторая галочка: 0 — спрятана за первой, 1 — на месте. */
  const second = useRef(new Animated.Value(RANK[status] >= 2 ? 1 : 0)).current;
  /** Короткий отклик на любое продвижение статуса. */
  const pop = useRef(new Animated.Value(0)).current;
  const previous = useRef(RANK[status]);

  useEffect(() => {
    const rank = RANK[status];
    const advanced = rank > previous.current;
    previous.current = rank;

    Animated.timing(second, {
      toValue: rank >= 2 ? 1 : 0,
      duration: advanced ? 240 : 0,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    if (!advanced) return;
    pop.setValue(0);
    Animated.sequence([
      Animated.timing(pop, { toValue: 1, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pop, { toValue: 0, duration: 160, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [status, second, pop]);

  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.2] });

  if (status === "pending" || status === "failed") {
    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name={status === "failed" ? "alert" : "clock"} size={size} color={color} />
      </Animated.View>
    );
  }

  // Сдвиг второй галочки. Рисуем две отдельные, а не иконку «checkDouble»: там
  // они уже сведены в один путь, и анимировать одну из них нечем.
  const shift = size * 0.3;
  const tint = status === "read" ? readColor : color;

  return (
    <Animated.View style={[styles.wrap, { width: size + shift, height: size, transform: [{ scale }] }]}>
      <Animated.View style={[styles.layer, { left: shift, opacity: second, transform: [{ translateX: second.interpolate({ inputRange: [0, 1], outputRange: [-shift, 0] }) }] }]}>
        <Tick size={size} color={tint} />
      </Animated.View>

      {/* Первая галочка рисуется ПОВЕРХ второй: вторая выезжает из-под неё, и
          порядок слоёв здесь — часть анимации, а не случайность. */}
      <Animated.View style={[styles.layer, { left: 0 }]}>
        <Tick size={size} color={tint} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: "center" },
  layer: { position: "absolute", top: 0 },
});
