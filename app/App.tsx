import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider } from "./src/context/AppContext";
import { AddPersonScreen } from "./src/screens/AddPersonScreen";
import { ChatListScreen } from "./src/screens/ChatListScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { loadIdentity, type DeviceIdentity } from "./src/storage/identity";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { LogoMark } from "./src/ui/LogoMark";

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

  useEffect(() => {
    void loadIdentity().then((stored) => {
      setIdentity(stored);
      setLoading(false);
    });
  }, []);

  // Аппаратная кнопка «назад» закрывает открытый экран, а не приложение.
  // Без обработчика Android выходил из Cry прямо из чата или настроек.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (screen.name === "chatList") return false; // из списка чатов — выход, как и ожидается
      setScreen({ name: "chatList" });
      return true;
    });
    return () => subscription.remove();
  }, [screen.name]);

  if (loading) {
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
      {screen.name === "chatList" && (
        <ChatListScreen
          onOpenChat={(chatId, title, peerUserId) => setScreen({ name: "chat", chatId, title, peerUserId })}
          onOpenSettings={() => setScreen({ name: "settings" })}
          onAddPerson={() => setScreen({ name: "addPerson" })}
        />
      )}
      {screen.name === "chat" && (
        <ChatScreen
          chatId={screen.chatId}
          title={screen.title}
          peerUserId={screen.peerUserId}
          onBack={() => setScreen({ name: "chatList" })}
        />
      )}
      {screen.name === "settings" && <SettingsScreen onBack={() => setScreen({ name: "chatList" })} />}
      {screen.name === "addPerson" && <AddPersonScreen onBack={() => setScreen({ name: "chatList" })} />}
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
