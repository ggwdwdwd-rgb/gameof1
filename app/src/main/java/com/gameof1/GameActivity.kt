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

class GameActivity : AppCompatActivity() {

    private lateinit var binding: ActivityGameBinding
    private val engine = GameEngine()
    private val handler = Handler(Looper.getMainLooper())
    private var gameRunning = false

    private val gameLoop = object : Runnable {
        override fun run() {
            if (!gameRunning) return
            engine.tick()
            updateUI()
            binding.gameView.invalidate()
            handler.postDelayed(this, 50)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityGameBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.gameView.engine = engine
        binding.gameView.onCountryClicked = { countryId -> handleCountryClick(countryId) }
        binding.gameView.onMapReady = { startGameLoop() }

        binding.btnUpgrade.setOnClickListener {
            if (engine.gameState == GameEngine.GameState.RUNNING ||
                engine.gameState == GameEngine.GameState.WAITING) {
                UpgradeBottomSheet(engine) { updateUI() }.show(supportFragmentManager, "upgrades")
            }
        }

        binding.btnRestart.setOnClickListener {
            recreate()
        }
    }

    private fun handleCountryClick(countryId: Int) {
        when (engine.gameState) {
            GameEngine.GameState.WAITING -> {
                engine.startInfection(countryId)
                val country = engine.countries[countryId]
                Toast.makeText(this, "Заражение началось в ${country.name}!", Toast.LENGTH_SHORT).show()
                updateUI()
            }
            GameEngine.GameState.RUNNING -> {
                val country = engine.countries[countryId]
                if (country.isDiscovered) {
                    val msg = "${country.name}: ${(country.infectionPercent * 100).toInt()}% заражено (${formatNumber(country.infectedCount)} / ${formatNumber(country.population)})"
                    Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
                }
            }
            else -> {}
        }
    }

    private fun startGameLoop() {
        gameRunning = true
        handler.post(gameLoop)
    }

    private fun updateUI() {
        val infected = engine.totalInfected
        val worldPct = (engine.worldInfectionPercent * 100).toInt()
        val curePct = (engine.cureProgress * 100).toInt()

        binding.progressInfection.progress = worldPct
        binding.progressCure.progress = curePct
        binding.tvInfected.text = "$worldPct% (${formatNumber(infected)})"
        binding.tvCure.text = "$curePct%"
        binding.tvDNA.text = "${engine.pathogen.dnaPoints} DNA"
        binding.tvDays.text = "День ${engine.elapsedDays}"

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

    private fun formatNumber(n: Long): String = when {
        n >= 1_000_000_000L -> "${n / 1_000_000_000L}.${(n % 1_000_000_000L) / 100_000_000L}B"
        n >= 1_000_000L -> "${n / 1_000_000L}.${(n % 1_000_000L) / 100_000L}M"
        n >= 1_000L -> "${n / 1_000L}K"
        else -> n.toString()
    }

    override fun onDestroy() {
        super.onDestroy()
        gameRunning = false
        handler.removeCallbacksAndMessages(null)
    }
}
