package expo.modules.keepalive

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Запуск и остановка службы переднего плана из JS.
 *
 * Зачем вообще: см. KeepAliveService. Коротко — без службы Android выгружает
 * процесс свёрнутого приложения, соединение умирает и уведомления о сообщениях
 * прекращаются.
 *
 * Модуль намеренно крошечный и без состояния: вся логика — когда включать —
 * живёт в JS, где её видно и можно менять без пересборки нативной части.
 */
class KeepAliveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KeepAlive")

    /**
     * Запускает службу или обновляет текст уже запущенной: повторный
     * startForegroundService приводит к ещё одному onStartCommand, который
     * перевыпускает уведомление с новым текстом.
     */
    Function("start") { title: String, text: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val intent = Intent(context, KeepAliveService::class.java).apply {
        putExtra(KeepAliveService.EXTRA_TITLE, title)
        putExtra(KeepAliveService.EXTRA_TEXT, text)
      }
      // На Android 8+ службу переднего плана обязаны запускать именно так:
      // обычный startService для неё бросает исключение.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    Function("stop") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      context.stopService(Intent(context, KeepAliveService::class.java))
    }

    Function("isRunning") {
      KeepAliveService.isRunning
    }

    /**
     * Включён ли экран.
     *
     * Нужно, чтобы не отмечать сообщения прочитанными и не показывать человека
     * «в сети», пока телефон лежит с погашенным экраном. Полагаться на одно
     * событие сворачивания приложения нельзя: гашение экрана его не всегда
     * вызывает, а соединение при работе в фоне живёт постоянно, так что само
     * по себе оно больше ничего не говорит о том, смотрит человек на телефон
     * или нет.
     *
     * true при недоступности PowerManager — лучше ошибиться в сторону обычного
     * поведения, чем молча перестать отправлять квитанции.
     */
    Function("isScreenOn") {
      val context = appContext.reactContext ?: return@Function true
      val manager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      manager?.isInteractive ?: true
    }
  }
}
