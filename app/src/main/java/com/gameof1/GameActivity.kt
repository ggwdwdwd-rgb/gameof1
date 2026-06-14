package com.gameof1

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.gameof1.databinding.ActivityGameBinding
import com.gameof1.game.GameEngine
import com.gameof1.ui.UpgradeBottomSheet

/**
 * Active gameplay screen for the Pathogen plague simulation.
 *
 * Hosts the world-map [GameView] and a top/bottom HUD showing infection
 * progress, cure progress, DNA points, and the day counter.  A 50 ms game
 * loop drives the simulation; the map view is invalidated each tick.
 */
class GameActivity : AppCompatActivity() {

    private lateinit var binding: ActivityGameBinding
    private val engine = GameEngine()
    private val handler = Handler(Looper.getMainLooper())
    private var gameRunning = false

    // ── Game loop ─────────────────────────────────────────────────────────────

    private val gameLoop = object : Runnable {
        override fun run() {
            if (!gameRunning) return
            engine.tick()
            updateHud()
            binding.gameView.invalidate()
            handler.postDelayed(this, 50L)
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityGameBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Wire the map view to the engine
        binding.gameView.engine = engine
        binding.gameView.onCountryClicked = { countryId -> handleCountryClick(countryId) }
        binding.gameView.onMapReady = { startGameLoop() }

        // Upgrade button
        binding.btnUpgrade.setOnClickListener {
            if (engine.gameState == GameEngine.GameState.RUNNING ||
                engine.gameState == GameEngine.GameState.WAITING
            ) {
                UpgradeBottomSheet(engine) { updateHud() }
                    .show(supportFragmentManager, UpgradeBottomSheet.TAG)
            }
        }

        // Restart button (shown on win/lose)
        binding.btnRestart.setOnClickListener { recreate() }
    }

    override fun onDestroy() {
        super.onDestroy()
        gameRunning = false
        handler.removeCallbacksAndMessages(null)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun startGameLoop() {
        gameRunning = true
        handler.post(gameLoop)
    }

    private fun handleCountryClick(countryId: Int) {
        when (engine.gameState) {
            GameEngine.GameState.WAITING -> {
                engine.startInfection(countryId)
                val name = engine.countries[countryId].name
                Toast.makeText(this, "Заражение началось в $name!", Toast.LENGTH_SHORT).show()
                updateHud()
            }
            GameEngine.GameState.RUNNING -> {
                val c = engine.countries[countryId]
                if (c.isDiscovered) {
                    val pct = (c.infectionPercent * 100).toInt()
                    Toast.makeText(
                        this,
                        "${c.name}: $pct% заражено (${fmt(c.infectedCount)} / ${fmt(c.population)})",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
            else -> { /* no-op on win/lose */ }
        }
    }

    private fun updateHud() {
        val infected = engine.totalInfected
        val worldPct = (engine.worldInfectionPercent * 100).toInt()
        val curePct = (engine.cureProgress * 100).toInt()

        binding.progressInfection.progress = worldPct
        binding.progressCure.progress = curePct
        binding.tvInfected.text = "🦠 $worldPct% (${fmt(infected)})"
        binding.tvCure.text = "💊 $curePct%"
        binding.tvDNA.text = "🧬 ${engine.pathogen.dnaPoints} ДНК"
        binding.tvDays.text = "📅 День ${engine.elapsedDays}"

        val hasUpgrades = engine.pathogen.getAvailableUpgrades().isNotEmpty()
        binding.btnUpgrade.alpha = if (hasUpgrades) 1.0f else 0.5f

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
