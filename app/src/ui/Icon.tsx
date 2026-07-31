import React from "react";
import Svg, { Circle, Path, Polyline, Rect } from "react-native-svg";

/**
 * Свой небольшой набор иконок на react-native-svg (он уже есть в проекте ради
 * QR-кода). Раньше иконки были эмодзи и символами вроде «＋» и «⚙︎»: они
 * выглядят по-разному на разных прошивках, не умеют менять цвет под тему и
 * сбивают вертикальный ритм. Векторные — одного веса линий, красятся темой.
 */
export type IconName =
  | "back"
  | "settings"
  | "plus"
  | "close"
  | "send"
  | "mic"
  | "image"
  | "file"
  | "pin"
  | "check"
  | "checkDouble"
  | "clock"
  | "alert"
  | "reply"
  | "play"
  | "pause"
  | "shield"
  | "sun"
  | "moon"
  | "contrast"
  | "share"
  | "refresh"
  | "qr"
  | "camera";

const STROKE_WIDTH = 1.9;

function IconBase({
  name,
  size = 22,
  color,
}: {
  name: IconName;
  size?: number;
  color: string;
}): React.ReactElement {
  const common: CommonProps = {
    stroke: color,
    strokeWidth: STROKE_WIDTH,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "none",
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {renderPaths(name, common, color)}
    </Svg>
  );
}

/** Мемо: в списке сообщений иконка статуса есть у каждого своего пузыря. */
export const Icon = React.memo(IconBase);

type CommonProps = {
  stroke: string;
  strokeWidth: number;
  strokeLinecap: "round";
  strokeLinejoin: "round";
  fill: "none";
};

