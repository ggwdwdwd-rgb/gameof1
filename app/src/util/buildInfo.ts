import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Версия установленного APK: «0.1.0 (7)» — видимая версия и номер сборки.
 *
 * Нужна потому, что APK раздаётся файлом: «обновился человек или нет» иначе не
 * выяснить никак, а половина непонятных жалоб оказывается старой сборкой.
 *
 * Модуль берём через requireOptionalNativeModule, а не импортом
 * expo-application: обычный импорт бросает исключение, если нативной части в
 * сборке нет. Так бывает при разработке — старый dev-client APK с новым
 * JS-бандлом, — и падало бы приложение целиком из-за строчки в настройках.
 */
interface ApplicationModule {
  nativeApplicationVersion: string | null;
  nativeBuildVersion: string | null;
}

const native = requireOptionalNativeModule<ApplicationModule>("ExpoApplication");

export const buildLabel = ((): string => {
  if (!native) return "нет данных";
  const version = native.nativeApplicationVersion ?? null;
  const build = native.nativeBuildVersion ?? null;
  if (version === null && build === null) return "нет данных";
  if (build === null) return version ?? "нет данных";
  return `${version ?? "?"} (${build})`;
})();
