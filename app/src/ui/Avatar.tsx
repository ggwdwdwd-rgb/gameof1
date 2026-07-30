import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { avatarColor } from "../theme/theme";

export function Avatar({
  name,
  seed,
  size = 48,
}: {
  name: string;
  seed: string;
  size?: number;
}): React.ReactElement {
  const initials = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(seed) },
      ]}
    >
      <Text style={[styles.text, { fontSize: size * 0.42 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { color: "#fff", fontWeight: "700" },
});
