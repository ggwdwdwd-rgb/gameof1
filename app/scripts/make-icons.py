#!/usr/bin/env python3
"""
Иконки приложения Cry: чёрно-белый знак — раскрытое кольцо с хвостиком.

Запуск из папки app:  python3 scripts/make-icons.py
Нужен Pillow (pip install Pillow). Перезаписывает файлы в assets/.

Знак читается двояко и намеренно: это и «C», и облачко реплики. Геометрия
рисуется вычислениями, а не шрифтом, — результат не зависит от того, какие
шрифты есть в системе сборки.

Почему одним скриптом: иконок шесть, и правила у них разные — у адаптивной
иконки Android внешние 33% срезает маска, монохромной нужен силуэт на
прозрачном, splash идёт без фона. Собранные по отдельности, они расходятся при
любой правке, и «почему у монохромной другой наклон хвоста» потом не выяснить.
Здесь один источник геометрии на все шесть.

Цвета — те же, что в интерфейсе (src/theme/theme.ts): чистый чёрный фон, белый
знак. Прежняя иконка была терракотовой, от прошлой палитры; после перехода на
монохром она осталась единственным цветным пятном и выглядела чужой.
"""

from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw

BLACK = (10, 10, 10, 255)  # #0a0a0a — тот же, что theme.colors.accent в светлой теме
WHITE = (255, 255, 255, 255)

# Рисуем с восьмикратным запасом и уменьшаем: PIL не сглаживает контуры сам, а на
# иконке 48 px ступеньки видны сразу.
SS = 8

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")


def draw_mark(size: int, glyph: tuple[int, int, int, int], scale: float) -> Image.Image:
    """
    Знак на прозрачном фоне.

    `scale` — доля стороны, которую занимает кольцо. У адаптивной иконки Android
    знак мельче: внешние 33% обрезаются любой формой маски.
    """
    big = size * SS
    cx = cy = big / 2
    r_out = big * scale / 2
    # Толщина кольца — 0.42 внешнего радиуса. Тоньше — «C» рассыпается на мелких
    # размерах; толще — превращается в пятно с точкой посередине.
    r_in = r_out * 0.58

    # Собираем в маску, а не заливкой по фону: вырез кольца должен быть честно
    # прозрачным — знак нужен и поверх обоев (splash, монохромная иконка).
    mask = Image.new("L", (big, big), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out], fill=255)
    md.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in], fill=0)

    # Раскрываем кольцо справа — получается «C». Вырезаем клин от центра, а не
    # прямоугольник: по хорде концы «C» вышли бы скошенными.
    half_angle = 31
    far = big * 2
    wedge = [(cx, cy)]
    for a in range(-half_angle, half_angle + 1, 2):
        rad = math.radians(a)
        wedge.append((cx + far * math.cos(rad), cy + far * math.sin(rad)))
    md.polygon(wedge, fill=0)

    # Хвостик облачка снизу-слева. Две вершины лежат на самом кольце, третья —
    # снаружи, поэтому стыка не видно и хвост читается как часть знака.
    # Основание лежит РОВНО на внешней окружности (множитель 1.0). Стоит уйти
    # внутрь — и в месте стыка появляется залом: край треугольника врезается в
    # кольцо, вместо того чтобы продолжать его контур.
    base_angle = math.radians(150)
    base = r_out
    spread = 0.26
    md.polygon(
        [
            (cx + base * math.cos(base_angle - spread), cy + base * math.sin(base_angle - spread)),
            (cx + base * math.cos(base_angle + spread), cy + base * math.sin(base_angle + spread)),
            (cx + r_out * 1.34 * math.cos(base_angle), cy + r_out * 1.34 * math.sin(base_angle)),
        ],
        fill=255,
    )

    # Скруглённые концы «C»: кружки на срезах клина. Без них знак выглядит
    # обрубленным — это та же разница, что между stroke-linecap round и butt.
    r_mid = (r_out + r_in) / 2
    cap = (r_out - r_in) / 2
    for a in (-half_angle, half_angle):
        rad = math.radians(a)
        ex, ey = cx + r_mid * math.cos(rad), cy + r_mid * math.sin(rad)
        md.ellipse([ex - cap, ey - cap, ex + cap, ey + cap], fill=255)

    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    img.paste(glyph, (0, 0), mask)
    return img.resize((size, size), Image.LANCZOS)


def rounded_square(size: int, radius_ratio: float, color: tuple[int, int, int, int]) -> Image.Image:
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, big - 1, big - 1], radius=big * radius_ratio, fill=color)
    return img.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, name: str) -> None:
    path = os.path.join(ASSETS, name)
    img.save(path, "PNG")
    print(f"  {name}: {img.size[0]}×{img.size[1]}, {os.path.getsize(path) // 1024} КБ")


def main() -> None:
    print("Иконки Cry →", ASSETS)

    # icon.png — основная. Без прозрачности и без своих скруглений: iOS и
    # магазины накладывают маску сами, а прозрачность даёт у них чёрный ореол.
    icon = Image.new("RGBA", (1024, 1024), BLACK)
    icon.alpha_composite(draw_mark(1024, WHITE, 0.56))
    save(icon, "icon.png")

    # Адаптивная иконка Android: фон и передний план отдельными слоями, между
    # ними система делает параллакс при наклоне.
    save(rounded_square(1024, 0.5, BLACK), "android-icon-background.png")
    save(draw_mark(1024, WHITE, 0.40), "android-icon-foreground.png")

    # Монохромная (тематические иконки Android 13+): систему интересует только
    # силуэт, она сама красит его в цвет обоев.
    save(draw_mark(1024, WHITE, 0.40), "android-icon-monochrome.png")

    # Splash: знак на прозрачном, фон задаёт app.json под каждую тему.
    save(draw_mark(1024, WHITE, 0.62), "splash-icon.png")

    # Favicon: 64 px — больше в табе браузера не нужно.
    fav = Image.new("RGBA", (64, 64), BLACK)
    fav.alpha_composite(draw_mark(64, WHITE, 0.60))
    save(fav, "favicon.png")

    # Предпросмотр в мелких размерах: знак надо смотреть таким, каким его видно
    # на телефоне, а не в 1024 px.
    preview = Image.new("RGBA", (340, 96), (150, 150, 150, 255))
    for i, s in enumerate((48, 72, 96)):
        cell = Image.new("RGBA", (s, s), BLACK)
        cell.alpha_composite(draw_mark(s, WHITE, 0.56))
        preview.alpha_composite(cell, (20 + i * 105, (96 - s) // 2))
    preview.save("/tmp/icon-preview.png")
    print("  предпросмотр 48/72/96 → /tmp/icon-preview.png")


if __name__ == "__main__":
    main()
