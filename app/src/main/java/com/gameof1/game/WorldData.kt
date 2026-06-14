package com.gameof1.game

object WorldData {
    fun getCountries(): List<Country> = listOf(
        Country(0, "Канада", "CA", 38_000_000, Climate.COLD, listOf(1, 17), 0.18f, 0.13f),
        Country(1, "США", "US", 331_000_000, Climate.TEMPERATE, listOf(0, 2, 6, 17), 0.17f, 0.23f),
        Country(2, "Мексика", "MX", 130_000_000, Climate.HOT, listOf(1, 3), 0.17f, 0.34f),
        Country(3, "Колумбия", "CO", 51_000_000, Climate.HOT, listOf(2, 4), 0.22f, 0.44f),
        Country(4, "Бразилия", "BR", 215_000_000, Climate.HOT, listOf(3, 5, 13), 0.27f, 0.56f),
        Country(5, "Аргентина", "AR", 45_000_000, Climate.TEMPERATE, listOf(4), 0.25f, 0.69f),
        Country(6, "Великобритания", "GB", 67_000_000, Climate.COLD, listOf(1, 7, 8), 0.43f, 0.17f),
        Country(7, "Франция", "FR", 68_000_000, Climate.TEMPERATE, listOf(6, 8, 9, 10), 0.46f, 0.23f),
        Country(8, "Германия", "DE", 83_000_000, Climate.COLD, listOf(6, 7, 16), 0.51f, 0.19f),
        Country(9, "Испания", "ES", 47_000_000, Climate.HOT, listOf(7, 11), 0.43f, 0.29f),
        Country(10, "Италия", "IT", 60_000_000, Climate.TEMPERATE, listOf(7, 15), 0.50f, 0.28f),
        Country(11, "Марокко", "MA", 37_000_000, Climate.HOT, listOf(9, 12, 13), 0.44f, 0.37f),
        Country(12, "Египет", "EG", 104_000_000, Climate.HOT, listOf(11, 15, 17), 0.56f, 0.37f),
        Country(13, "Нигерия", "NG", 218_000_000, Climate.HOT, listOf(11, 14, 4), 0.49f, 0.49f),
        Country(14, "Южная Африка", "ZA", 60_000_000, Climate.TEMPERATE, listOf(13, 22), 0.53f, 0.63f),
        Country(15, "Турция", "TR", 85_000_000, Climate.TEMPERATE, listOf(10, 12, 16, 17), 0.59f, 0.29f),
        Country(16, "Россия", "RU", 144_000_000, Climate.COLD, listOf(8, 15, 19, 18), 0.66f, 0.14f),
        Country(17, "Саудовская Аравия", "SA", 35_000_000, Climate.HOT, listOf(12, 15, 18, 1), 0.61f, 0.40f),
        Country(18, "Индия", "IN", 1_400_000_000, Climate.HOT, listOf(16, 17, 19, 21), 0.69f, 0.43f),
        Country(19, "Китай", "CN", 1_400_000_000, Climate.TEMPERATE, listOf(16, 18, 20, 21), 0.76f, 0.28f),
        Country(20, "Япония", "JP", 126_000_000, Climate.ISLAND, listOf(19, 22), 0.85f, 0.24f),
        Country(21, "Юго-Вост. Азия", "AS", 680_000_000, Climate.HOT, listOf(18, 19, 22), 0.81f, 0.43f),
        Country(22, "Австралия", "AU", 26_000_000, Climate.ISLAND, listOf(20, 21, 14), 0.84f, 0.62f)
    )
}
