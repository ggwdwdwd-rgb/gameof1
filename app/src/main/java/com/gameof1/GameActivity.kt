package com.gameof1

import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import com.gameof1.databinding.ActivityGameBinding
import com.gameof1.game.Climate
import com.gameof1.game.GameEngine
import com.gameof1.ui.UpgradeBottomSheet

class GameActivity : AppCompatActivity() {

    private lateinit var binding: ActivityGameBinding
    private val engine = GameEngine()
    private val handler = Handler(Looper.getMainLooper())
    private var gameRunning = false
    private var gameSpeed = 1   // 0=пауза, 1=нормально, 2=быстро
    private var lastDNA = 0

    private val hideEventRunnable = Runnable {
        binding.tvEventNotification.visibility = View.GONE
    }

    private val gameLoop = object : Runnable {
        override fun run() {
            if (!gameRunning) return
            val ticks = when (gameSpeed) { 0 -> 0; 2 -> 3; else -> 1 }
            repeat(ticks) { engine.tick() }

            // Показать плавающий текст при получении ДНК
            val newDNA = engine.pathogen.dnaPoints
            if (newDNA > lastDNA && gameSpeed > 0) {
                val diff = newDNA - lastDNA
                val target = engine.countries.filter { it.infectedCount > 0 }.randomOrNull()
                if (target != null) {
                    binding.gameView.addFloatText(target.id, "+$diff 🧬", Color.parseColor("#44AAFF"))
                }
                lastDNA = newDNA
            }

            // Показать событие
            engine.pendingEventMessage?.let { msg ->
                showEvent(msg)
                engine.pendingEventMessage = null
            }

            binding.gameView.update()
            updateHud()
            binding.gameView.invalidate()
            handler.postDelayed(this, 50L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityGameBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.gameView.engine = engine
        binding.gameView.onCountryClicked = { id -> handleCountryClick(id) }
        binding.gameView.onMapReady = { startGameLoop() }
        binding.tvNews.isSelected = true

        binding.btnUpgrade.setOnClickListener {
            if (engine.gameState == GameEngine.GameState.RUNNING ||
                engine.gameState == GameEngine.GameState.WAITING) {
                UpgradeBottomSheet(engine) {
                    lastDNA = engine.pathogen.dnaPoints
                    updateHud()
                }.show(supportFragmentManager, UpgradeBottomSheet.TAG)
            }
        }

        binding.btnRestart.setOnClickListener { recreate() }
        binding.btnSpeedPause.setOnClickListener { setSpeed(0) }
        binding.btnSpeed1x.setOnClickListener { setSpeed(1) }
        binding.btnSpeed2x.setOnClickListener { setSpeed(2) }

        setSpeed(1)
    }

    override fun onDestroy() {
        super.onDestroy()
        gameRunning = false
        handler.removeCallbacksAndMessages(null)
    }

    private fun startGameLoop() {
        gameRunning = true
        lastDNA = engine.pathogen.dnaPoints
        handler.post(gameLoop)
    }

    private fun setSpeed(speed: Int) {
        gameSpeed = speed
        val active = ColorStateList.valueOf(Color.parseColor("#334466"))
        val idle   = ColorStateList.valueOf(Color.parseColor("#1A2840"))
        binding.btnSpeedPause.backgroundTintList = if (speed == 0) active else idle
        binding.btnSpeed1x.backgroundTintList    = if (speed == 1) active else idle
        binding.btnSpeed2x.backgroundTintList    = if (speed == 2) active else idle
    }

    private fun showEvent(message: String) {
        binding.tvEventNotification.text = message
        binding.tvEventNotification.visibility = View.VISIBLE
        handler.removeCallbacks(hideEventRunnable)
        handler.postDelayed(hideEventRunnable, 3200L)
    }

    private fun handleCountryClick(countryId: Int) {
        when (engine.gameState) {
            GameEngine.GameState.WAITING -> {
                engine.startInfection(countryId)
                binding.gameView.selectedCountryId = countryId
                updateHud()
                updateCountryPanel(countryId)
            }
            GameEngine.GameState.RUNNING -> {
                binding.gameView.selectedCountryId = countryId
                updateCountryPanel(countryId)
            }
            else -> {}
        }
    }

    private fun updateCountryPanel(countryId: Int) {
        if (countryId < 0 || countryId >= engine.countries.size) {
            binding.countryInfoPanel.visibility = View.GONE
            return
        }
        val c = engine.countries[countryId]
        binding.countryInfoPanel.visibility = View.VISIBLE
        binding.tvCountryFlag.text = c.flag
        binding.tvCountryName.text = c.name
        val climate = when (c.climate) {
            Climate.HOT       -> "☀️ Жаркий"
            Climate.COLD      -> "❄️ Холодный"
            Climate.TEMPERATE -> "🌤 Умеренный"
            Climate.ISLAND    -> "🏝 Островной"
        }
        binding.tvCountryStats.text = "${fmt(c.population)} чел · $climate"
        val pct = (c.infectionPercent * 100).toInt()
        binding.tvCountryInfPct.text = "$pct%"
        binding.tvCountryInfPct.setTextColor(when {
            pct >= 75 -> Color.parseColor("#FF2200")
            pct >= 40 -> Color.parseColor("#FF6600")
            pct > 0   -> Color.parseColor("#FFAA00")
            else      -> Color.parseColor("#44AAFF")
        })
    }

    private fun updateHud() {
        val worldPct = (engine.worldInfectionPercent * 100).toInt()
        val curePct  = (engine.cureProgress * 100).toInt()

        binding.progressInfection.progress = worldPct
        binding.progressCure.progress = curePct
        binding.tvInfected.text = "$worldPct% · ${fmt(engine.totalInfected)}"
        binding.tvCure.text = "$curePct%"
        binding.tvDNA.text = "🧬 ${engine.pathogen.dnaPoints} ДНК"
        binding.tvDays.text = "День ${engine.elapsedDays}"
        binding.tvNews.text = "📡 ${engine.currentNews}"

        // Опасность: лекарство почти готово
        if (curePct >= 75) {
            binding.progressCure.progressTintList = ColorStateList.valueOf(Color.parseColor("#FF3300"))
            binding.tvCure.setTextColor(Color.parseColor("#FF4400"))
        }

        // Обновить инфопанель страны если видна
        val selId = binding.gameView.selectedCountryId
        if (selId >= 0 && binding.countryInfoPanel.visibility == View.VISIBLE) {
            updateCountryPanel(selId)
        }

        val hasUpgrades = engine.pathogen.getAvailableUpgrades().isNotEmpty()
        binding.btnUpgrade.alpha = if (hasUpgrades) 1.0f else 0.55f

        when (engine.gameState) {
            GameEngine.GameState.WON, GameEngine.GameState.LOST -> {
                gameRunning = false
                binding.btnRestart.visibility = View.VISIBLE
            }
            else -> binding.btnRestart.visibility = View.GONE
        }
    }

    private fun fmt(n: Long): String = when {
        n >= 1_000_000_000L -> "${n / 1_000_000_000L}.${(n % 1_000_000_000L) / 100_000_000L}B"
        n >= 1_000_000L     -> "${n / 1_000_000L}.${(n % 1_000_000L) / 100_000L}M"
        n >= 1_000L         -> "${n / 1_000L}K"
        else                -> n.toString()
    }
}
