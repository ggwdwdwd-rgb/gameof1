import React, { useLayoutEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";

/**
 * Переход между экранами с параллаксом — как в Telegram и вообще в iOS-навигации.
 *
 * Чем это отличается от прежнего ScreenTransition: тот анимировал только
 * входящий экран, потому что уходящий размонтировался в тот же кадр. Получалась
 * подмена картинки с наездом — по краю на мгновение просвечивала пустота.
 *
 * Здесь уходящий экран остаётся смонтированным на время перехода: он уезжает
 * влево на четверть ширины и притухает, пока новый выезжает справа во всю
 * ширину. Именно эта разница скоростей (новый идёт полный путь, старый — четверть)
 * и читается как «слои», а не как «слайд». Назад всё играется зеркально: старый
 * уезжает вправо целиком, а тот, что был под ним, догоняет из недосдвига.
 *
 * Полноценной навигации в приложении нет — экраны подменяются условным
 * рендером, поэтому «стек» здесь ровно один кадр глубиной. Больше и не нужно:
 * анимируется только тот переход, который человек видит прямо сейчас.
 */
export type NavDirection = "push" | "pop" | "modal";

/** Длительность подобрана под ощущение iOS-навигации: короче кажется дёрганым. */
const DURATION = 280;
/** Материальный «standard decelerate» — быстрый старт, мягкая остановка. */
const EASE = Easing.bezier(0.2, 0, 0, 1);

interface Snapshot {
  key: string;
  node: React.ReactNode;
}

export function Navigator({
  screenKey,
  direction,
  children,
}: {
  /** Меняется — значит переход. Внутри одного экрана обновления идут как обычно. */
  screenKey: string;
  direction: NavDirection;
  children: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();

  /** Последнее, что мы отрисовали: из него берётся уходящий экран. */
  const latest = useRef<Snapshot>({ key: screenKey, node: children });
  /**
   * Замороженный уходящий экран. Именно замороженный: он больше не
   * перерисовывается, и это правильно — переход длится 280 мс, а лишние
   * обновления экрана, который уже уезжает, только грузят JS-поток.
   */
  const [leaving, setLeaving] = useState<Snapshot | null>(null);
  /** Направление на момент начала перехода: пока он идёт, менять его нельзя. */
  const playing = useRef<NavDirection>(direction);
  const progress = useRef(new Animated.Value(1)).current;

  useLayoutEffect(() => {
    if (latest.current.key === screenKey) {
      latest.current = { key: screenKey, node: children };
      return;
    }
    setLeaving(latest.current);
    latest.current = { key: screenKey, node: children };
    playing.current = direction;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: DURATION, easing: EASE, useNativeDriver: true }).start(
      ({ finished }) => {
        // Только при честном завершении: прерванную анимацию догонит следующий
        // переход, и снятие уходящего экрана здесь оборвало бы его на середине.
        if (finished) setLeaving(null);
      },
    );
  }, [screenKey, children, direction, progress]);

  const dir = playing.current;

  // Входящий экран.
  const enterFrom = dir === "push" ? width : dir === "pop" ? -width * 0.25 : 0;
  const enterX = progress.interpolate({ inputRange: [0, 1], outputRange: [enterFrom, 0] });
  const enterY = progress.interpolate({ inputRange: [0, 1], outputRange: [dir === "modal" ? height * 0.28 : 0, 0] });
  // Возврат — это «снятие верхнего слоя», и нижний не должен проявляться из
  // прозрачности: он всё время был там. Прозрачность анимируем только у
  // модального.
  const enterOpacity = dir === "modal" ? progress : 1;

  // Уходящий экран.
  const leaveTo = dir === "push" ? -width * 0.25 : dir === "pop" ? width : 0;
  const leaveX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, leaveTo] });
  const leaveOpacity =
    dir === "push"
      ? progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] })
      : dir === "modal"
        ? progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] })
        : 1;
  const leaveScale =
    dir === "modal" ? progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }) : 1;

  // Наверху тот экран, который «ближе к человеку»: при переходе вперёд это
  // входящий (он наезжает), при возврате — уходящий (он уезжает, открывая
  // лежащий под ним).
  const leavingOnTop = dir === "pop";
  const shadow = {
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: -3, height: 0 },
    elevation: 12,
  };

  /**
   * Слои собираем МАССИВОМ с ключами, а не парой соседних элементов.
   *
   * Это не косметика. React сопоставляет соседей по позиции, и появление
   * уходящего слоя перед текущим сдвинуло бы позиции — уходящий экран
   * пересоздался бы с нуля: его эффекты запустились бы заново, а список
   * сообщений мигнул бы пустым ровно тогда, когда его видно, то есть во время
   * анимации. В массиве сопоставление идёт по ключу, поэтому оба экрана
   * сохраняют свои экземпляры: один продолжает жить, второй просто монтируется.
   */
  const layers: React.ReactNode[] = [];

  if (leaving !== null) {
    layers.push(
      <Animated.View
        key={leaving.key}
        pointerEvents="none"
        style={[
          styles.layer,
          leavingOnTop ? shadow : null,
          {
            zIndex: leavingOnTop ? 2 : 1,
            backgroundColor: theme.colors.background,
            opacity: leaveOpacity,
            transform: [{ translateX: leaveX }, { scale: leaveScale }],
          },
        ]}
      >
        {leaving.node}
      </Animated.View>,
    );
  }

  layers.push(
    <Animated.View
      key={screenKey}
      style={[
        styles.layer,
        // Тень по левому краю — то, что делает переход «слоями». Без неё два
        // экрана выглядят одной плоской картинкой, разрезанной пополам.
        leaving !== null && !leavingOnTop ? shadow : null,
        {
          zIndex: leavingOnTop ? 1 : 2,
          backgroundColor: theme.colors.background,
          opacity: enterOpacity,
          transform: [{ translateX: enterX }, { translateY: enterY }],
        },
      ]}
    >
      {children}
    </Animated.View>,
  );

  return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>{layers}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  layer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
});
