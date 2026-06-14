package com.gameof1.game

class Pathogen {
    var dnaPoints: Int = 0
    var spreadMultiplier: Float = 1.0f
    var cureResistance: Float = 0f
    var severityMultiplier: Float = 1.0f
    var coldResistance: Float = 1.0f
    var hotResistance: Float = 1.0f
    var airTransmission: Float = 1.0f
    var islandBonus: Float = 1.0f

    val upgrades: List<Upgrade> = listOf(
        Upgrade("air1", "Аэрозоль", "Распространяется по воздуху +50%", 25, Upgrade.Category.TRANSMISSION, "💨"),
        Upgrade("water1", "Водный путь", "Через воду и канализацию +30%", 20, Upgrade.Category.TRANSMISSION, "💧"),
        Upgrade("cold1", "Холодостойкость", "Выживает в морозном климате ×2", 30, Upgrade.Category.TRANSMISSION, "❄️"),
        Upgrade("heat1", "Жаростойкость", "Выживает в жарком климате ×2", 30, Upgrade.Category.TRANSMISSION, "🔥"),
        Upgrade("bird1", "Птичий вектор", "Перелётные птицы переносят вирус +40%", 40, Upgrade.Category.TRANSMISSION, "🦅"),
        Upgrade("air2", "Экстремальный аэрозоль", "Воздушная передача ×3", 60, Upgrade.Category.TRANSMISSION, "🌫️", listOf("air1")),
        Upgrade("island1", "Морские течения", "Заражает острова через воду", 35, Upgrade.Category.TRANSMISSION, "🌊"),

        Upgrade("sym1", "Кашель", "Ускоряет контактное заражение +20%", 15, Upgrade.Category.SEVERITY, "😷"),
        Upgrade("sym2", "Геморрагия", "Больше очков ДНК × 1.5", 35, Upgrade.Category.SEVERITY, "🩸", listOf("sym1")),
        Upgrade("res1", "Лекарственная стойкость", "Замедляет разработку лекарства на 20%", 45, Upgrade.Category.SEVERITY, "💊"),
        Upgrade("res2", "Полная стойкость", "Замедляет разработку лекарства на 40%", 65, Upgrade.Category.SEVERITY, "🧬", listOf("res1")),
        Upgrade("mut1", "Генетическое укрепление", "Уклонение от иммунитета +15%", 40, Upgrade.Category.SEVERITY, "🔬"),

        Upgrade("abil1", "Вспышка мутаций", "Скорость заражения ×3 на 15 секунд", 30, Upgrade.Category.ABILITY, "⚡"),
        Upgrade("abil2", "Латентность", "Скрывается от учёных -30% прогресс лекарства", 40, Upgrade.Category.ABILITY, "👁️"),
        Upgrade("abil3", "Хаос", "Нарушает карантинные меры -20%", 55, Upgrade.Category.ABILITY, "💀"),
        Upgrade("abil4", "Биоплёнка", "Стойкость к антибиотикам +25%", 45, Upgrade.Category.ABILITY, "🧪")
    )

    private val unlockedIds: Set<String> get() = upgrades.filter { it.unlocked }.map { it.id }.toSet()

    fun getAvailableUpgrades(): List<Upgrade> = upgrades.filter { it.isAvailable(unlockedIds) }

    fun purchaseUpgrade(upgradeId: String): Boolean {
        val upgrade = upgrades.find { it.id == upgradeId } ?: return false
        if (!upgrade.isAvailable(unlockedIds)) return false
        if (upgrade.cost > dnaPoints) return false
        dnaPoints -= upgrade.cost
        upgrade.unlocked = true
        applyUpgrade(upgrade)
        return true
    }

    private fun applyUpgrade(upgrade: Upgrade) {
        when (upgrade.id) {
            "air1" -> { airTransmission *= 1.5f; spreadMultiplier *= 1.2f }
            "air2" -> { airTransmission *= 2.0f; spreadMultiplier *= 1.5f }
            "water1" -> spreadMultiplier *= 1.3f
            "cold1" -> coldResistance = 2.0f
            "heat1" -> hotResistance = 2.0f
            "bird1" -> spreadMultiplier *= 1.4f
            "island1" -> { islandBonus = 3.0f; spreadMultiplier *= 1.1f }
            "sym1" -> spreadMultiplier *= 1.2f
            "sym2" -> severityMultiplier *= 1.5f
            "res1" -> cureResistance += 0.2f
            "res2" -> cureResistance += 0.4f
            "mut1" -> spreadMultiplier *= 1.15f
            "abil1" -> spreadMultiplier *= 3.0f
            "abil2" -> cureResistance += 0.3f
            "abil3" -> cureResistance += 0.2f
            "abil4" -> cureResistance += 0.25f
        }
    }

    fun generateDNA(totalInfected: Long): Int {
        val base = (totalInfected / 8_000_000L).toInt()
        return (base * severityMultiplier).toInt().coerceAtLeast(0)
    }
}
