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
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

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
 * Одного удержания процесса оказалось мало. Смахивание приложения из списка
 * недавних уносит Activity, а вместе с ней и JS-часть: сама служба жила
 * (stopWithTask="false"), уведомление «на связи» висело, но соединения за ним
 * уже не было. Если же процесс всё-таки убивали, START_NOT_STICKY означал, что
 * поднимать нечего.
 *
 * Поэтому служба сама поднимает JS: запускает headless-задачу React Native —
 * тот же JS-бандл, но без Activity. Задача открывает соединение и живёт, пока
 * живёт служба. Возвращается START_STICKY: теперь после убийства процесса
 * система поднимает службу, а служба — соединение.
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // intent == null — служба поднята системой заново после убийства процесса
    // (START_STICKY). Подписи в этом случае нет, берём нейтральную.
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Cry"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "На связи"

    createChannel()
    // startForeground умеет бросать исключение: начиная с Android 12 система
    // запрещает запуск службы переднего плана из фона, и хотя перезапуск по
    // START_STICKY инициирует она сама, полагаться на это без страховки нельзя.
    // Необработанное исключение здесь уронило бы процесс приложения целиком.
    try {
      startForeground(NOTIFICATION_ID, buildNotification(title, text))
      isRunning = true
    } catch (error: Throwable) {
      isRunning = false
      stopSelf()
      return START_NOT_STICKY
    }

    startJsTask()

    // START_STICKY: система поднимет службу заново, если процесс всё-таки
    // убили. Раньше здесь стоял START_NOT_STICKY именно потому, что поднятая
    // служба не умела запускать JS и получалось уведомление «на связи» у
    // приложения, которое ничего не получает. Теперь умеет — см. startJsTask.
    return START_STICKY
  }

  /**
   * Смахнули приложение из списка недавних.
   *
   * Службу это не останавливает (stopWithTask="false"), но Activity больше нет,
   * и держать соединение с этого момента должна headless-задача. Просим её
   * запуститься: если JS ещё жив и соединение держит экран, задача просто
   * дождётся своей очереди; если процесс потом убьют, START_STICKY поднимет
   * службу заново и задача подключится уже сама.
   */
  override fun onTaskRemoved(rootIntent: Intent?) {
    startJsTask()
  }

  /**
   * Запускает headless-задачу с соединением, если её ещё нет.
   *
   * HeadlessJsTaskService намеренно не наследуется: он держит PARTIAL_WAKE_LOCK
   * без таймаута всё время работы службы, а это уже не «не выгружай процесс», а
   * «не давай телефону спать» — заметный расход батареи. Процесс и без него
   * держит сама служба переднего плана. Здесь взято только то, что нужно:
   * поднять React-контекст, если его нет, и отдать ему задачу.
   */
  private fun startJsTask() {
    val application = application as? ReactApplication ?: return
    val reactHost = application.reactHost ?: return

    UiThreadUtil.runOnUiThread {
      val existing = reactHost.currentReactContext
      if (existing != null) {
        startTask(existing)
        return@runOnUiThread
      }
      // Контекста нет — процесс только что поднят системой, Activity не
      // создавалась. Просим React загрузить бандл и ждём готовности: задачу
      // можно отдавать только после того, как JS успел её зарегистрировать.
      reactHost.addReactInstanceEventListener(
        object : ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            reactHost.removeReactInstanceEventListener(this)
            startTask(context)
          }
        }
      )
      reactHost.start()
    }
  }

  private fun startTask(context: ReactContext) {
    val taskContext = HeadlessJsTaskContext.getInstance(context)
    val runningTaskId = taskId
    // Повторный start (обновление подписи уведомления) не должен запускать
    // вторую задачу: два соединения одного устройства сервер считает
    // конкурирующими и рвёт то, которое подключилось раньше.
    if (runningTaskId != null && taskContext.isTaskRunning(runningTaskId)) return

    taskId =
      try {
        taskContext.startTask(
          HeadlessJsTaskConfig(
            TASK_NAME,
            Arguments.createMap(),
            // 0 = без таймаута: задача живёт столько же, сколько служба.
            0,
            // Разрешаем и при открытом приложении: служба включается из него же,
            // иначе первый запуск падал бы с исключением.
            true,
          )
        )
      } catch (error: Throwable) {
        // Задача не зарегистрирована в JS (старый бандл) или React не готов.
        // Служба всё равно полезна: процесс она держит, как и раньше.
        null
      }
  }

  override fun onDestroy() {
    isRunning = false
    taskId = null
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

    /** То же имя, что в AppRegistry.registerHeadlessTask на стороне JS. */
    const val TASK_NAME = "CryBackground"

    /** id запущенной задачи — чтобы не запускать вторую на повторный start. */
    @Volatile
    private var taskId: Int? = null

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
