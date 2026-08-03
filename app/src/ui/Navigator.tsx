import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { clearTransition, navLayout, type NavDirection } from "./navigatorLayout";

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
export type { NavDirection };

/** Длительность подобрана под ощущение iOS-навигации: короче кажется дёрганым. */
const DURATION = 280;
/** Материальный «standard decelerate» — быстрый старт, мягкая остановка. */
const EASE = Easing.bezier(0.2, 0, 0, 1);

interface Snapshot {
  key: string;
  node: React.ReactNode;
}

/**
 * Идущий переход одним состоянием.
 *
 * Одним — принципиально. Сначала уходящий экран лежал в состоянии, а
 * направление в рефе, и это давало настоящий баг: изменение рефа не вызывает
 * перерисовку, поэтому первый кадр перехода считался по геометрии ПРЕДЫДУЩЕГО
 * направления. При нажатии «назад» входящий экран на кадр ставился за правый
 * край, слои шли в обратном порядке — и под ними мелькала пустота, то есть
 * чёрный экран.
 *
 * `id` — номер перехода. По нему поздний ответ прерванной анимации отличается
 * от ответа текущей: снимать уходящий экран может только та, что ещё идёт.
 */
interface Transition {
  id: number;
  leaving: Snapshot;
  dir: NavDirection;
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
   * Идущий переход: замороженный уходящий экран и направление вместе.
   *
   * Уходящий заморожен намеренно — переход длится 280 мс, и перерисовывать
   * экран, который уже уезжает, незачем.
   */
  const [transition, setTransition] = useState<Transition | null>(null);
  const counter = useRef(0);
  const progress = useRef(new Animated.Value(1)).current;

  useLayoutEffect(() => {
    if (latest.current.key === screenKey) {
      latest.current = { key: screenKey, node: children };
      return;
    }
    const id = counter.current + 1;
    counter.current = id;
    setTransition({ id, leaving: latest.current, dir: direction });
    latest.current = { key: screenKey, node: children };
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: DURATION, easing: EASE, useNativeDriver: true }).start(() => {
      // Снимается и доигравший переход, и прерванный — см. clearTransition.
      setTransition((current) => clearTransition(current, id));
    });
  }, [screenKey, children, direction, progress]);

  // Направление берём из состояния перехода, а не из пропа: пока переход идёт,
  // менять его нельзя, а вне перехода оно всё равно ни на что не влияет.
  const dir = transition?.dir ?? direction;
  const leaving = transition?.leaving ?? null;

  /**
   * Вся геометрия — одним `useMemo`, привязанным к `[progress, dir, width, height]`.
   *
   * Без этого `progress.interpolate(...)` вызывался прямо в теле рендера и
   * создавал НОВЫЙ узел анимации на каждый ре-рендер `Navigator` — а он
   * случается не только на смену экрана: любой ре-рендер родителя (`App.tsx`)
   * во время уже идущего перехода пересоздавал интерполяции, и каждая такая
   * пересборка означает отключение старого узла от нативной стороны и
   * подключение нового через мост. Если это происходило посреди 280-мс
   * анимации, кадр дёргался — то самое «дёргано». `useMemo` пересчитывает
   * интерполяции только тогда, когда меняется направление или размеры экрана,
   * а не на каждый чих родителя.
   */
  const geometry = useMemo(() => {
    const layout = navLayout(dir, width, height);
    const between = (range: { from: number; to: number }): Animated.AnimatedInterpolation<number> =>
      progress.interpolate({ inputRange: [0, 1], outputRange: [range.from, range.to] });

    return {
      leavingOnTop: layout.leavingOnTop,
      enterX: between(layout.enterX),
      enterY: between(layout.enterY),
      // Возврат — это «снятие верхнего слоя», и нижний не должен проявляться
      // из прозрачности: он всё время был там.
      enterOpacity: layout.enterFade ? progress : 1,
      leaveX: between(layout.leaveX),
      leaveOpacity:
        dir === "push"
          ? progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] })
          : dir === "modal"
            ? progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] })
            : 1,
      leaveScale: dir === "modal" ? progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }) : 1,
      // Полоска-тень вдоль края верхнего слоя. Тонкая и постоянного размера —
      // просто затемнение opacity, без shadow*/elevation. Раньше тень висела
      // на слое во весь экран через Android elevation, а это пересчёт битмапа
      // тени под всю площадь на каждом кадре трансформа — ровно там, где
      // важна плавность, и ровно то, что её портило. shadowColor/shadowRadius
      // к тому же на Android не действуют вообще (это iOS-свойства), так что
      // реальную (и дорогую) работу делала только elevation.
      //
      // Интенсивность держим почти постоянной, пока край едет по экрану, и
      // гасим только в самом конце: физическая тень не тускнеет по ходу
      // движения, она пропадает, когда предмет ложится на место. Плоское
      // затухание [0,1]→[0.24,0] гасило тень как раз к тому моменту, когда
      // край становится видимым внутри экрана, — эффект был почти незаметен.
      scrim:
        dir === "modal"
          ? null
          : progress.interpolate({ inputRange: [0, 0.82, 1], outputRange: [0.2, 0.2, 0] }),
    };
  }, [progress, dir, width, height]);

  const leavingLayer =
    leaving === null ? null : (
      <Animated.View
        key={leaving.key}
        pointerEvents="none"
        style={[
          styles.layer,
          {
            backgroundColor: theme.colors.background,
            opacity: geometry.leaveOpacity,
            transform: [{ translateX: geometry.leaveX }, { scale: geometry.leaveScale }],
          },
        ]}
      >
        {leaving.node}
        {geometry.leavingOnTop && geometry.scrim !== null && (
          <Animated.View pointerEvents="none" style={[styles.scrim, styles.scrimLeft, { opacity: geometry.scrim }]} />
        )}
      </Animated.View>
    );

  const currentLayer = (
    <Animated.View
      key={screenKey}
      style={[
        styles.layer,
        {
          backgroundColor: theme.colors.background,
          opacity: geometry.enterOpacity,
          transform: [{ translateX: geometry.enterX }, { translateY: geometry.enterY }],
        },
      ]}
    >
      {children}
      {/* Тень-полоска по левому краю входящего слоя — то, что делает переход
          «слоями», а не плоской подменой картинки. */}
      {leaving !== null && !geometry.leavingOnTop && geometry.scrim !== null && (
        <Animated.View pointerEvents="none" style={[styles.scrim, styles.scrimLeft, { opacity: geometry.scrim }]} />
      )}
    </Animated.View>
  );

  // Порядком в массиве, а не zIndex: на Android zIndex у абсолютных соседей
  // ведёт себя неоднозначно при наличии elevation у соседних вьюх. Порядок
  // отрисовки в массиве однозначен, а переупаковка массива экземпляры не
  // рушит — React сопоставляет детей по ключу, а не по месту.
  const layers = geometry.leavingOnTop ? [currentLayer, leavingLayer] : [leavingLayer, currentLayer];

  return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>{layers}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  layer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  // Просто затемнение, без shadow*/elevation — см. комментарий у geometry.scrim.
  scrim: { position: "absolute", top: 0, bottom: 0, width: 16, backgroundColor: "#000" },
  scrimLeft: { left: 0 },
});
