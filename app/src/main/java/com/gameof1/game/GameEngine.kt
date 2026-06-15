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

    // События
    var pendingEventMessage: String? = null
    private var eventCooldown: Int = 0
    private var whoAlertTicks: Int = 0
    private var quarantineTicks: Int = 0

    // Бегущая строка новостей
    var currentNews: String = "Мир в порядке. Угрозы не выявлено."
    private var newsIndex: Int = 0
    private val earlyNews = listOf(
        "Зафиксированы единичные случаи респираторного заболевания.",
        "ВОЗ изучает поступающие сообщения о вспышке.",
        "Врачи не бьют тревогу. Ситуация под контролем.",
        "Путешественники жалуются на самочувствие после поездок.",
        "Учёные берут пробы у заболевших для анализа."
    )
    private val midNews = listOf(
        "Число случаев резко возросло. ВОЗ обеспокоена.",
        "Больницы переполнены в нескольких регионах.",
        "Правительства вводят ограничения на въезд.",
        "Фармацевтические компании начали разработку вакцины.",
        "Паника на рынках: индексы резко падают.",
        "Аэропорты усилили санитарный контроль.",
        "Учёные установили геном патогена. Работа над вакциной ускоряется.",
        "В соцсетях волна дезинформации о происхождении вируса."
    )
    private val lateNews = listOf(
        "Глобальная пандемия! Все страны ввели режим ЧС.",
        "ООН созвала экстренное заседание по пандемии.",
        "Армия задействована для поддержания порядка в городах.",
        "Вакцина на финальной стадии испытаний — осталось немного!",
        "Международный консорциум учёных объединил усилия.",
        "Мировые лидеры призывают население к спокойствию.",
        "Больницы вводят военное положение. Коек катастрофически не хватает."
    )
    private val criticalNews = listOf(
        "🚨 КРИТИЧНО: лекарство в шаге от завершения!",
        "🚨 Вакцина будет готова в считанные дни. Время на исходе!",
        "🚨 Прорыв в исследованиях: вакцина проходит последние тесты.",
        "🚨 Учёные работают круглосуточно. Осталось совсем чуть-чуть!"
    )

    enum class GameState { WAITING, RUNNING, WON, LOST }

    val totalPopulation: Long = countries.sumOf { it.population }
    val totalInfected: Long get() = countries.sumOf { it.infectedCount }
    val worldInfectionPercent: Float
        get() = if (totalPopulation > 0) (totalInfected.toFloat() / totalPopulation.toFloat()).coerceIn(0f, 1f) else 0f

    fun startInfection(countryId: Int): Boolean {
        if (gameState != GameState.WAITING) return false
        val country = countries.getOrNull(countryId) ?: return false
        country.infectedCount = 50L
        country.isDiscovered = true
        gameState = GameState.RUNNING
        eventCooldown = 180
        return true
    }

    fun tick() {
        if (gameState != GameState.RUNNING) return
        tickCount++
        if (tickCount % 10 == 0L) elapsedDays++  // дни идут медленнее
        if (mutationBurstTicks > 0) mutationBurstTicks--
        if (whoAlertTicks > 0) whoAlertTicks--
        if (quarantineTicks > 0) quarantineTicks--

        spreadInfection()
        advanceCure()
        earnDNA()
        updatePulse()
        if (eventCooldown > 0) eventCooldown-- else triggerRandomEvent()
        if (tickCount % 55 == 0L) updateNews()
        checkWinLose()
    }

    private fun spreadInfection() {
        val snapshot = countries.map { it.infectedCount }
        val burstMult = if (mutationBurstTicks > 0) 2.5f else 1f
        val quarantineMult = if (quarantineTicks > 0) 0.55f else 1f

        for (country in countries) {
            val infected = snapshot[country.id]
            if (infected <= 0L) continue

            // Значительно снижены базовые скорости: игра теперь длиннее
            val climateMult = when (country.climate) {
                Climate.HOT        -> 0.00030f * pathogen.hotResistance
                Climate.COLD       -> 0.00022f * pathogen.coldResistance
                Climate.TEMPERATE  -> 0.00040f
                Climate.ISLAND     -> 0.00008f * pathogen.airTransmission * pathogen.islandBonus
            }
            val rate = climateMult * pathogen.spreadMultiplier * burstMult

            if (!country.isFullyInfected) {
                val gain = (infected * rate * 4f).toLong().coerceAtLeast(1L)
                country.infectedCount = (country.infectedCount + gain).coerceAtMost(country.population)
            }

            for (connId in country.connections) {
                val neighbor = countries[connId]
                val gain = (infected * rate * 0.18f * quarantineMult).toLong()
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
            val whoBoost = if (whoAlertTicks > 0) 1.6f else 1f
            val rate = 0.000038f * (1f + detectedFraction * 3.5f) * (1f - pathogen.cureResistance.coerceIn(0f, 0.85f)) * whoBoost
            cureProgress = (cureProgress + rate).coerceIn(0f, 1f)
        }
    }

    private fun earnDNA() {
        if (tickCount % 22 == 0L) pathogen.dnaPoints += pathogen.generateDNA(totalInfected)
    }

    private fun updatePulse() {
        for (c in countries) c.pulsePhase = (c.pulsePhase + 0.08f) % (2 * Math.PI.toFloat())
    }

    private fun triggerRandomEvent() {
        if (worldInfectionPercent < 0.02f) { eventCooldown = 80; return }
        eventCooldown = 110 + Random.nextInt(120)
        when (Random.nextInt(9)) {
            0 -> { pendingEventMessage = "📰 ВОЗ объявила глобальную пандемию!"; whoAlertTicks = 180 }
            1 -> { pendingEventMessage = "✈️ Авиакомпании ввели усиленный контроль"; quarantineTicks = 150 }
            2 -> { pendingEventMessage = "🔬 Прорыв в науке: новый компонент вакцины +8%"; cureProgress = (cureProgress + 0.08f).coerceIn(0f, 1f) }
            3 -> { pendingEventMessage = "🏥 Введён карантин в крупных городах"; quarantineTicks = 130 }
            4 -> { pendingEventMessage = "💉 Ускоренные клинические испытания +6%"; cureProgress = (cureProgress + 0.06f).coerceIn(0f, 1f) }
            5 -> { pendingEventMessage = "📡 Паника в СМИ — повсеместная самоизоляция"; quarantineTicks = 100 }
            6 -> { pendingEventMessage = "🧬 Вирус мутировал — учёные сбиты с толку −4%"; cureProgress = (cureProgress - 0.04f).coerceAtLeast(0f) }
            7 -> { pendingEventMessage = "🌐 Международная программа вакцинации +5%"; cureProgress = (cureProgress + 0.05f).coerceIn(0f, 1f) }
            8 -> { pendingEventMessage = "🦠 Вирус адаптировался: иммунитет ослаблен"; cureProgress = (cureProgress - 0.02f).coerceAtLeast(0f) }
        }
    }

    private fun checkWinLose() {
        if (countries.all { it.isFullyInfected }) gameState = GameState.WON
        if (cureProgress >= 1f) gameState = GameState.LOST
    }

    private fun updateNews() {
        val pool = when {
            cureProgress >= 0.75f -> criticalNews
            worldInfectionPercent >= 0.35f -> lateNews
            worldInfectionPercent >= 0.08f -> midNews
            else -> earlyNews
        }
        currentNews = pool[newsIndex % pool.size]
        newsIndex++
    }

    fun triggerMutationBurst() { mutationBurstTicks = 30 }
}
