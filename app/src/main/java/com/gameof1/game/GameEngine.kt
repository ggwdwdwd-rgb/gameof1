package com.gameof1.game

import kotlin.random.Random

class GameEngine {
    val countries: MutableList<Country> = WorldData.getCountries().toMutableList()
    val pathogen = Pathogen()

    var cureProgress: Float = 0f
    var gameState: GameState = GameState.WAITING
    var elapsedDays: Int = 0
    var tickCount: Long = 0L
    var mutationBurstTicks: Int = 0

    // Events
    var pendingEventMessage: String? = null
    private var eventCooldown: Int = 0
    private var whoAlertTicks: Int = 0     // WHO alert: boosts cure speed
    private var quarantineTicks: Int = 0   // Quarantine: slows cross-border

    enum class GameState { WAITING, RUNNING, WON, LOST }

    val totalPopulation: Long = countries.sumOf { it.population }
    val totalInfected: Long get() = countries.sumOf { it.infectedCount }
    val worldInfectionPercent: Float
        get() = if (totalPopulation > 0) (totalInfected.toFloat() / totalPopulation.toFloat()).coerceIn(0f, 1f) else 0f

    fun startInfection(countryId: Int): Boolean {
        if (gameState != GameState.WAITING) return false
        val country = countries.getOrNull(countryId) ?: return false
        country.infectedCount = 100L
        country.isDiscovered = true
        gameState = GameState.RUNNING
        eventCooldown = 120
        return true
    }

    fun tick() {
        if (gameState != GameState.RUNNING) return
        tickCount++
        if (tickCount % 8 == 0L) elapsedDays++
        if (mutationBurstTicks > 0) mutationBurstTicks--
        if (whoAlertTicks > 0) whoAlertTicks--
        if (quarantineTicks > 0) quarantineTicks--

        spreadInfection()
        advanceCure()
        earnDNA()
        updatePulse()
        if (eventCooldown > 0) eventCooldown-- else triggerRandomEvent()
        checkWinLose()
    }

    private fun spreadInfection() {
        val snapshot = countries.map { it.infectedCount }
        val burstMult = if (mutationBurstTicks > 0) 3f else 1f
        val quarantineMult = if (quarantineTicks > 0) 0.62f else 1f

        for (country in countries) {
            val infected = snapshot[country.id]
            if (infected <= 0L) continue

            val climateMult = when (country.climate) {
                Climate.HOT        -> 0.0012f * pathogen.hotResistance
                Climate.COLD       -> 0.0009f * pathogen.coldResistance
                Climate.TEMPERATE  -> 0.0015f
                Climate.ISLAND     -> 0.0004f * pathogen.airTransmission * pathogen.islandBonus
            }
            val rate = climateMult * pathogen.spreadMultiplier * burstMult

            if (!country.isFullyInfected) {
                val gain = (infected * rate * 4f).toLong().coerceAtLeast(1L)
                country.infectedCount = (country.infectedCount + gain).coerceAtMost(country.population)
            }

            for (connId in country.connections) {
                val neighbor = countries[connId]
                val gain = (infected * rate * 0.25f * quarantineMult).toLong()
                if (gain > 0) {
                    neighbor.infectedCount = (neighbor.infectedCount + gain).coerceAtMost(neighbor.population)
                    if (neighbor.infectedCount > 0) neighbor.isDiscovered = true
                }
            }
        }
    }

    private fun advanceCure() {
        if (worldInfectionPercent > 0.001f) {
            val detectedFraction = countries.count { it.isDiscovered && it.infectionPercent > 0.01f }.toFloat() / countries.size
            val whoBoost = if (whoAlertTicks > 0) 1.55f else 1f
            // Harder than before: base rate 0.000055 (was 0.000035)
            val rate = 0.000055f * (1f + detectedFraction * 3f) * (1f - pathogen.cureResistance.coerceIn(0f, 0.85f)) * whoBoost
            cureProgress = (cureProgress + rate).coerceIn(0f, 1f)
        }
    }

    private fun earnDNA() {
        if (tickCount % 15 == 0L) pathogen.dnaPoints += pathogen.generateDNA(totalInfected)
    }

    private fun updatePulse() {
        for (c in countries) c.pulsePhase = (c.pulsePhase + 0.08f) % (2 * Math.PI.toFloat())
    }

    private fun triggerRandomEvent() {
        if (worldInfectionPercent < 0.025f) { eventCooldown = 60; return }
        eventCooldown = 90 + Random.nextInt(110)
        when (Random.nextInt(8)) {
            0 -> { pendingEventMessage = "📰 ВОЗ объявила глобальную пандемию!"; whoAlertTicks = 160 }
            1 -> { pendingEventMessage = "✈️ Авиакомпании ввели усиленный контроль"; quarantineTicks = 130 }
            2 -> { pendingEventMessage = "🔬 Прорыв в науке: новый компонент вакцины +8%"; cureProgress = (cureProgress + 0.08f).coerceIn(0f, 1f) }
            3 -> { pendingEventMessage = "🏥 Введён карантин в крупных городах"; quarantineTicks = 110 }
            4 -> { pendingEventMessage = "💉 Ускоренные клинические испытания +6%"; cureProgress = (cureProgress + 0.06f).coerceIn(0f, 1f) }
            5 -> { pendingEventMessage = "📡 Паника в СМИ — повсеместная самоизоляция"; quarantineTicks = 90 }
            6 -> { pendingEventMessage = "🧬 Вирус мутировал — учёные сбиты с толку −3%"; cureProgress = (cureProgress - 0.03f).coerceAtLeast(0f) }
            7 -> { pendingEventMessage = "🌐 Международная программа вакцинации +5%"; cureProgress = (cureProgress + 0.05f).coerceIn(0f, 1f) }
        }
    }

    private fun checkWinLose() {
        if (countries.all { it.isFullyInfected }) gameState = GameState.WON
        if (cureProgress >= 1f) gameState = GameState.LOST
    }

    fun triggerMutationBurst() { mutationBurstTicks = 30 }
}
