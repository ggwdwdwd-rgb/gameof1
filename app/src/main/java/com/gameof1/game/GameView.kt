package com.gameof1.game

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.*

class GameView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    var engine: GameEngine? = null
    var onCountryClicked: ((Int) -> Unit)? = null
    var onMapReady: (() -> Unit)? = null

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 28f
        typeface = Typeface.DEFAULT_BOLD
    }
    private val connectionPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(60, 0, 200, 255)
        strokeWidth = 1.5f
        style = Paint.Style.STROKE
    }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        maskFilter = BlurMaskFilter(25f, BlurMaskFilter.Blur.NORMAL)
    }

    private var mapWidth = 0f
    private var mapHeight = 0f
    private val countryRadius = 32f

    init {
        setLayerType(LAYER_TYPE_SOFTWARE, null)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        mapWidth = w.toFloat()
        mapHeight = h.toFloat()
        onMapReady?.invoke()
    }

    private fun cx(x: Float) = x * mapWidth
    private fun cy(y: Float) = y * mapHeight

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val eng = engine ?: return

        // Background gradient
        val bg = LinearGradient(0f, 0f, 0f, mapHeight,
            Color.parseColor("#040D14"), Color.parseColor("#0A1628"),
            Shader.TileMode.CLAMP)
        paint.shader = bg
        paint.style = Paint.Style.FILL
        canvas.drawRect(0f, 0f, mapWidth, mapHeight, paint)
        paint.shader = null

        // Draw grid lines (map feel)
        paint.color = Color.argb(20, 0, 150, 200)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 0.5f
        val gridStep = mapWidth / 12
        var gx = 0f
        while (gx <= mapWidth) { canvas.drawLine(gx, 0f, gx, mapHeight, paint); gx += gridStep }
        var gy = 0f
        while (gy <= mapHeight) { canvas.drawLine(0f, gy, mapWidth, gy, paint); gy += gridStep }

        // Draw connections
        for (country in eng.countries) {
            for (connId in country.connections) {
                if (connId > country.id) {
                    val other = eng.countries[connId]
                    val alpha = if (country.isDiscovered || other.isDiscovered) 80 else 25
                    connectionPaint.color = Color.argb(alpha, 0, 180, 255)
                    canvas.drawLine(cx(country.x), cy(country.y), cx(other.x), cy(other.y), connectionPaint)
                }
            }
        }

        // Draw countries
        for (country in eng.countries) {
            drawCountry(canvas, country)
        }

        // Draw country labels
        for (country in eng.countries) {
            if (country.isDiscovered) {
                textPaint.textSize = 22f
                textPaint.textAlign = Paint.Align.CENTER
                textPaint.color = Color.argb(200, 255, 255, 255)
                canvas.drawText(country.name, cx(country.x), cy(country.y) + countryRadius + 30f, textPaint)
                if (country.infectionPercent > 0f) {
                    textPaint.textSize = 18f
                    textPaint.color = Color.argb(180, 255, 100, 50)
                    canvas.drawText("${(country.infectionPercent * 100).toInt()}%",
                        cx(country.x), cy(country.y) + countryRadius + 48f, textPaint)
                }
            }
        }

        // Game state overlay
        when (eng.gameState) {
            GameEngine.GameState.WON -> drawOverlay(canvas, "ПОБЕДА!", Color.parseColor("#00FF88"), "Вы заразили весь мир!")
            GameEngine.GameState.LOST -> drawOverlay(canvas, "ПОРАЖЕНИЕ", Color.parseColor("#FF4444"), "Лекарство создано...")
            GameEngine.GameState.WAITING -> drawWaitingPrompt(canvas)
            else -> {}
        }
    }

    private fun drawCountry(canvas: Canvas, country: Country) {
        val x = cx(country.x)
        val y = cy(country.y)
        val pulse = sin(country.pulsePhase.toDouble()).toFloat()
        val radius = countryRadius + if (country.infectedCount > 0) pulse * 4f else 0f

        // Glow effect
        if (country.isDiscovered) {
            val glowColor = when {
                country.infectionPercent <= 0f -> Color.argb(40, 0, 180, 220)
                country.infectionPercent < 0.3f -> Color.argb(80, 255, 120, 0)
                country.infectionPercent < 0.7f -> Color.argb(100, 220, 30, 0)
                else -> Color.argb(120, 255, 0, 0)
            }
            glowPaint.color = glowColor
            canvas.drawCircle(x, y, radius + 15f, glowPaint)
        }

        // Country circle
        paint.style = Paint.Style.FILL
        paint.shader = null
        paint.color = when {
            !country.isDiscovered -> Color.argb(120, 15, 30, 45)
            country.infectionPercent <= 0f -> Color.parseColor("#0D4F5A")
            country.infectionPercent < 0.3f -> Color.parseColor("#8B3A00")
            country.infectionPercent < 0.7f -> Color.parseColor("#8B0000")
            else -> Color.parseColor("#CC0000")
        }
        canvas.drawCircle(x, y, radius, paint)

        // Infection fill overlay
        if (country.infectionPercent > 0f && country.infectionPercent < 1f) {
            paint.color = Color.argb(180, 255, 0, 0)
            val sweepAngle = 360f * country.infectionPercent
            canvas.drawArc(x - radius, y - radius, x + radius, y + radius, -90f, sweepAngle, true, paint)
        }

        // Border
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f
        paint.color = when {
            !country.isDiscovered -> Color.argb(50, 0, 100, 150)
            country.infectionPercent <= 0f -> Color.argb(180, 0, 220, 255)
            else -> Color.argb(200, 255, 80, 0)
        }
        canvas.drawCircle(x, y, radius, paint)
        paint.style = Paint.Style.FILL

        // Country label (abbreviated flag code)
        textPaint.textSize = if (country.isDiscovered) 18f else 14f
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.color = Color.WHITE
        canvas.drawText(country.flag, x, y + 6f, textPaint)
    }

    private fun drawOverlay(canvas: Canvas, title: String, color: Int, subtitle: String) {
        paint.color = Color.argb(180, 0, 0, 0)
        canvas.drawRect(0f, mapHeight * 0.35f, mapWidth, mapHeight * 0.65f, paint)

        textPaint.textSize = 64f
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.color = color
        canvas.drawText(title, mapWidth / 2, mapHeight * 0.5f, textPaint)

        textPaint.textSize = 30f
        textPaint.color = Color.argb(200, 255, 255, 255)
        canvas.drawText(subtitle, mapWidth / 2, mapHeight * 0.5f + 50f, textPaint)
    }

    private fun drawWaitingPrompt(canvas: Canvas) {
        paint.color = Color.argb(150, 0, 0, 0)
        canvas.drawRect(0f, mapHeight * 0.45f, mapWidth, mapHeight * 0.60f, paint)
        textPaint.textSize = 34f
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.color = Color.parseColor("#00FFAA")
        canvas.drawText("Выберите страну для старта", mapWidth / 2, mapHeight * 0.53f, textPaint)
        textPaint.textSize = 24f
        textPaint.color = Color.argb(180, 200, 200, 200)
        canvas.drawText("Нажмите на любой кружок", mapWidth / 2, mapHeight * 0.57f, textPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_UP) {
            val eng = engine ?: return true
            val tx = event.x / mapWidth
            val ty = event.y / mapHeight
            for (country in eng.countries) {
                val dx = tx - country.x
                val dy = ty - country.y
                val dist = sqrt(dx * dx + dy * dy) * mapWidth
                if (dist < countryRadius + 15f) {
                    onCountryClicked?.invoke(country.id)
                    return true
                }
            }
        }
        return true
    }
}