function renderPaths(name: IconName, c: CommonProps, color: string): React.ReactElement {
  switch (name) {
    case "back":
      return <Polyline {...c} points="15 5 8 12 15 19" />;
    case "settings":
      return (
        <>
          <Circle {...c} cx="12" cy="12" r="3.1" />
          <Path
            {...c}
            d="M12 3.2v2.1M12 18.7v2.1M4.8 7.8l1.8 1.05M17.4 15.15l1.8 1.05M4.8 16.2l1.8-1.05M17.4 8.85l1.8-1.05"
          />
        </>
      );
    case "plus":
      return <Path {...c} d="M12 5.5v13M5.5 12h13" />;
    case "close":
      return <Path {...c} d="M6.5 6.5l11 11M17.5 6.5l-11 11" />;
    case "send":
      return (
        <>
          <Path {...c} d="M12 19V5.5" />
          <Polyline {...c} points="6.2 11.3 12 5.4 17.8 11.3" />
        </>
      );
    case "mic":
      return (
        <>
          <Rect {...c} x="9.2" y="3" width="5.6" height="10.4" rx="2.8" />
          <Path {...c} d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0M12 17.6V21M9 21h6" />
        </>
      );
    case "image":
      return (
        <>
          <Rect {...c} x="3.2" y="4.6" width="17.6" height="14.8" rx="3" />
          <Circle {...c} cx="8.6" cy="9.6" r="1.5" />
          <Polyline {...c} points="4 17 9.4 12.2 13 15.2 16.4 12.4 20.6 16.2" />
        </>
      );
    case "file":
      return (
        <>
          <Path {...c} d="M13.6 3.2H7.4A2.2 2.2 0 0 0 5.2 5.4v13.2a2.2 2.2 0 0 0 2.2 2.2h9.2a2.2 2.2 0 0 0 2.2-2.2V8.6z" />
          <Polyline {...c} points="13.4 3.3 13.4 8.8 18.7 8.8" />
        </>
      );
    case "pin":
      return (
        <>
          <Path {...c} d="M12 21s6.4-6.1 6.4-11a6.4 6.4 0 1 0-12.8 0C5.6 14.9 12 21 12 21z" />
          <Circle {...c} cx="12" cy="10" r="2.4" />
        </>
      );
    case "check":
      return <Polyline {...c} points="5 12.8 9.6 17 19 7.4" />;
    case "checkDouble":
      return (
        <>
          <Polyline {...c} points="2.6 12.8 6.6 16.8 14.4 8.6" />
          <Polyline {...c} points="9.6 12.8 12.2 15.6 21.4 6" />
        </>
      );
    case "clock":
      return (
        <>
          <Circle {...c} cx="12" cy="12" r="8.4" />
          <Polyline {...c} points="12 7.4 12 12.3 15.6 14.2" />
        </>
      );
    case "alert":
      return (
        <>
          <Circle {...c} cx="12" cy="12" r="8.4" />
          <Path {...c} d="M12 7.6v5.2" />
          <Circle cx="12" cy="16.2" r="1.1" fill={color} />
        </>
      );
    case "reply":
      return (
        <>
          <Polyline {...c} points="9.4 5.6 4 11 9.4 16.4" />
          <Path {...c} d="M4 11h9.2a6.8 6.8 0 0 1 6.8 6.8V19" />
        </>
      );
    case "play":
      return <Path d="M8.4 5.6l10 6.4-10 6.4z" fill={color} />;
    case "pause":
      return (
        <>
          <Rect x="7.6" y="5.6" width="3.4" height="12.8" rx="1.2" fill={color} />
          <Rect x="13" y="5.6" width="3.4" height="12.8" rx="1.2" fill={color} />
        </>
      );
    case "shield":
      return (
        <>
          <Path {...c} d="M12 3.1l7.2 2.6v6c0 4.5-3 8.1-7.2 9.2-4.2-1.1-7.2-4.7-7.2-9.2v-6z" />
          <Polyline {...c} points="8.9 11.9 11.3 14.3 15.4 10.2" />
        </>
      );
    case "sun":
      return (
        <>
          <Circle {...c} cx="12" cy="12" r="4.1" />
          <Path
            {...c}
            d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M18.5 5.5L17 7M7 17l-1.5 1.5"
          />
        </>
      );
    case "moon":
      return <Path {...c} d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z" />;
    case "contrast":
      return (
        <>
          <Circle {...c} cx="12" cy="12" r="8.4" />
          <Path d="M12 3.6a8.4 8.4 0 0 1 0 16.8z" fill={color} />
        </>
      );
    case "share":
      return (
        <>
          <Path {...c} d="M12 15.6V3.8" />
          <Polyline {...c} points="7.6 8.2 12 3.7 16.4 8.2" />
          <Path {...c} d="M5.2 14.4v3.9a2.2 2.2 0 0 0 2.2 2.2h9.2a2.2 2.2 0 0 0 2.2-2.2v-3.9" />
        </>
      );
    case "refresh":
      return (
        <>
          <Path {...c} d="M20 12a8 8 0 1 1-2.6-5.9" />
          <Polyline {...c} points="20.4 3.4 20.4 8 15.8 8" />
        </>
      );
    case "qr":
      return (
        <>
          <Rect {...c} x="3.6" y="3.6" width="6.2" height="6.2" rx="1.4" />
          <Rect {...c} x="14.2" y="3.6" width="6.2" height="6.2" rx="1.4" />
          <Rect {...c} x="3.6" y="14.2" width="6.2" height="6.2" rx="1.4" />
          <Path {...c} d="M14.2 14.2h2.8v2.8h-2.8zM20.4 20.4h-2.8v-2.8" />
        </>
      );
    case "camera":
      return (
        <>
          <Path
            {...c}
            d="M3.4 8.6A2.2 2.2 0 0 1 5.6 6.4h1.8l1.2-2h6.8l1.2 2h1.8a2.2 2.2 0 0 1 2.2 2.2v8.6a2.2 2.2 0 0 1-2.2 2.2H5.6a2.2 2.2 0 0 1-2.2-2.2z"
          />
          <Circle {...c} cx="12" cy="12.8" r="3.4" />
        </>
      );
  }
}
