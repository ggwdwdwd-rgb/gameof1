import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCrypto } from "../crypto/sodium";
import { authenticateWithBiometrics, isBiometricsUsable } from "../lock/biometrics";
import type { LockConfig } from "../storage/lock";
import { useTheme } from "../theme/ThemeContext";
import { Icon } from "../ui/Icon";
import { LogoMark } from "../ui/LogoMark";
import { PinPad } from "../ui/PinPad";

/** После этого числа неверных попыток ввод замирает на PENALTY_SEC секунд. */
const MAX_ATTEMPTS = 5;
const PENALTY_SEC = 30;

/**
 * Экран блокировки.
 *
 * Перекрывает приложение целиком, но соединение под ним продолжает работать:
 * сообщения приходят и уведомления показываются, пока телефон лежит в кармане.
 *
 * Пауза после пяти неверных попыток — не главная защита (её обеспечивает
 * Argon2id, на котором один перебор кода стоит доли секунды и 64 МБ памяти), а
 * защита от того, кто просто тыкает наугад, взяв телефон в руки.
 */
export function LockScreen({
  config,
  onUnlocked,
}: {
  config: LockConfig;
  onUnlocked: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [penaltyLeft, setPenaltyLeft] = useState(0);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  const runBiometrics = useCallback(async (): Promise<void> => {
    // Отказ, отмена и отсутствие датчика — просто остаёмся на вводе кода,
    // исключение наружу не выходит (см. lock/biometrics.ts).
    if (await authenticateWithBiometrics()) onUnlocked();
  }, [onUnlocked]);

  // Биометрию предлагаем сразу при появлении экрана: иначе её пришлось бы
  // вызывать нажатием, что медленнее ввода кода и потому бессмысленно.
  const offered = useRef(false);
  useEffect(() => {
    void (async () => {
      if (!config.biometrics) return;
      if (!(await isBiometricsUsable())) return;
      setBiometricsAvailable(true);
      if (offered.current) return;
      offered.current = true;
      await runBiometrics();
    })();
  }, [config.biometrics, runBiometrics]);

  // Отсчёт паузы. Секунда — самый крупный шаг, который человек согласен
  // наблюдать; без видимого счётчика пауза выглядела бы поломкой.
  useEffect(() => {
    if (penaltyLeft <= 0) return;
    const timer = setTimeout(() => setPenaltyLeft(penaltyLeft - 1), 1000);
    return () => clearTimeout(timer);
  }, [penaltyLeft]);

  async function handleSubmit(pin: string): Promise<void> {
    if (penaltyLeft > 0) return;
    setBusy(true);
    setError("");
    try {
      const crypto = await getCrypto();
      // Argon2id считается заметное время (доли секунды) и занимает поток JS —
      // поэтому кнопка на это время показывает индикатор.
      if (crypto.verifyPin(pin, config.salt, config.hash)) {
        setAttempts(0);
        onUnlocked();
        return;
      }
      const next = attempts + 1;
      setAttempts(next);
      if (next >= MAX_ATTEMPTS) {
        setAttempts(0);
        setPenaltyLeft(PENALTY_SEC);
        setError(`Слишком много попыток. Подождите ${PENALTY_SEC} секунд.`);
        return;
      }
      setError(`Неверный код. Осталось попыток: ${MAX_ATTEMPTS - next}`);
    } catch (caught) {
      // Молчаливый отказ здесь означал бы «код не подходит, и почему —
      // неизвестно», то есть запертое приложение без объяснений.
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.logo, { paddingTop: insets.top + 22 }]}>
        <LogoMark size={62} />
      </View>

      <PinPad
        title="Cry заблокирован"
        hint={
          penaltyLeft > 0
            ? `Повторить можно через ${penaltyLeft} с`
            : "Введите код, который вы задали в настройках"
        }
        error={error}
        busy={busy || penaltyLeft > 0}
        onSubmit={(pin) => void handleSubmit(pin)}
        footer={
          biometricsAvailable ? (
            <Pressable
              style={({ pressed }) => [styles.biometrics, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => void runBiometrics()}
            >
              <Icon name="shield" size={19} color={theme.colors.accent} />
              <Text style={[styles.biometricsText, { color: theme.colors.accent }]}>Отпечаток или лицо</Text>
            </Pressable>
          ) : undefined
        }
      />

      <Text style={[styles.footer, { color: theme.colors.textMuted, paddingBottom: insets.bottom + 18 }]}>
        Код нельзя восстановить: он никуда не отправляется и не хранится в открытом виде. Если он забыт, останется
        только переустановить приложение — а вместе с ним пропадут ключи и вся переписка.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Не absoluteFill: экран блокировки лежит поверх открытых экранов, и они
  // должны быть полностью перекрыты — включая область под статус-баром.
  container: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  logo: { alignItems: "center", paddingTop: 54 },
  biometrics: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, paddingVertical: 8 },
  biometricsText: { fontSize: 15, fontWeight: "600" },
  footer: { fontSize: 11.5, lineHeight: 17, textAlign: "center", paddingHorizontal: 28, paddingBottom: 26 },
});
