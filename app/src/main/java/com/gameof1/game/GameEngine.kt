package com.gameof1.game

class GameEngine {
    val countries: MutableList<Country> = WorldData.getCountries().toMutableList()
    val pathogen = Pathogen()

    var cureProgress: Float = 0f
    var gameState: GameState = GameState.WAITING
    var elapsedDays: Int = 0
    var tickCount: Long = 0L
    var mutationBurstTicks: Int = 0

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
        return true
    }

    fun tick() {
        if (gameState != GameState.RUNNING) return
        tickCount++
        if (tickCount % 8 == 0L) elapsedDays++
        if (mutationBurstTicks > 0) mutationBurstTicks--

        spreadInfection()
        advanceCure()
        earnDNA()
        updatePulse()
        checkWinLose()
    }

    private fun spreadInfection() {
        val snapshot = countries.map { it.infectedCount }
        val burstMult = if (mutationBurstTicks > 0) 3f else 1f

        for (country in countries) {
            val infected = snapshot[country.id]
            if (infected <= 0) continue

            val climateMult = when (country.climate) {
                Climate.HOT -> 0.0012f * pathogen.hotResistance
                Climate.COLD -> 0.0009f * pathogen.coldResistance
                Climate.TEMPERATE -> 0.0015f
                Climate.ISLAND -> 0.0004f * pathogen.airTransmission * pathogen.islandBonus
            }
            val rate = climateMult * pathogen.spreadMultiplier * burstMult

            // Intra-country spread
            if (!country.isFullyInfected) {
                val gain = ((infected * rate * 4f)).toLong().coerceAtLeast(1L)
                country.infectedCount = (country.infectedCount + gain).coerceAtMost(country.population)
            }

            // Cross-border spread
            for (connId in country.connections) {
                val neighbor = countries[connId]
                val crossRate = rate * 0.25f
                val gain = (infected * crossRate).toLong()
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
            val cureRate = 0.000035f * (1f + detectedFraction * 3f) * (1f - pathogen.cureResistance.coerceIn(0f, 0.85f))
            cureProgress = (cureProgress + cureRate).coerceIn(0f, 1f)
        }
    }

    private fun earnDNA() {
        if (tickCount % 15 == 0L) {
            pathogen.dnaPoints += pathogen.generateDNA(totalInfected)
        }
    }

    private fun updatePulse() {
        for (country in countries) {
            country.pulsePhase = (country.pulsePhase + 0.08f) % (2 * Math.PI.toFloat())
        }
    }

    private fun checkWinLose() {
        if (countries.all { it.isFullyInfected }) {
            gameState = GameState.WON
        }
        if (cureProgress >= 1f) {
            gameState = GameState.LOST
        }
    }

    fun triggerMutationBurst() {
        mutationBurstTicks = 30
    }
}
