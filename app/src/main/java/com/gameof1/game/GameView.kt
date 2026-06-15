package com.gameof1.game

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.MotionEvent
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

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.DEFAULT_BOLD
        textAlign = Paint.Align.CENTER
    }
    private val connPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        maskFilter = BlurMaskFilter(28f, BlurMaskFilter.Blur.NORMAL)
    }

    private var mapW = 0f
    private var mapH = 0f
    private val CR = 33f   // country radius
    private var anim = 0f

    // --- Starfield ---
    private class Star(val x: Float, val y: Float, val r: Float, val phase: Float)
    private val stars = ArrayList<Star>(130)

    // --- Infection particles ---
    private class Particle(val sx: Float, val sy: Float, val ex: Float, val ey: Float, var t: Float = 0f) {
        val x get() = sx + (ex - sx) * t
        val y get() = sy + (ey - sy) * t
        val done get() = t >= 1f
    }
    private val particles = ArrayList<Particle>(64)

    // --- Floating texts (+DNA, etc.) ---
    private class FloatText(var x: Float, var y: Float, val text: String, val color: Int, var alpha: Int = 255)
    private val floatTexts = ArrayList<FloatText>(16)

    init { setLayerType(LAYER_TYPE_SOFTWARE, null) }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        mapW = w.toFloat(); mapH = h.toFloat()
        buildStars()
        onMapReady?.invoke()
    }

    private fun buildStars() {
        stars.clear()
        val rng = Random(42L)
        repeat(130) {
            stars += Star(rng.nextFloat() * mapW, rng.nextFloat() * mapH,
                0.4f + rng.nextFloat() * 2.3f, rng.nextFloat() * (2 * PI).toFloat())
        }
    }

    private fun cx(x: Float) = x * mapW
    private fun cy(y: Float) = y * mapH

    fun addFloatText(countryId: Int, text: String, color: Int) {
        val c = engine?.countries?.getOrNull(countryId) ?: return
        floatTexts += FloatText(cx(c.x), cy(c.y) - CR - 8f, text, color)
    }

    fun update() {
        anim += 0.04f
        val eng = engine
        // Spawn infection particles
        if (eng != null && eng.gameState == GameEngine.GameState.RUNNING && Random.nextFloat() < 0.28f) {
            val src = eng.countries.filter { it.infectedCount > 200L }.randomOrNull()
            val dstId = src?.connections?.randomOrNull()
            if (src != null && dstId != null) {
                val dst = eng.countries[dstId]
                if (!dst.isFullyInfected)
                    particles += Particle(cx(src.x), cy(src.y), cx(dst.x), cy(dst.y))
            }
        }
        val pi = particles.iterator(); while (pi.hasNext()) { if (pi.next().also { it.t += 0.03f }.done) pi.remove() }
        val fi = floatTexts.iterator(); while (fi.hasNext()) { val ft = fi.next(); ft.y -= 2.5f; ft.alpha -= 5; if (ft.alpha <= 0) fi.remove() }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val eng = engine ?: return
        if (mapW == 0f) return

        drawBackground(canvas)
        drawStars(canvas)
        drawConnections(canvas, eng)
        drawParticles(canvas)
        for (c in eng.countries) drawCountry(canvas, c)
        drawSelectedRing(canvas, eng)
        drawLabels(canvas, eng)
        drawFloatTexts(canvas)

        when (eng.gameState) {
            GameEngine.GameState.WON    -> drawEndOverlay(canvas, "🏆 ПОБЕДА!", Color.parseColor("#00FF88"), "Человечество заражено!")
            GameEngine.GameState.LOST   -> drawEndOverlay(canvas, "💀 ПОРАЖЕНИЕ", Color.parseColor("#FF4444"), "Лекарство создано. Вы проиграли.")
            GameEngine.GameState.WAITING -> drawStartPrompt(canvas)
            else -> {}
        }
    }

    private fun drawBackground(canvas: Canvas) {
        paint.shader = LinearGradient(0f, 0f, 0f, mapH,
            Color.parseColor("#030B16"), Color.parseColor("#061422"), Shader.TileMode.CLAMP)
        paint.style = Paint.Style.FILL
        canvas.drawRect(0f, 0f, mapW, mapH, paint)
        paint.shader = null
    }

    private fun drawStars(canvas: Canvas) {
        paint.style = Paint.Style.FILL
        for (s in stars) {
            val b = ((sin((anim * 0.38f + s.phase).toDouble()) + 1.0) / 2.0).toFloat()
            paint.color = Color.argb((55 + b * 165).toInt(), 165, 190, 255)
            canvas.drawCircle(s.x, s.y, s.r, paint)
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
                    bothInf && disc -> { connPaint.color = Color.argb(85, 255, 55, 0); connPaint.strokeWidth = 2f }
                    c.isDiscovered || o.isDiscovered -> { connPaint.color = Color.argb(52, 40, 155, 215); connPaint.strokeWidth = 1f }
                    else -> { connPaint.color = Color.argb(16, 30, 75, 115); connPaint.strokeWidth = 0.5f }
                }
                canvas.drawLine(cx(c.x), cy(c.y), cx(o.x), cy(o.y), connPaint)
            }
        }
    }

    private fun drawParticles(canvas: Canvas) {
        paint.style = Paint.Style.FILL
        for (p in particles) {
            val a = (240 * (1f - p.t * p.t)).toInt().coerceIn(0, 255)
            paint.color = Color.argb(a, 255, (45 + p.t * 130).toInt().coerceIn(0, 255), 0)
            canvas.drawCircle(p.x, p.y, 4.2f * (1f - p.t * 0.45f), paint)
        }
    }

    private fun drawCountry(canvas: Canvas, c: Country) {
        val x = cx(c.x); val y = cy(c.y)
        val pulse = sin(c.pulsePhase.toDouble()).toFloat()
        val r = CR + if (c.infectedCount > 0) pulse * 5f else 0f

        // Glow
        if (c.isDiscovered) {
            val (gc, ga) = when {
                c.isFullyInfected          -> Color.parseColor("#FF0000") to 155
                c.infectionPercent > 0.5f  -> Color.parseColor("#CC1800") to 120
                c.infectionPercent > 0.01f -> Color.parseColor("#FF6000") to 85
                else                       -> Color.parseColor("#00AADD") to 55
            }
            glowPaint.color = Color.argb(ga, Color.red(gc), Color.green(gc), Color.blue(gc))
            canvas.drawCircle(x, y, r + 20f, glowPaint)
        }

        // Body radial gradient
        paint.style = Paint.Style.FILL
        paint.shader = when {
            !c.isDiscovered        -> RadialGradient(x, y, r, Color.argb(90, 22, 45, 65),  Color.argb(55, 8, 18, 30),  Shader.TileMode.CLAMP)
            c.infectionPercent <= 0f -> RadialGradient(x, y, r, Color.parseColor("#1A6A7C"), Color.parseColor("#072030"), Shader.TileMode.CLAMP)
            c.infectionPercent < 0.5f -> RadialGradient(x, y, r, Color.parseColor("#DD5000"), Color.parseColor("#601200"), Shader.TileMode.CLAMP)
            else                   -> RadialGradient(x, y, r, Color.parseColor("#FF1000"), Color.parseColor("#860000"), Shader.TileMode.CLAMP)
        }
        canvas.drawCircle(x, y, r, paint)
        paint.shader = null

        // Infection sweep arc
        if (c.infectionPercent in 0.01f..0.99f) {
            paint.color = Color.argb(105, 255, 18, 0)
            canvas.drawArc(x - r, y - r, x + r, y + r, -90f, 360f * c.infectionPercent, true, paint)
        }

        // Border
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2.5f
        paint.color = when {
            !c.isDiscovered        -> Color.argb(38, 0, 85, 135)
            c.infectionPercent <= 0f -> Color.argb(185, 0, 205, 255)
            c.infectionPercent < 0.5f -> Color.argb(195, 255, 105, 0)
            else                   -> Color.argb(215, 255, 28, 0)
        }
        canvas.drawCircle(x, y, r, paint)
        paint.style = Paint.Style.FILL

        // Flag
        textPaint.textSize = if (c.isDiscovered) 19f else 14f
        textPaint.color = Color.WHITE
        canvas.drawText(c.flag, x, y + 7f, textPaint)
    }

    private fun drawSelectedRing(canvas: Canvas, eng: GameEngine) {
        val id = selectedCountryId; if (id < 0 || id >= eng.countries.size) return
        val c = eng.countries[id]
        val x = cx(c.x); val y = cy(c.y)
        val pulse = ((sin(anim.toDouble()) + 1.0) / 2.0).toFloat()
        val r = CR + 13f + pulse * 8f

        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 3f
        paint.color = Color.argb((165 + pulse * 90).toInt(), 255, 215, 0)
        canvas.drawCircle(x, y, r, paint)
        paint.strokeWidth = 1.5f
        paint.color = Color.argb((75 + pulse * 75).toInt(), 255, 255, 130)
        canvas.drawCircle(x, y, r + 9f, paint)
        paint.style = Paint.Style.FILL
    }

    private fun drawLabels(canvas: Canvas, eng: GameEngine) {
        for (c in eng.countries) {
            if (!c.isDiscovered) continue
            val x = cx(c.x); val baseY = cy(c.y) + CR + 6f
            textPaint.textSize = 18f
            textPaint.color = Color.argb(195, 210, 228, 255)
            canvas.drawText(c.name, x, baseY + 20f, textPaint)
            if (c.infectionPercent > 0.01f) {
                val pct = (c.infectionPercent * 100).toInt()
                textPaint.textSize = 14f
                textPaint.color = when {
                    pct >= 75 -> Color.argb(220, 255, 35, 0)
                    pct >= 40 -> Color.argb(210, 255, 105, 0)
                    else      -> Color.argb(190, 255, 175, 0)
                }
                canvas.drawText("$pct%", x, baseY + 36f, textPaint)
            }
        }
    }

    private fun drawFloatTexts(canvas: Canvas) {
        for (ft in floatTexts) {
            textPaint.textSize = 23f
            textPaint.color = Color.argb(ft.alpha, Color.red(ft.color), Color.green(ft.color), Color.blue(ft.color))
            canvas.drawText(ft.text, ft.x, ft.y, textPaint)
        }
    }

    private fun drawEndOverlay(canvas: Canvas, title: String, color: Int, sub: String) {
        paint.color = Color.argb(185, 0, 0, 0)
        canvas.drawRect(0f, mapH * 0.27f, mapW, mapH * 0.73f, paint)
        glowPaint.color = Color.argb(65, Color.red(color), Color.green(color), Color.blue(color))
        canvas.drawRect(0f, mapH * 0.27f, mapW, mapH * 0.73f, glowPaint)
        textPaint.textSize = 55f; textPaint.color = color
        canvas.drawText(title, mapW / 2, mapH * 0.46f, textPaint)
        textPaint.textSize = 22f; textPaint.color = Color.argb(200, 205, 205, 210)
        canvas.drawText(sub, mapW / 2, mapH * 0.55f, textPaint)
    }

    private fun drawStartPrompt(canvas: Canvas) {
        val ty = mapH * 0.42f
        paint.color = Color.argb(175, 0, 5, 14)
        canvas.drawRoundRect(mapW * 0.04f, ty, mapW * 0.96f, ty + 88f, 14f, 14f, paint)
        textPaint.textSize = 27f; textPaint.color = Color.parseColor("#00FFAA")
        canvas.drawText("Выберите страну для старта", mapW / 2, ty + 35f, textPaint)
        textPaint.textSize = 19f; textPaint.color = Color.argb(165, 175, 190, 200)
        canvas.drawText("Нажмите на страну, чтобы начать заражение", mapW / 2, ty + 63f, textPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_UP) {
            val eng = engine ?: return true
            val tx = event.x / mapW; val ty = event.y / mapH
            for (c in eng.countries) {
                val dx = tx - c.x; val dy = ty - c.y
                if (sqrt(dx * dx + dy * dy) * mapW < CR + 20f) {
                    onCountryClicked?.invoke(c.id); return true
                }
            }
        }
        return true
    }
}
