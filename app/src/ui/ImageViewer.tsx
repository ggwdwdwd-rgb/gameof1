import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { prepareForGallery } from "../chat/media";
import { Icon } from "./Icon";
import { Toast, useToast } from "./Toast";

/**
 * Полноэкранный просмотр фото с сохранением в галерею и «поделиться».
 *
 * Сохранение — через expo-media-library: файл лежит в приватной папке
 * приложения, и без копирования в галерею его нельзя ни открыть другим
 * приложением, ни найти в «Фото». Разрешение просим только на запись
 * (writeOnly): полный доступ ко всей галерее для сохранения не нужен.
 *
 * Записываем через MediaLibrary.Asset.create. Старая функция
 * saveToLibraryAsync в SDK 57 не удалена, а заменена заглушкой, которая
 * бросает исключение с текстом про deprecated — именно на неё приложение и
 * ругалось при нажатии «скачать».
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
  const { toast, showToast, hideToast } = useToast();

  async function handleSave(): Promise<void> {
    if (!uri) return;
    setBusy(true);
    try {
      // Разрешение спрашиваем, но отказ не считаем приговором: начиная с
      // Android 11 запись своего файла в галерею разрешения не требует вовсе, а
      // запрос WRITE_EXTERNAL_STORAGE там всё равно возвращает «отказано» — и
      // проверка granted запретила бы сохранение на ровном месте. Если
      // разрешение действительно нужно, MediaLibrary скажет об этом сама.
      const permission = await MediaLibrary.getPermissionsAsync(true);
      if (!permission.granted && permission.canAskAgain) {
        await MediaLibrary.requestPermissionsAsync(true);
      }

      // Промежуточная копия в кэше даёт файлу читаемое имя и расширение —
      // без расширения Android отказывается заводить снимок в галерее.
      const staged = prepareForGallery(uri);
      try {
        await MediaLibrary.Asset.create(staged.uri);
      } finally {
        if (staged.exists) staged.delete();
      }
      // Тост, а не Alert: удачное сохранение не повод перекрывать фото окном с
      // кнопкой «ОК».
      showToast("Фото сохранено в галерею", "download");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/permission/i.test(detail)) {
        Alert.alert(
          "Нет доступа к галерее",
          "Разрешение на доступ к фото нужно включить вручную: Настройки → Приложения → Cry → Разрешения.",
          [
            { text: "Отмена", style: "cancel" },
            { text: "Открыть настройки", onPress: () => void Linking.openSettings() },
          ],
        );
        return;
      }
      // Текст ошибки показываем как есть: без него непонятно, дело в самом
      // файле, в месте на диске или в чём-то ещё.
      Alert.alert("Не удалось сохранить", detail);
    } finally {
      setBusy(false);
    }
  }

  async function handleShare(): Promise<void> {
    if (!uri) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("Недоступно", "На этом устройстве нельзя поделиться файлом.");
        return;
      }
      await Sharing.shareAsync(uri);
    } catch (error) {
      Alert.alert("Не удалось поделиться", error instanceof Error ? error.message : "Неизвестная ошибка.");
    }
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

        {/* Тост живёт внутри модалки: снаружи его перекрыл бы просмотрщик. */}
        <Toast state={toast} onHide={hideToast} />
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
