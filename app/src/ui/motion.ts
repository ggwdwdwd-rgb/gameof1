import { Animated, Easing, type EasingFunction } from "react-native";
import { useEffect, useRef } from "react";

/**
 * Общие параметры анимаций.
 *
 * Reanimated сознательно не подключаю: это нативный модуль, а собрать и
 * проверить нативную часть я не могу — Animated из React Native хватает для
 * всего, что здесь нужно (прозрачность и трансформации идут на native driver,
 * то есть не зависят от загруженности JS-потока).
 *
 * Длительности короткие намеренно: анимация в мессенджере должна
 * подсказывать, что произошло, а не заставлять ждать.
 */
export const DURATION = {
  /** Нажатия, галочки, мелкие отклики. */
  fast: 140,
  /** Появление сообщений, тостов. */
  normal: 220,
  /** Открытие листа действий, переход между экранами. */
  slow: 280,
} as const;

/** Мягкое замедление к концу — основной ease для появлений. */
export const EASE_OUT: EasingFunction = Easing.out(Easing.cubic);
/** Ускорение к концу — для исчезновений. */
export const EASE_IN: EasingFunction = Easing.in(Easing.cubic);

/**
 * Значение, которое едет от 0 к 1 при появлении и обратно при скрытии.
 *
 * Возвращает Animated.Value, а не булево: из него уже собираются и
 * прозрачность, и сдвиг, и масштаб одним источником.
 */
export function useTransition(visible: boolean, duration: number = DURATION.normal): Animated.Value {
  const value = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(value, {
      toValue: visible ? 1 : 0,
      duration,
      easing: visible ? EASE_OUT : EASE_IN,
      useNativeDriver: true,
    }).start();
  }, [visible, duration, value]);

  return value;
}

/** Однократное появление при монтировании: от 0 к 1. */
export function useAppear(enabled: boolean = true, duration: number = DURATION.normal): Animated.Value {
  const value = useRef(new Animated.Value(enabled ? 0 : 1)).current;

  useEffect(() => {
    if (!enabled) return;
    Animated.timing(value, { toValue: 1, duration, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [enabled, duration, value]);

  return value;
}

/**
 * Бесконечная пульсация — для кнопки записи.
 *
 * loop без остановки не запускаем: анимацию обязательно нужно остановить при
 * размонтировании, иначе Animated продолжает крутить её вхолостую.
 */
export function usePulse(active: boolean): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      value.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, value]);

  return value;
}
