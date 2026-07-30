# app — клиент (Expo/React Native + TypeScript)

## Важно: обычный Expo Go не подойдёт

`react-native-libsodium` — нативный модуль (см. жёсткие требования в корневом
задании: "react-native-libsodium на клиенте"). Такие модули не входят в
готовый бинарник Expo Go, поэтому приложение нужно тестировать через
**dev-client**, а не через сканирование QR в обычном Expo Go — это не
недосмотр, а прямое следствие выбора react-native-libsodium вместо
libsodium-wrappers (тот работает как WASM, но WASM не поддерживается
движком Hermes, на котором работает React Native).

## Установка зависимостей

```bash
cd packages/crypto && npm install && npm run build   # общий крипто-пакет собирается первым
cd ../../app && npm install
```

(`npm start`/`android`/`ios`/`web` в этом package.json сами пересобирают
`packages/crypto` перед запуском — на случай, если её код поменялся.)

## Первый запуск (нужен dev-client build)

```bash
npx eas login                                   # аккаунт Expo (бесплатный)
npx eas build --profile development --platform android
```

Соберётся APK с dev-client — установи его на телефон (см. docs/BUILD.md для
подробностей про Play Protect на чистом устройстве). После установки:

```bash
npx expo start --dev-client
```

и отсканируй QR из этого dev-client APK (не из обычного Expo Go).

Если EAS недоступен и на компьютере есть Android Studio/SDK — тот же
результат даёт `npx expo run:android` (соберёт и поставит dev-client
локально через gradlew, без облака).

## .env

Скопировать `.env.example` в `.env`, поменять `EXPO_PUBLIC_SERVER_WS_URL` на
адрес сервера (или оставить и поменять прямо на экране онбординга — поле там
редактируемое, удобно для локальной отладки без TLS, например
`ws://192.168.1.50:8080/ws`).
