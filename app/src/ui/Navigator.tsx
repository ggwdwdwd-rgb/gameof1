import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, InteractionManager, StyleSheet, useWindowDimensions, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { clearTransition, navLayout, type NavDirection } from "./navigatorLayout";

/**
 * Переход между экранами с параллаксом — как в Telegram и вообще в iOS-навигации.
 *
 * Уходящий экран остаётся смонтированным на время перехода: при push/pop он
 * едет вбок на четверть ширины и притухает, пока новый выезжает во всю ширину —
 * разница скоростей и читается как «слои». Модальный (контакты) идёт по
 * вертикали: входящий выезжает снизу и проявляется, нижний темнеет и чуть
 * уменьшается, никуда не двигаясь по осям, поэтому там физически не может
 * возникнуть чёрный экран — кто-то из двух всегда закрывает всё. Закрытие
 * модального — точное зеркало открытия (см. navigatorLayout.ts), а не «pop» со
 * сдвигом вбок: раньше было именно так, и движение при закрытии не совпадало с
 * тем, как экран появился.
 *
 * Вся геометрия — в src/ui/navigatorLayout.ts, чистыми функциями с числовыми
 * диапазонами; здесь их просто интерполируют. Направление-специфичных ветвлений
 * в этом файле больше нет — это то, что отличало старую версию, где push/pop/
 * modal проверялись прямо в JSX, и было легко забыть один из путей.
 *
 * Полноценной навигации в приложении нет — экраны подменяются условным
 * рендером, поэтому «стек» здесь ровно один кадр глубиной.
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

    /**
     * Держим «интеракшен» на всё время перехода.
     *
     * Без этого экран, в который переходим, тут же начинает свою тяжёлую
     * работу — например, ChatScreen читает историю из sqlite и заполняет
     * FlatList — ровно в те же 280 мс, что идёт трансформ. На Fabric (New
     * Architecture, `newArchEnabled` в app.json) это не «параллельная» работа:
     * тяжёлый коммит нового поддерева может задержать коммит кадра самой
     * анимации, и переход визуально спотыкается на середине, а не просто чуть
     * медленнее рисуется. Экраны, которые хотят отложить свою тяжёлую загрузку
     * до конца перехода, подписываются через
     * `InteractionManager.runAfterInteractions` (см. ChatScreen.tsx) — им для
     * этого и нужен открытый хэндл здесь.
     */
    const interaction = InteractionManager.createInteractionHandle();
    Animated.timing(progress, { toValue: 1, duration: DURATION, easing: EASE, useNativeDriver: true }).start(() => {
      InteractionManager.clearInteractionHandle(interaction);
      // Снимается и доигравший переход, и прерванный — см. clearTransition.
      setTransition((current) => clearTransition(current, id));
    });
  }, [screenKey, children, direction, progress]);

  // Направление берём из состояния перехода, а не из пропа: пока переход идёт,
  // менять его нельзя, а вне перехода оно всё равно ни на что не влияет.
  const dir = transition?.dir ?? direction;
  const leaving = transition?.leaving ?? null;

  /**
   * Все интерполяции — одним `useMemo`, привязанным к `[progress, dir, width,
   * height]`.
   *
   * Без этого `progress.interpolate(...)` вызывался бы прямо в теле рендера и
   * создавал НОВЫЙ узел анимации на каждый ре-рендер `Navigator` — а он
   * случается не только на смену экрана: любой ре-рендер родителя во время уже
   * идущего перехода пересоздавал бы интерполяции, а каждая такая пересборка —
   * это отключение старого узла от нативной стороны и подключение нового через
   * мост. Посреди 280-мс анимации это дёргает кадр. `useMemo` пересчитывает
   * интерполяции только тогда, когда меняется направление или размеры экрана.
   */
  const anim = useMemo(() => {
    const layout = navLayout(dir, width, height);
    const between = (range: { from: number; to: number }): Animated.AnimatedInterpolation<number> =>
      progress.interpolate({ inputRange: [0, 1], outputRange: [range.from, range.to] });

    return {
      leavingOnTop: layout.leavingOnTop,
      hasEdgeScrim: layout.hasEdgeScrim,
      enterX: between(layout.enterX),
      enterY: between(layout.enterY),
      enterOpacity: between(layout.enterOpacity),
      enterScale: between(layout.enterScale),
      leaveX: between(layout.leaveX),
      leaveY: between(layout.leaveY),
      leaveOpacity: between(layout.leaveOpacity),
      leaveScale: between(layout.leaveScale),
      // Полоска-тень вдоль края верхнего слоя — только затемнение opacity, без
      // shadow*/elevation. Раньше тень висела на слое во весь экран через
      // Android elevation, а это пересчёт битмапа тени под всю площадь на
      // каждом кадре трансформа — ровно там, где важна плавность.
      // shadowColor/shadowRadius на Android к тому же не действуют вообще (это
      // iOS-свойства), так что реальную и дорогую работу делала только
      // elevation.
      //
      // Интенсивность держим почти постоянной, пока край едет по экрану, и
      // гасим только в самом конце: физическая тень не тускнеет по ходу
      // движения, она пропадает, когда предмет ложится на место.
      scrim: layout.hasEdgeScrim
        ? progress.interpolate({ inputRange: [0, 0.82, 1], outputRange: [0.2, 0.2, 0] })
        : null,
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
            opacity: anim.leaveOpacity,
            transform: [{ translateX: anim.leaveX }, { translateY: anim.leaveY }, { scale: anim.leaveScale }],
          },
        ]}
      >
        {leaving.node}
        {anim.leavingOnTop && anim.scrim !== null && (
          <Animated.View pointerEvents="none" style={[styles.scrim, styles.scrimLeft, { opacity: anim.scrim }]} />
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
          opacity: anim.enterOpacity,
          transform: [{ translateX: anim.enterX }, { translateY: anim.enterY }, { scale: anim.enterScale }],
        },
      ]}
    >
      {children}
      {/* Тень-полоска по левому краю входящего слоя — то, что делает переход
          «слоями», а не плоской подменой картинки. */}
      {leaving !== null && !anim.leavingOnTop && anim.scrim !== null && (
        <Animated.View pointerEvents="none" style={[styles.scrim, styles.scrimLeft, { opacity: anim.scrim }]} />
      )}
    </Animated.View>
  );

  // Порядком в массиве, а не zIndex: на Android zIndex у абсолютных соседей
  // ведёт себя неоднозначно при наличии elevation у соседних вьюх. Порядок
  // отрисовки в массиве однозначен, а переупаковка массива экземпляры не
  // рушит — React сопоставляет детей по ключу, а не по месту.
  const layers = anim.leavingOnTop ? [currentLayer, leavingLayer] : [leavingLayer, currentLayer];

  return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>{layers}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  layer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  // Просто затемнение, без shadow*/elevation — см. комментарий у anim.scrim.
  scrim: { position: "absolute", top: 0, bottom: 0, width: 16, backgroundColor: "#000" },
  scrimLeft: { left: 0 },
});
