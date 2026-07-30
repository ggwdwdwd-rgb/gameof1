import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { AppProvider } from "./src/context/AppContext";
import { ChatListScreen } from "./src/screens/ChatListScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { loadIdentity, type DeviceIdentity } from "./src/storage/identity";

type Screen = { name: "chatList" } | { name: "chat"; chatId: string; title: string };

export default function App(): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "chatList" });

  useEffect(() => {
    void loadIdentity().then((stored) => {
      setIdentity(stored);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (!identity) {
    return (
      <>
        <OnboardingScreen onComplete={setIdentity} />
        <StatusBar style="auto" />
      </>
    );
  }

  return (
    <AppProvider identity={identity}>
      {screen.name === "chatList" ? (
        <ChatListScreen onOpenChat={(chatId, title) => setScreen({ name: "chat", chatId, title })} />
      ) : (
        <ChatScreen chatId={screen.chatId} title={screen.title} onBack={() => setScreen({ name: "chatList" })} />
      )}
      <StatusBar style="auto" />
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
});
