import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider } from "./src/context/AppContext";
import { useAppLock } from "./src/lock/useAppLock";
import { AuthScreen } from "./src/screens/AuthScreen";
import { ContactsScreen } from "./src/screens/ContactsScreen";
import { ChatListScreen } from "./src/screens/ChatListScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { LockScreen } from "./src/screens/LockScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { loadIdentity, type DeviceIdentity } from "./src/storage/identity";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { CrashScreen, useCrashHandler } from "./src/ui/CrashScreen";
import { LogoMark } from "./src/ui/LogoMark";
import { Navigator, type NavDirection } from "./src/ui/Navigator";

type Screen =
  | { name: "chatList" }
  | { name: "chat"; chatId: string; title: string; peerUserId: string }
  | { name: "settings" }
  | { name: "contacts" };

/**
 * Глубина экрана в воображаемом стеке — из неё Navigator понимает, вперёд идём
 * или назад.
 *
 * Настоящего стека нет: экраны подменяются условным рендером. Но направление
 * перехода обязано совпадать с ощущением человека — «назад» должно уезжать
 * вправо, иначе анимация врёт про то, что произошло.
 */
const DEPTH: Record<Screen["name"], number> = { chatList: 0, chat: 2, settings: 1, contacts: 1 };

/** Контакты открываются как модальное окно — снизу: это не «глубже», а «поверх». */
function directionFor(from: Screen["name"], to: Screen["name"]): NavDirection {
  if (to === "contacts") return "modal";
  if (from === "contacts") return "pop";
  return DEPTH[to] >= DEPTH[from] ? "push" : "pop";
}

/** Ключ экрана для Navigator: у чата свой на каждого собеседника. */
function screenKey(screen: Screen): string {
  return screen.name === "chat" ? `chat:${screen.chatId}` : screen.name;
}

function Root(): React.ReactElement {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "chatList" });
  /**
   * Направление последнего перехода — его считаем в момент смены экрана.
   *
   * Именно в момент смены, а не при отрисовке: после перехода прежний экран уже
   * забыт, и восстановить по текущему состоянию «пришли мы сюда вперёд или
   * назад» нечем.
   */
  const [direction, setDirection] = useState<NavDirection>("push");
  const { crash, clear } = useCrashHandler();
  const lock = useAppLock();

  /**
   * Имя текущего экрана отдельным рефом.
   *
   * Направление считаем здесь, а не внутри обновляющей функции setScreen: та
   * обязана быть чистой, а в режиме разработки React вызывает её дважды — то
   * есть второй setState из неё был бы вызовом с побочным эффектом на каждый
   * переход.
   */
  const currentName = useRef<Screen["name"]>("chatList");
  const go = useCallback((next: Screen) => {
    setDirection(directionFor(currentName.current, next.name));
    currentName.current = next.name;
    setScreen(next);
  }, []);

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

  // Тем же рефом: обработчик «назад» ставится один раз и не должен пересоздаваться.
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (lockedRef.current) return false; // из блокировки — только выход из приложения
      if (screenRef.current.name === "chatList") return false; // из списка чатов — выход, как и ожидается
      goRef.current({ name: "chatList" });
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

  // Ждём только identity: без неё нечем ни подключаться, ни шифровать.
  // Настройки блокировки здесь НЕ ждём — см. комментарий у оверлея ниже.
  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.colors.background }]}>
        <LogoMark size={82} breathe />
        <ActivityIndicator color={theme.colors.accent} style={styles.loadingSpinner} />
        <StatusBar style={theme.colors.statusBar} />
      </View>
    );
  }

  if (!identity) {
    return (
      <>
        {/* Вход и регистрация по почте вместо прежнего онбординга по коду.
            Экран инвайтов убран из основного пути: людей теперь находят по
            @тегу, а не приглашают одноразовым кодом. */}
        <AuthScreen onComplete={setIdentity} />
        <StatusBar style={theme.colors.statusBar} />
      </>
    );
  }

  return (
    <AppProvider identity={identity}>
      {/* Один Navigator на всё: он держит уходящий экран смонтированным на
          время перехода, поэтому тот уезжает с параллаксом, а не исчезает в
          тот же кадр. Ключ — имя экрана (для чата ещё и id, чтобы переход между
          двумя чатами тоже проигрывался). */}
      <Navigator screenKey={screenKey(screen)} direction={direction}>
        {screen.name === "chatList" && (
          <ChatListScreen
            onOpenChat={(chatId, title, peerUserId) => go({ name: "chat", chatId, title, peerUserId })}
            onOpenSettings={() => go({ name: "settings" })}
            onAddPerson={() => go({ name: "contacts" })}
          />
        )}
        {screen.name === "chat" && (
          <ChatScreen
            chatId={screen.chatId}
            title={screen.title}
            peerUserId={screen.peerUserId}
            onBack={() => go({ name: "chatList" })}
          />
        )}
        {screen.name === "settings" && (
          <SettingsScreen onBack={() => go({ name: "chatList" })} onLockChanged={lock.reload} />
        )}
        {screen.name === "contacts" && (
          <ContactsScreen
            onBack={() => go({ name: "chatList" })}
            onOpenChat={(chatId, title, peerUserId) => go({ name: "chat", chatId, title, peerUserId })}
          />
        )}
      </Navigator>

      {/* Экран блокировки — поверх всего, но ВНУТРИ AppProvider: соединение под
          ним продолжает работать, сообщения приходят, уведомления показываются.
          Иначе включённая блокировка означала бы «не получать сообщения, пока
          телефон в кармане». */}
      {lock.state === "locked" && lock.config !== null && (
        <LockScreen config={lock.config} onUnlocked={lock.unlock} />
      )}
      {/* Настройки блокировки читаются из Android Keystore, и до ответа ещё
          неизвестно, надо ли спрашивать код. Поэтому содержимое закрываем
          заглушкой — но AppProvider уже смонтирован и соединение устанавливается.
          Раньше здесь стоял ранний return, то есть чтение Keystore задерживало
          подключение, а его сбой оставлял приложение навсегда на этой заставке:
          «на связи» не появлялось и сообщения не отправлялись. */}
      {lock.state === "loading" && (
        <View style={[styles.lockPlaceholder, { backgroundColor: theme.colors.background }]}>
          <LogoMark size={82} />
        </View>
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
  lockPlaceholder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
