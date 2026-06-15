package com.gameof1.game

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import kotlin.math.*
import kotlin.random.Random

class GameView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    var engine: GameEngine? = null
    var onCountryClicked: ((Int) -> Unit)? = null
    var onMapReady: (() -> Unit)? = null
    var selectedCountryId: Int = -1

    // Zoom / pan
    private var zoom = 1f
    private var panX = 0f
    private var panY = 0f
    private var dragStartX = 0f
    private var dragStartY = 0f
    private var panStartX = 0f
    private var panStartY = 0f
    private var dragged = false
    private val scaleDetector: ScaleGestureDetector

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.DEFAULT_BOLD
        textAlign = Paint.Align.CENTER
    }
    private val connPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    private var mapW = 0f
    private var mapH = 0f
    private var anim = 0f
    private var lastGlowZoom = -1f

    // Starfield (экранные координаты, не масштабируется)
    private class Star(val x: Float, val y: Float, val r: Float, val phase: Float)
    private val stars = ArrayList<Star>(130)

    // Частицы заражения (мировые координаты)
    private class Particle(val sx: Float, val sy: Float, val ex: Float, val ey: Float, var t: Float = 0f) {
        val x get() = sx + (ex - sx) * t
        val y get() = sy + (ey - sy) * t
        val done get() = t >= 1f
    }
    private val particles = ArrayList<Particle>(80)

    // Всплывающий текст (мировые координаты)
    private class FloatText(var x: Float, var y: Float, val text: String, val color: Int, var alpha: Int = 255)
    private val floatTexts = ArrayList<FloatText>(16)

    // Заранее выделенный Path для кривых линий
    private val curvePath = Path()

    init {
        setLayerType(LAYER_TYPE_SOFTWARE, null)
        scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(det: ScaleGestureDetector): Boolean {
                val prev = zoom
                zoom = (zoom * det.scaleFactor).coerceIn(0.7f, 5f)
                panX = det.focusX - (det.focusX - panX) * (zoom / prev)
                panY = det.focusY - (det.focusY - panY) * (zoom / prev)
                clampPan()
                invalidate()
                return true
            }
        })
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        mapW = w.toFloat(); mapH = h.toFloat()
        buildStars()
        onMapReady?.invoke()
    }

    private fun buildStars() {
        stars.clear()
        val rng = Random(42L)
        repeat(130) { stars += Star(rng.nextFloat() * mapW, rng.nextFloat() * mapH, 0.4f + rng.nextFloat() * 2.2f, rng.nextFloat() * (2 * PI).toFloat()) }
    }

    private fun clampPan() {
        val mx = mapW * (zoom - 1f) * 0.65f + mapW * 0.18f
        val my = mapH * (zoom - 1f) * 0.65f + mapH * 0.18f
        panX = panX.coerceIn(-mx, mx)
        panY = panY.coerceIn(-my, my)
    }

    // Мировые пиксели
    private fun wx(x: Float) = x * mapW
    private fun wy(y: Float) = y * mapH

    // Радиус страны по населению (логарифмическая шкала)
    private fun getR(pop: Long): Float {
        val t = ((ln(pop.coerceAtLeast(1L).toFloat()) - ln(20_000_000f)) / (ln(1_400_000_000f) - ln(20_000_000f))).coerceIn(0f, 1f)
        return 20f + t * 22f
    }

    fun addFloatText(countryId: Int, text: String, color: Int) {
        val c = engine?.countries?.getOrNull(countryId) ?: return
        floatTexts += FloatText(wx(c.x), wy(c.y) - getR(c.population) - 6f, text, color)
    }

    fun update() {
        anim += 0.04f
        val eng = engine
        if (eng != null && eng.gameState == GameEngine.GameState.RUNNING && Random.nextFloat() < 0.22f) {
            val src = eng.countries.filter { it.infectedCount > 300L }.randomOrNull()
            val dstId = src?.connections?.randomOrNull()
            if (src != null && dstId != null && !eng.countries[dstId].isFullyInfected) {
                particles += Particle(wx(src.x), wy(src.y), wx(eng.countries[dstId].x), wy(eng.countries[dstId].y))
            }
        }
        val pi = particles.iterator(); while (pi.hasNext()) { if (pi.next().also { it.t += 0.026f }.done) pi.remove() }
        val fi = floatTexts.iterator(); while (fi.hasNext()) { val ft = fi.next(); ft.y -= 2.5f; ft.alpha -= 5; if (ft.alpha <= 0) fi.remove() }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val eng = engine ?: return
        if (mapW == 0f) return

        drawBackground(canvas)
        drawStars(canvas)

        // Обновить фильтр свечения при изменении масштаба
        if (abs(zoom - lastGlowZoom) > 0.08f) {
            glowPaint.maskFilter = BlurMaskFilter((30f / zoom).coerceIn(6f, 40f), BlurMaskFilter.Blur.NORMAL)
            lastGlowZoom = zoom
        }

        canvas.save()
        canvas.translate(panX, panY)
        canvas.scale(zoom, zoom)

        drawOceanGrid(canvas)
        drawContinentHints(canvas)
        drawConnections(canvas, eng)
        drawParticles(canvas)
        for (c in eng.countries) drawCountry(canvas, c)
        drawSelectedRing(canvas, eng)
        drawLabels(canvas, eng)
        drawFloatTexts(canvas)

        canvas.restore()

        // Оверлеи в экранных координатах
        when (eng.gameState) {
            GameEngine.GameState.WON     -> drawEndOverlay(canvas, "🏆 ПОБЕДА!", Color.parseColor("#00FF88"), "Человечество заражено!")
            GameEngine.GameState.LOST    -> drawEndOverlay(canvas, "💀 ПОРАЖЕНИЕ", Color.parseColor("#FF4444"), "Лекарство создано. Вы проиграли.")
            GameEngine.GameState.WAITING -> drawStartPrompt(canvas)
            else -> {}
        }

        if (zoom > 1.12f) drawZoomIndicator(canvas)
    }

    private fun drawBackground(canvas: Canvas) {
        paint.shader = RadialGradient(mapW / 2, mapH / 2, maxOf(mapW, mapH) * 0.8f,
            Color.parseColor("#041020"), Color.parseColor("#020810"), Shader.TileMode.CLAMP)
        paint.style = Paint.Style.FILL
        canvas.drawRect(0f, 0f, mapW, mapH, paint)
        paint.shader = null
    }

    private fun drawStars(canvas: Canvas) {
        paint.style = Paint.Style.FILL
        for (s in stars) {
            val b = ((sin((anim * 0.37f + s.phase).toDouble()) + 1.0) / 2.0).toFloat()
            paint.color = Color.argb((48 + b * 155).toInt(), 160, 185, 255)
            canvas.drawCircle(s.x, s.y, s.r, paint)
        }
    }

    private fun drawOceanGrid(canvas: Canvas) {
        val sw = 0.6f / zoom
        paint.style = Paint.Style.STROKE; paint.strokeWidth = sw

        // Параллели и меридианы
        for (i in 0..12) {
            paint.color = Color.argb(18, 40, 120, 200)
            canvas.drawLine(i * mapW / 12f, 0f, i * mapW / 12f, mapH, paint)
        }
        for (i in 0..8) {
            paint.color = Color.argb(18, 40, 120, 200)
            canvas.drawLine(0f, i * mapH / 8f, mapW, i * mapH / 8f, paint)
        }
        // Экватор ярче
        paint.color = Color.argb(40, 50, 170, 230)
        canvas.drawLine(0f, mapH * 0.50f, mapW, mapH * 0.50f, paint)
        // Нулевой меридиан
        paint.color = Color.argb(30, 50, 150, 210)
        canvas.drawLine(mapW * 0.473f, 0f, mapW * 0.473f, mapH, paint)

        paint.style = Paint.Style.FILL
    }

    private fun drawContinentHints(canvas: Canvas) {
        // Мягкие зелёно-синие блики на местах континентов
        val continents = arrayOf(
            floatArrayOf(0.20f, 0.32f, 0.13f),  // Северная Америка
            floatArrayOf(0.27f, 0.63f, 0.09f),  // Южная Америка
            floatArrayOf(0.47f, 0.28f, 0.08f),  // Европа
            floatArrayOf(0.49f, 0.56f, 0.13f),  // Африка
            floatArrayOf(0.66f, 0.33f, 0.19f),  // Азия
            floatArrayOf(0.82f, 0.71f, 0.07f),  // Австралия
        )
        for (cont in continents) {
            val cx = cont[0]; val cy = cont[1]; val r = cont[2] * mapW
            paint.shader = RadialGradient(wx(cx), wy(cy), r,
                Color.argb(28, 20, 80, 40), Color.argb(0, 0, 0, 0), Shader.TileMode.CLAMP)
            paint.style = Paint.Style.FILL
            canvas.drawCircle(wx(cx), wy(cy), r, paint)
            paint.shader = null
        }
    }

    private fun drawConnections(canvas: Canvas, eng: GameEngine) {
        for (c in eng.countries) {
            for (connId in c.connections) {
                if (connId <= c.id) continue
                val o = eng.countries[connId]
                val bothInf = c.infectedCount > 0 && o.infectedCount > 0
                val disc = c.isDiscovered && o.isDiscovered
                when {
                    bothInf && disc -> { connPaint.color = Color.argb(90, 255, 55, 0); connPaint.strokeWidth = 2.2f / zoom }
                    c.isDiscovered || o.isDiscovered -> { connPaint.color = Color.argb(55, 40, 155, 215); connPaint.strokeWidth = 1.2f / zoom }
                    else -> { connPaint.color = Color.argb(16, 30, 75, 115); connPaint.strokeWidth = 0.6f / zoom }
                }
                // Слегка изогнутая линия
                val x1 = wx(c.x); val y1 = wy(c.y); val x2 = wx(o.x); val y2 = wy(o.y)
                val mx = (x1 + x2) / 2f; val my = (y1 + y2) / 2f
                val len = sqrt((x2 - x1).pow(2) + (y2 - y1).pow(2))
                val curveOff = (len * 0.08f).coerceAtMost(mapW * 0.04f)
                val nx = -(y2 - y1) / len * curveOff; val ny = (x2 - x1) / len * curveOff
                curvePath.reset()
                curvePath.moveTo(x1, y1)
                curvePath.quadTo(mx + nx, my + ny, x2, y2)
                canvas.drawPath(curvePath, connPaint)
            }
        }
    }

    private fun drawParticles(canvas: Canvas) {
        paint.style = Paint.Style.FILL
        for (p in particles) {
            val a = (240 * (1f - p.t * p.t)).toInt().coerceIn(0, 255)
            paint.color = Color.argb(a, 255, (45 + p.t * 130).toInt().coerceIn(0, 255), 0)
            canvas.drawCircle(p.x, p.y, (5f / zoom) * (1f - p.t * 0.4f), paint)
        }
    }

    private fun drawCountry(canvas: Canvas, c: Country) {
        val x = wx(c.x); val y = wy(c.y)
        val baseR = getR(c.population)
        val pulse = sin(c.pulsePhase.toDouble()).toFloat()
        val r = baseR + if (c.infectedCount > 0) pulse * 4.5f else 0f

        if (c.isDiscovered) {
            val (gc, ga) = when {
                c.isFullyInfected          -> Color.parseColor("#FF0000") to 155
                c.infectionPercent > 0.5f  -> Color.parseColor("#CC1800") to 125
                c.infectionPercent > 0.01f -> Color.parseColor("#FF6000") to 88
                else                       -> Color.parseColor("#00AADD") to 58
            }
            glowPaint.color = Color.argb(ga, Color.red(gc), Color.green(gc), Color.blue(gc))
            canvas.drawCircle(x, y, r + 22f, glowPaint)
        }

        paint.style = Paint.Style.FILL
        paint.shader = when {
            !c.isDiscovered           -> RadialGradient(x, y, r, Color.argb(90, 22, 45, 65),  Color.argb(55, 8, 18, 30),  Shader.TileMode.CLAMP)
            c.infectionPercent <= 0f  -> RadialGradient(x, y, r, Color.parseColor("#1E7085"), Color.parseColor("#072030"), Shader.TileMode.CLAMP)
            c.infectionPercent < 0.5f -> RadialGradient(x, y, r, Color.parseColor("#E05200"), Color.parseColor("#601200"), Shader.TileMode.CLAMP)
            else                      -> RadialGradient(x, y, r, Color.parseColor("#FF1200"), Color.parseColor("#860000"), Shader.TileMode.CLAMP)
        }
        canvas.drawCircle(x, y, r, paint)
        paint.shader = null

        if (c.infectionPercent in 0.01f..0.99f) {
            paint.color = Color.argb(105, 255, 18, 0)
            canvas.drawArc(x - r, y - r, x + r, y + r, -90f, 360f * c.infectionPercent, true, paint)
        }

        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f / zoom
        paint.color = when {
            !c.isDiscovered           -> Color.argb(38, 0, 85, 135)
            c.infectionPercent <= 0f  -> Color.argb(185, 0, 205, 255)
            c.infectionPercent < 0.5f -> Color.argb(195, 255, 105, 0)
            else                      -> Color.argb(215, 255, 28, 0)
        }
        canvas.drawCircle(x, y, r, paint)
        paint.style = Paint.Style.FILL

        textPaint.textSize = if (c.isDiscovered) (19f / zoom).coerceIn(11f, 24f) else (14f / zoom).coerceIn(9f, 18f)
        textPaint.color = Color.WHITE
        canvas.drawText(c.flag, x, y + (7f / zoom).coerceIn(4f, 10f), textPaint)
    }

    private fun drawSelectedRing(canvas: Canvas, eng: GameEngine) {
        val id = selectedCountryId; if (id < 0 || id >= eng.countries.size) return
        val c = eng.countries[id]
        val x = wx(c.x); val y = wy(c.y)
        val r = getR(c.population)
        val pulse = ((sin(anim.toDouble()) + 1.0) / 2.0).toFloat()

        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 3f / zoom
        paint.color = Color.argb((165 + pulse * 90).toInt(), 255, 215, 0)
        canvas.drawCircle(x, y, r + 13f + pulse * 9f, paint)
        paint.strokeWidth = 1.5f / zoom
        paint.color = Color.argb((65 + pulse * 75).toInt(), 255, 255, 130)
        canvas.drawCircle(x, y, r + 24f + pulse * 9f, paint)
        paint.style = Paint.Style.FILL
    }

    private fun drawLabels(canvas: Canvas, eng: GameEngine) {
        val screenTextSize = 17f
        val tSize = (screenTextSize / zoom).coerceIn(10f, 22f)
        val pSize = (13f / zoom).coerceIn(9f, 17f)

        for (c in eng.countries) {
            if (!c.isDiscovered) continue
            val x = wx(c.x); val r = getR(c.population)
            val baseY = wy(c.y) + r + 4f

            textPaint.textSize = tSize
            textPaint.color = Color.argb(190, 210, 228, 255)
            canvas.drawText(c.name, x, baseY + tSize + 2f, textPaint)

            if (c.infectionPercent > 0.01f) {
                val pct = (c.infectionPercent * 100).toInt()
                textPaint.textSize = pSize
                textPaint.color = when {
                    pct >= 75 -> Color.argb(220, 255, 35, 0)
                    pct >= 40 -> Color.argb(210, 255, 105, 0)
                    else      -> Color.argb(190, 255, 175, 0)
                }
                canvas.drawText("$pct%", x, baseY + tSize + pSize + 4f, textPaint)
            }
        }
    }

    private fun drawFloatTexts(canvas: Canvas) {
        for (ft in floatTexts) {
            textPaint.textSize = (22f / zoom).coerceIn(12f, 28f)
            textPaint.color = Color.argb(ft.alpha, Color.red(ft.color), Color.green(ft.color), Color.blue(ft.color))
            canvas.drawText(ft.text, ft.x, ft.y, textPaint)
        }
    }

    private fun drawEndOverlay(canvas: Canvas, title: String, color: Int, sub: String) {
        paint.color = Color.argb(190, 0, 0, 0)
        canvas.drawRect(0f, mapH * 0.27f, mapW, mapH * 0.73f, paint)
        glowPaint.maskFilter = BlurMaskFilter(60f, BlurMaskFilter.Blur.NORMAL)
        glowPaint.color = Color.argb(60, Color.red(color), Color.green(color), Color.blue(color))
        canvas.drawRect(0f, mapH * 0.27f, mapW, mapH * 0.73f, glowPaint)
        glowPaint.maskFilter = BlurMaskFilter((30f / zoom).coerceIn(6f, 40f), BlurMaskFilter.Blur.NORMAL)
        textPaint.textSize = 55f; textPaint.color = color
        canvas.drawText(title, mapW / 2, mapH * 0.46f, textPaint)
        textPaint.textSize = 22f; textPaint.color = Color.argb(200, 205, 205, 210)
        canvas.drawText(sub, mapW / 2, mapH * 0.55f, textPaint)
    }

    private fun drawStartPrompt(canvas: Canvas) {
        val ty = mapH * 0.42f
        paint.color = Color.argb(178, 0, 5, 14)
        canvas.drawRoundRect(mapW * 0.04f, ty, mapW * 0.96f, ty + 88f, 14f, 14f, paint)
        textPaint.textSize = 27f; textPaint.color = Color.parseColor("#00FFAA")
        canvas.drawText("Выберите страну для старта", mapW / 2, ty + 35f, textPaint)
        textPaint.textSize = 19f; textPaint.color = Color.argb(165, 175, 190, 200)
        canvas.drawText("Нажмите на страну, чтобы начать заражение", mapW / 2, ty + 63f, textPaint)
    }

    private fun drawZoomIndicator(canvas: Canvas) {
        textPaint.textSize = 13f
        textPaint.color = Color.argb(110, 140, 165, 200)
        canvas.drawText("×${"%.1f".format(zoom)}", mapW - 28f, mapH - 12f, textPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                dragStartX = event.x; dragStartY = event.y
                panStartX = panX; panStartY = panY; dragged = false
            }
            MotionEvent.ACTION_MOVE -> {
                if (event.pointerCount == 1 && !scaleDetector.isInProgress) {
                    val dx = event.x - dragStartX; val dy = event.y - dragStartY
                    if (abs(dx) > 10f || abs(dy) > 10f) {
                        dragged = true
                        panX = panStartX + dx; panY = panStartY + dy
                        clampPan(); invalidate()
                    }
                }
            }
            MotionEvent.ACTION_UP -> {
                if (!dragged && !scaleDetector.isInProgress) {
                    // Преобразуем экранные координаты в мировые
                    val wx = (event.x - panX) / zoom
                    val wy = (event.y - panY) / zoom
                    val tx = wx / mapW; val ty = wy / mapH
                    val eng = engine ?: return true
                    for (c in eng.countries) {
                        val dx = tx - c.x; val dy = ty - c.y
                        if (sqrt(dx * dx + dy * dy) * mapW < getR(c.population) + 22f) {
                            onCountryClicked?.invoke(c.id); return true
                        }
                    }
                }
            }
            MotionEvent.ACTION_POINTER_DOWN -> dragged = true
        }
        return true
    }
}
