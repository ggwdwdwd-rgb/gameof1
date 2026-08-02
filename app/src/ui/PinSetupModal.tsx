import React, { useEffect, useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { getCrypto } from "../crypto/sodium";
import { useTheme } from "../theme/ThemeContext";
import { PinPad } from "./PinPad";

type Step = "current" | "new" | "repeat";

/**
 * Задать, сменить или снять PIN-код.
 *
 * Три шага, из которых первый нужен не всегда: чтобы сменить или снять код,
 * старый обязателен — иначе взявший телефон в руки просто выключил бы
 * блокировку, и она защищала бы только от совсем случайного человека.
 *
 * Возвращает готовые соль и хэш: считать их должен один код, и он лежит в
 * packages/crypto (Argon2id, см. pin.ts).
 */
export function PinSetupModal({
  visible,
  mode,
  verify,
  onCancel,
  onDone,
}: {
  visible: boolean;
  mode: "set" | "change" | "disable";
  /** Проверка старого кода — нужна для change и disable. */
  verify?: (pin: string) => Promise<boolean>;
  onCancel: () => void;
  /** salt/hash отсутствуют, когда код снимают. */
  onDone: (result: { salt: string; hash: string } | null) => void;
}): React.ReactElement {
  const theme = useTheme();
  const [step, setStep] = useState<Step>(mode === "set" ? "new" : "current");
  const [first, setFirst] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Сброс при каждом открытии: иначе второй заход начинался бы с середины
  // прошлого, уже неактуального ввода.
  useEffect(() => {
    if (!visible) return;
    setStep(mode === "set" ? "new" : "current");
    setFirst("");
    setError("");
    setBusy(false);
  }, [visible, mode]);

  async function handleSubmit(pin: string): Promise<void> {
    setError("");

    if (step === "current") {
      if (!verify) return;
      setBusy(true);
      try {
        if (!(await verify(pin))) {
          setError("Неверный код");
          return;
        }
      } finally {
        setBusy(false);
      }
      if (mode === "disable") {
        onDone(null);
        return;
      }
      setStep("new");
      return;
    }

    if (step === "new") {
      setFirst(pin);
      setStep("repeat");
      return;
    }

    if (pin !== first) {
      setFirst("");
      setStep("new");
      setError("Коды не совпали — введите новый заново");
      return;
    }

    setBusy(true);
    try {
      const crypto = await getCrypto();
      const salt = crypto.generatePinSalt();
      onDone({ salt, hash: crypto.hashPin(pin, salt) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Step, string> = {
    current: mode === "disable" ? "Выключить блокировку" : "Смена кода",
    new: mode === "set" ? "Новый код" : "Новый код",
    repeat: "Повторите код",
  };
  const hints: Record<Step, string> = {
    current: "Сначала введите текущий код",
    new: "От 4 до 8 цифр. Восстановить его будет нельзя, поэтому выбирайте тот, который точно не забудете.",
    repeat: "Ещё раз, чтобы исключить опечатку",
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <PinPad
          title={titles[step]}
          hint={hints[step]}
          error={error}
          busy={busy}
          submitIcon={step === "repeat" ? "check" : "send"}
          onSubmit={(pin) => void handleSubmit(pin)}
          onCancel={onCancel}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
