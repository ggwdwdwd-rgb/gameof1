package expo.modules.keepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Служба переднего плана: держит процесс приложения живым, пока постоянное
 * уведомление висит в шторке.
 *
 * Зачем: уведомления о сообщениях у нас локальные — их показывает само
 * приложение, получив сообщение по своему WebSocket. Содержимое зашифровано, и
 * расшифровать его может только клиент, поэтому сервер ничего рассылать не
 * может даже теоретически. Пока Android держит процесс, всё работает; как
 * только он его выгружает, соединение умирает и уведомления прекращаются. На
 * телефонах с агрессивной экономией батареи (Samsung и подобные) это
 * происходит почти сразу после сворачивания — отсюда «приходят только когда я в
 * приложении».
 *
 * Служба переднего плана — единственный поддерживаемый Android способ этого не
 * допустить. Ценой видимого уведомления, убрать которое нельзя: система
 * требует показывать, что приложение работает в фоне.
 *
 * Сама служба ничего не делает — она существует только как причина не убивать
 * процесс. Соединение по-прежнему живёт в JS.
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Cry"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Приложение на связи"

    createChannel()
    startForeground(NOTIFICATION_ID, buildNotification(title, text))
    isRunning = true

    // START_NOT_STICKY намеренно. START_STICKY заставил бы систему поднять
    // службу заново после того, как процесс всё-таки убили, — но JS-часть при
    // этом не запускается, соединения нет. Получилось бы уведомление «на
    // связи» у приложения, которое ничего не получает. Лучше честно исчезнуть.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    super.onDestroy()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // IMPORTANCE_MIN: уведомление обязано быть, но оно служебное — без звука,
    // без всплытия и в самом низу шторки.
    val channel = NotificationChannel(CHANNEL_ID, "Работа в фоне", NotificationManager.IMPORTANCE_MIN)
    channel.setShowBadge(false)
    channel.enableVibration(false)
    channel.lockscreenVisibility = Notification.VISIBILITY_SECRET
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(title: String, text: String): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val pendingIntent =
      if (launchIntent == null) {
        null
      } else {
        PendingIntent.getActivity(
          this,
          0,
          launchIntent,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
      }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(text)
      // Иконка приложения, а не своя: отдельный ресурс пришлось бы класть в
      // модуль и следить за его совпадением с иконкой приложения.
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .also { builder -> pendingIntent?.let { builder.setContentIntent(it) } }
      .build()
  }

  companion object {
    const val CHANNEL_ID = "background-connection"
    const val NOTIFICATION_ID = 47_110
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    /**
     * Работает ли служба. Хранится здесь, а не спрашивается у системы:
     * ActivityManager.getRunningServices устарел и на новых Android возвращает
     * только свои же службы, то есть даёт ровно тот же ответ, но дороже.
     */
    @Volatile
    var isRunning: Boolean = false
      private set
  }
}
