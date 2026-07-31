"""Иконки приложения Cry: тёплый терракотовый градиент Claude и знак «C».

Запуск из папки app:  python3 scripts/make-icons.py
Нужен Pillow (pip install Pillow). Перезаписывает файлы в assets/.

Буква рисуется геометрически (толстая дуга с разрывом справа), а не шрифтом —
так результат не зависит от того, какие шрифты есть в системе сборки.
Рисуем с четырёхкратным разрешением и уменьшаем — даёт мягкие края.
"""

from PIL import Image, ImageDraw

SS = 4  # супер-сэмплинг
FROM_COLOR = (231, 149, 114)  # #e79572
TO_COLOR = (194, 95, 56)  # #c25f38


def gradient(size, top, bottom):
    """Вертикальный градиент size x size."""
    img = Image.new("RGB", (1, size))
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((size, size), Image.NEAREST)


def draw_c(size, color, scale=0.60, thickness_ratio=0.112):
    """Знак «C» на прозрачном фоне: дуга с разрывом справа и скруглёнными концами."""
    big = size * SS
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    diameter = big * scale
    width = big * thickness_ratio
    left = (big - diameter) / 2
    top = (big - diameter) / 2
    box = [left, top, left + diameter, top + diameter]

    # Разрыв справа: от -52° до +52° (0° — направление вправо).
    d.arc(box, start=52, end=308, fill=color, width=round(width))

    # Скруглённые концы дуги — кружки на её краях.
    import math

    # PIL рисует дугу внутрь от рамки, поэтому центр линии лежит на радиусе
    # (diameter - width) / 2 — иначе кружки-концы вылезают за саму дугу.
    radius = (diameter - width) / 2
    cx, cy = big / 2, big / 2
    for angle in (52, 308):
        rad = math.radians(angle)
        ex = cx + radius * math.cos(rad)
        ey = cy + radius * math.sin(rad)
        r = width / 2
        d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=color)

    return layer.resize((size, size), Image.LANCZOS)


def rounded_mask(size, radius_ratio=0.235):
    big = size * SS
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=big * radius_ratio, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def save(img, path):
    img.save(path, "PNG")
    print("записан", path)


ASSETS = "assets"

# 1. icon.png — полноразмерный квадрат: систему скругляет сама.
size = 1024
base = gradient(size, FROM_COLOR, TO_COLOR).convert("RGBA")
base.alpha_composite(draw_c(size, (255, 255, 255, 255)))
save(base, f"{ASSETS}/icon.png")

# 2. Android adaptive icon: фон и передний план отдельно.
#    У переднего плана безопасная зона — центральные ~66%, поэтому знак мельче.
save(gradient(size, FROM_COLOR, TO_COLOR).convert("RGBA"), f"{ASSETS}/android-icon-background.png")

fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
fg.alpha_composite(draw_c(size, (255, 255, 255, 255), scale=0.40, thickness_ratio=0.075))
save(fg, f"{ASSETS}/android-icon-foreground.png")

mono = Image.new("RGBA", (size, size), (0, 0, 0, 0))
mono.alpha_composite(draw_c(size, (255, 255, 255, 255), scale=0.40, thickness_ratio=0.075))
save(mono, f"{ASSETS}/android-icon-monochrome.png")

# 3. splash-icon.png — знак на прозрачном фоне, цвет фона задаёт Expo.
splash = Image.new("RGBA", (size, size), (0, 0, 0, 0))
mark = gradient(size, FROM_COLOR, TO_COLOR).convert("RGBA")
mark.putalpha(rounded_mask(size))
inner = Image.new("RGBA", (size, size), (0, 0, 0, 0))
inner.alpha_composite(mark.resize((round(size * 0.56), round(size * 0.56)), Image.LANCZOS),
                      (round(size * 0.22), round(size * 0.22)))
inner.alpha_composite(draw_c(size, (255, 255, 255, 255), scale=0.28, thickness_ratio=0.052))
save(inner, f"{ASSETS}/splash-icon.png")

# 4. favicon.png для web-варианта.
fav = base.resize((64, 64), Image.LANCZOS)
fav.putalpha(rounded_mask(64, radius_ratio=0.2))
save(fav, f"{ASSETS}/favicon.png")
