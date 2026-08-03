import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import { runBackgroundConnection } from './src/background/task';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

/**
 * Соединение без экрана — его запускает служба переднего плана.
 *
 * Регистрация обязана быть здесь, в точке входа: когда систему просят поднять
 * службу заново после того, как процесс убили, Activity не создаётся вовсе, и
 * единственное, что успевает выполниться до запуска задачи, — этот файл.
 *
 * Имя задачи совпадает с KeepAliveService.TASK_NAME.
 */
AppRegistry.registerHeadlessTask('CryBackground', () => runBackgroundConnection);
