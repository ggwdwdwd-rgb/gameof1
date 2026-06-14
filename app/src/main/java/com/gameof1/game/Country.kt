package com.gameof1.game

enum class Climate { HOT, TEMPERATE, COLD, ISLAND }

data class Country(
    val id: Int,
    val name: String,
    val flag: String,
    val population: Long,
    val climate: Climate,
    val connections: List<Int>,
    val x: Float,
    val y: Float,
    var infectedCount: Long = 0,
    var isDiscovered: Boolean = false,
    var pulsePhase: Float = 0f
) {
    val infectionPercent: Float
        get() = if (population > 0) (infectedCount.toFloat() / population.toFloat()).coerceIn(0f, 1f) else 0f

    val isFullyInfected: Boolean
        get() = infectedCount >= population

    fun getColor(): Int {
        return when {
            !isDiscovered -> 0xFF1A2A3A.toInt()
            infectionPercent <= 0f -> 0xFF0D4F5A.toInt()
            infectionPercent < 0.3f -> 0xFFFF6600.toInt()
            infectionPercent < 0.7f -> 0xFFCC2200.toInt()
            else -> 0xFFFF0000.toInt()
        }
    }
}
