import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./Icon";

/**
 * Полноэкранный просмотр фото с сохранением в галерею и «поделиться».
 *
 * Сохранение — через expo-media-library: файл лежит в приватной папке
 * приложения, и без копирования в галерею его нельзя ни открыть другим
 * приложением, ни найти в «Фото».
 */
export function ImageViewer({
  uri,
  onClose,
}: {
  uri: string | null;
  onClose: () => void;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  async function handleSave(): Promise<void> {
    if (!uri) return;
    setBusy(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Нет доступа к галерее", "Разрешите доступ к фото в настройках устройства.");
        return;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert("Готово", "Фото сохранено в галерею.");
    } catch {
      Alert.alert("Не удалось сохранить", "Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function handleShare(): Promise<void> {
    if (!uri) return;
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert("Недоступно", "На этом устройстве нельзя поделиться файлом.");
      return;
    }
    await Sharing.shareAsync(uri);
  }

  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        {/* Нажатие по фону закрывает — привычное поведение просмотрщиков. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {uri !== null && <Image source={{ uri }} style={styles.image} resizeMode="contain" />}

        <View style={[styles.bar, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.barButton}>
            <Icon name="close" size={24} color="#fff" />
          </Pressable>
          <View style={styles.barActions}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Pressable onPress={() => void handleShare()} hitSlop={12} style={styles.barButton}>
                  <Icon name="share" size={22} color="#fff" />
                </Pressable>
                <Pressable onPress={() => void handleSave()} hitSlop={12} style={styles.barButton}>
                  <Icon name="download" size={22} color="#fff" />
                </Pressable>
              </>
            )}
          </View>
        </View>

        <Text style={[styles.hint, { paddingBottom: insets.bottom + 18 }]}>
          Сохранить в галерею или поделиться — кнопками сверху
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", justifyContent: "center" },
  image: { width: "100%", height: "78%" },
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  barActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  barButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  hint: { position: "absolute", bottom: 0, left: 0, right: 0, textAlign: "center", color: "#8f8d88", fontSize: 12.5 },
});
