import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider } from "./src/context/AppContext";
import { useAppLock } from "./src/lock/useAppLock";
import { AddPersonScreen } from "./src/screens/AddPersonScreen";
import { ChatListScreen } from "./src/screens/ChatListScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { LockScreen } from "./src/screens/LockScreen";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { loadIdentity, type DeviceIdentity } from "./src/storage/identity";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { CrashScreen, useCrashHandler } from "./src/ui/CrashScreen";
import { LogoMark } from "./src/ui/LogoMark";
import { ScreenTransition } from "./src/ui/ScreenTransition";

type Screen =
  | { name: "chatList" }
  | { name: "chat"; chatId: string; title: string; peerUserId: string }
  | { name: "settings" }
  | { name: "addPerson" };

function Root(): React.ReactElement {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "chatList" });
  const { crash, clear } = useCrashHandler();
  const lock = useAppLock();

  useEffect(() => {
    void loadIdentity().then((stored) => {
      setIdentity(stored);
      setLoading(false);
    });
  }, []);

  /**
   * Аппаратная кнопка «назад» закрывает открытый экран, а не приложение.
   *
   * Подписываемся один раз за всё время жизни, а текущий экран читаем из рефа.
   * Раньше эффект зависел от screen.name, то есть на каждом переходе снимал и
   * ставил обработчик заново — лишняя работа там, где ошибка стоит дорого:
   * промах означает выход из приложения.
   */
  const screenRef = useRef(screen);
  screenRef.current = screen;

  // Пока показан экран блокировки, «назад» не должен уводить с него на экраны
  // приложения: там осталось открытым то, что было до сворачивания.
  const lockedRef = useRef(false);
  lockedRef.current = lock.state === "locked";

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (lockedRef.current) return false; // из блокировки — только выход из приложения
      if (screenRef.current.name === "chatList") return false; // из списка чатов — выход, как и ожидается
      setScreen({ name: "chatList" });
      return true;
    });
    return () => subscription.remove();
  }, []);

  // Экран ошибки — раньше всего остального: если приложение поймало фатальную
  // ошибку, показывать надо её, а не пытаться рисовать сломанное состояние.
  if (crash !== null) {
    return (
      <>
        <CrashScreen message={crash} onDismiss={clear} />
        <StatusBar style={theme.colors.statusBar} />
      </>
    );
  }

  if (loading || lock.state === "loading") {
    return (
      <View style={[styles.loading, { backgroundColor: theme.colors.background }]}>
        <LogoMark size={82} />
        <ActivityIndicator color={theme.colors.accent} style={styles.loadingSpinner} />
        <StatusBar style={theme.colors.statusBar} />
      </View>
    );
  }

  if (!identity) {
    return (
      <>
        <OnboardingScreen onComplete={setIdentity} />
        <StatusBar style={theme.colors.statusBar} />
      </>
    );
  }

  return (
    <AppProvider identity={identity}>
      {/* key по имени экрана: он заставляет ScreenTransition пересоздаться и
          проиграть появление на каждом переходе. Список чатов возвращается
          слева — как будто мы вышли из экрана назад, а не открыли новый. */}
      {screen.name === "chatList" && (
        <ScreenTransition key="chatList" from="left">
          <ChatListScreen
            onOpenChat={(chatId, title, peerUserId) => setScreen({ name: "chat", chatId, title, peerUserId })}
            onOpenSettings={() => setScreen({ name: "settings" })}
            onAddPerson={() => setScreen({ name: "addPerson" })}
          />
        </ScreenTransition>
      )}
      {screen.name === "chat" && (
        <ScreenTransition key={`chat:${screen.chatId}`}>
          <ChatScreen
            chatId={screen.chatId}
            title={screen.title}
            peerUserId={screen.peerUserId}
            onBack={() => setScreen({ name: "chatList" })}
          />
        </ScreenTransition>
      )}
      {screen.name === "settings" && (
        <ScreenTransition key="settings">
          <SettingsScreen onBack={() => setScreen({ name: "chatList" })} onLockChanged={lock.reload} />
        </ScreenTransition>
      )}
      {screen.name === "addPerson" && (
        <ScreenTransition key="addPerson" from="bottom">
          <AddPersonScreen onBack={() => setScreen({ name: "chatList" })} />
        </ScreenTransition>
      )}
      {/* Экран блокировки — поверх всего, но ВНУТРИ AppProvider: соединение под
          ним продолжает работать, сообщения приходят, уведомления показываются.
          Иначе включённая блокировка означала бы «не получать сообщения, пока
          телефон в кармане». */}
      {lock.state === "locked" && lock.config !== null && (
        <LockScreen config={lock.config} onUnlocked={lock.unlock} />
      )}
      <StatusBar style={theme.colors.statusBar} />
    </AppProvider>
  );
}

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingSpinner: { marginTop: 26 },
});
