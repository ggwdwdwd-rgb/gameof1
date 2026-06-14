package com.gameof1.game

data class Upgrade(
    val id: String,
    val name: String,
    val description: String,
    val cost: Int,
    val category: Category,
    val icon: String,
    val requires: List<String> = emptyList(),
    var unlocked: Boolean = false
) {
    enum class Category(val displayName: String) {
        TRANSMISSION("Передача"),
        SEVERITY("Тяжесть"),
        ABILITY("Способности")
    }

    fun isAvailable(unlockedIds: Set<String>): Boolean =
        !unlocked && requires.all { it in unlockedIds }
}
