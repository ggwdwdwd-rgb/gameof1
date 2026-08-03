import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { useTheme } from "../theme/ThemeContext";

/**
 * Знак приложения: раскрытое кольцо с хвостиком — одновременно «C» и облачко
 * реплики.
 *
 * Та же геометрия, что у иконки на домашнем экране (scripts/make-icons.py):
 * кольцо, вырез справа под «C», треугольный хвостик снизу-слева. Держать её в
 * двух местах приходится — там растр для системы, здесь вектор для экранов, — но
 * числа обязаны совпадать, иначе заставка и иконка выглядят как два разных
 * приложения.
 *
 * Прежний знак был терракотовым квадратом с буквой «C» из шрифта. После
 * перехода на монохром он остался единственным цветным пятном, а буква зависела
 * от того, какой шрифт подставит система.
 */

/** Единицы viewBox. Кольцо вписано в 100×100 с центром в 50,50. */
const R_OUT = 34;
const R_IN = R_OUT * 0.58;
/** Половина угла раскрытия справа, градусы. */
const GAP = 31;
const TAIL_ANGLE = 150;
const TAIL_SPREAD = 0.26;
const TAIL_LENGTH = 1.34;

function polar(angleDeg: number, radius: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [50 + radius * Math.cos(a), 50 + radius * Math.sin(a)];
}

/** Дуга кольца от +GAP до 360−GAP: два концентрических пути, замкнутых по краям. */
function ringPath(): string {
  const [x1o, y1o] = polar(GAP, R_OUT);
  const [x2o, y2o] = polar(-GAP, R_OUT);
  const [x1i, y1i] = polar(GAP, R_IN);
  const [x2i, y2i] = polar(-GAP, R_IN);
  // largeArcFlag = 1: дуга идёт «долгим путём», через левую сторону — именно её
  // и надо, вырез остаётся справа.
  return [
    `M ${x1o} ${y1o}`,
    `A ${R_OUT} ${R_OUT} 0 1 0 ${x2o} ${y2o}`,
    `L ${x2i} ${y2i}`,
    `A ${R_IN} ${R_IN} 0 1 1 ${x1i} ${y1i}`,
    "Z",
  ].join(" ");
}

function tailPath(): string {
  const rad = (TAIL_ANGLE * Math.PI) / 180;
  const [ax, ay] = [
    50 + R_OUT * Math.cos(rad - TAIL_SPREAD),
    50 + R_OUT * Math.sin(rad - TAIL_SPREAD),
  ];
  const [bx, by] = [
    50 + R_OUT * Math.cos(rad + TAIL_SPREAD),
    50 + R_OUT * Math.sin(rad + TAIL_SPREAD),
  ];
  const [tx, ty] = polar(TAIL_ANGLE, R_OUT * TAIL_LENGTH);
  return `M ${ax} ${ay} L ${tx} ${ty} L ${bx} ${by} Z`;
}

const RING = ringPath();
const TAIL = tailPath();
/** Радиус скругления концов «C» — половина толщины кольца. */
const CAP = (R_OUT - R_IN) / 2;
const CAP_R = (R_OUT + R_IN) / 2;

export function LogoMark({
  size = 76,
  /** Плавное «дыхание» — только там, где знак и есть весь экран (заставка, замок). */
  breathe = false,
}: {
  size?: number;
  breathe?: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const radius = size * 0.235;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!breathe) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, pulse]);

  const [capAx, capAy] = polar(GAP, CAP_R);
  const [capBx, capBy] = polar(-GAP, CAP_R);

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: theme.colors.accent,
          shadowColor: theme.colors.shadow,
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] }) }],
        },
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
        <G fill={theme.colors.onAccent}>
          <Path d={RING} />
          <Path d={TAIL} />
          <Circle cx={capAx} cy={capAy} r={CAP} />
          <Circle cx={capBx} cy={capBy} r={CAP} />
        </G>
      </Svg>
    </Animated.View>
  );
}

/** Тот же знак без подложки — для шапок и пустых состояний. */
export function LogoGlyph({ size = 24, color }: { size?: number; color: string }): React.ReactElement {
  const [capAx, capAy] = polar(GAP, CAP_R);
  const [capBx, capBy] = polar(-GAP, CAP_R);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <G fill={color}>
          <Path d={RING} />
          <Path d={TAIL} />
          <Circle cx={capAx} cy={capAy} r={CAP} />
          <Circle cx={capBx} cy={capBy} r={CAP} />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    elevation: 6,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
});
