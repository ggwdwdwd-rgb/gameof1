import React from "react";
import { Linking, StyleProp, Text, TextStyle } from "react-native";

/**
 * Ссылки в тексте сообщения — нажимаемые.
 *
 * RN не превращает ссылки в кликабельные сам, а `dataDetectorTypes` работает
 * только на iOS. Поэтому разбираем текст на куски и оборачиваем ссылки в Text
 * с onPress. Разметку не поддерживаем — только распознавание ссылок.
 */
const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

/** Хвостовые знаки препинания в ссылку не входят: «зайди на example.com.» */
const TRAILING = /[.,;:!?)\]}»"'…]+$/;

export function LinkedText({
  text,
  style,
  linkColor,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  linkColor: string;
}): React.ReactElement {
  const parts = splitByLinks(text);

  if (parts.length === 1 && parts[0]!.url === null) {
    return <Text style={style}>{text}</Text>;
  }

  return (
    <Text style={style}>
      {parts.map((part, index) =>
        part.url === null ? (
          <Text key={index}>{part.text}</Text>
        ) : (
          <Text
            key={index}
            style={[styles.link, { color: linkColor }]}
            onPress={() => void openLink(part.url!)}
            suppressHighlighting={false}
          >
            {part.text}
          </Text>
        ),
      )}
    </Text>
  );
}

interface Part {
  text: string;
  /** Адрес для открытия; null — обычный текст. */
  url: string | null;
}

export function splitByLinks(text: string): Part[] {
  const parts: Part[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    let found = match[0];

    // Знаки препинания в конце — часть предложения, а не адреса.
    const trailing = TRAILING.exec(found);
    let tail = "";
    if (trailing) {
      tail = trailing[0];
      found = found.slice(0, found.length - tail.length);
    }
    if (found.length === 0) continue;

    if (start > lastIndex) parts.push({ text: text.slice(lastIndex, start), url: null });
    parts.push({ text: found, url: found.startsWith("www.") ? `https://${found}` : found });
    if (tail) parts.push({ text: tail, url: null });
    lastIndex = start + found.length + tail.length;
  }

  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), url: null });
  if (parts.length === 0) parts.push({ text, url: null });
  return parts;
}

async function openLink(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    // Открывать нечем (нет браузера) — молча ничего не делаем, ронять чат незачем.
  }
}

const styles = { link: { textDecorationLine: "underline" } } as const;
