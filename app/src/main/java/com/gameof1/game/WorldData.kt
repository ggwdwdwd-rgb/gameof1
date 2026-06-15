package com.gameof1.game

object WorldData {
    // Координаты — реальные географические центры (долгота, широта в градусах)
    fun getCountries(): List<Country> = listOf(
        Country(0,  "Канада",            "🇨🇦", 38_000_000,    Climate.COLD,      listOf(1, 17),           -96f,  60f),
        Country(1,  "США",               "🇺🇸", 331_000_000,   Climate.TEMPERATE, listOf(0, 2, 6, 17),     -98f,  38f),
        Country(2,  "Мексика",           "🇲🇽", 130_000_000,   Climate.HOT,       listOf(1, 3),           -102f,  23f),
        Country(3,  "Колумбия",          "🇨🇴", 51_000_000,    Climate.HOT,       listOf(2, 4),            -74f,   4f),
        Country(4,  "Бразилия",          "🇧🇷", 215_000_000,   Climate.HOT,       listOf(3, 5, 13),        -52f, -10f),
        Country(5,  "Аргентина",         "🇦🇷", 45_000_000,    Climate.TEMPERATE, listOf(4),               -64f, -34f),
        Country(6,  "Великобритания",    "🇬🇧", 67_000_000,    Climate.COLD,      listOf(1, 7, 8),          -2f,  54f),
        Country(7,  "Франция",           "🇫🇷", 68_000_000,    Climate.TEMPERATE, listOf(6, 8, 9, 10),       3f,  46f),
        Country(8,  "Германия",          "🇩🇪", 83_000_000,    Climate.COLD,      listOf(6, 7, 16),          10f,  51f),
        Country(9,  "Испания",           "🇪🇸", 47_000_000,    Climate.HOT,       listOf(7, 11),             -4f,  40f),
        Country(10, "Италия",            "🇮🇹", 60_000_000,    Climate.TEMPERATE, listOf(7, 15),             12f,  43f),
        Country(11, "Марокко",           "🇲🇦", 37_000_000,    Climate.HOT,       listOf(9, 12, 13),         -7f,  31f),
        Country(12, "Египет",            "🇪🇬", 104_000_000,   Climate.HOT,       listOf(11, 15, 17),        30f,  26f),
        Country(13, "Нигерия",           "🇳🇬", 218_000_000,   Climate.HOT,       listOf(11, 14, 4),          8f,   9f),
        Country(14, "Южная Африка",      "🇿🇦", 60_000_000,    Climate.TEMPERATE, listOf(13, 22),             25f, -29f),
        Country(15, "Турция",            "🇹🇷", 85_000_000,    Climate.TEMPERATE, listOf(10, 12, 16, 17),    35f,  39f),
        Country(16, "Россия",            "🇷🇺", 144_000_000,   Climate.COLD,      listOf(8, 15, 19, 18),    100f,  60f),
        Country(17, "Саудовская Аравия", "🇸🇦", 35_000_000,    Climate.HOT,       listOf(12, 15, 18, 1),     45f,  24f),
        Country(18, "Индия",             "🇮🇳", 1_400_000_000, Climate.HOT,       listOf(16, 17, 19, 21),    78f,  20f),
        Country(19, "Китай",             "🇨🇳", 1_400_000_000, Climate.TEMPERATE, listOf(16, 18, 20, 21),   104f,  35f),
        Country(20, "Япония",            "🇯🇵", 126_000_000,   Climate.ISLAND,    listOf(19, 22),            138f,  37f),
        Country(21, "Юго-Вост. Азия",   "🌏",  680_000_000,   Climate.HOT,       listOf(18, 19, 22),        108f,  12f),
        Country(22, "Австралия",         "🇦🇺", 26_000_000,    Climate.ISLAND,    listOf(20, 21, 14),        133f, -25f)
    )
}
