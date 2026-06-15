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

    // Зум / пан
    private var zoom = 1f
    private var panX = 0f
    private var panY = 0f
    private var dragStartX = 0f; private var dragStartY = 0f
    private var panStartX = 0f; private var panStartY = 0f
    private var dragged = false
    private val scaleDetector: ScaleGestureDetector

    // Кисти
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.DEFAULT_BOLD; textAlign = Paint.Align.CENTER
    }
    private val connPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val pathTemp = Path()

    private var mapW = 0f; private var mapH = 0f
    private var anim = 0f
    private var lastGlowZoom = -1f

    // Полигоны стран
    private var bgPaths: List<Path> = emptyList()
    private var countryPaths: Array<List<Path>> = emptyArray()

    // Звёздное небо
    private class Star(val x: Float, val y: Float, val r: Float, val phase: Float)
    private val stars = ArrayList<Star>(100)

    // Транспорт
    private class Vehicle(
        val x0: Float, val y0: Float,
        val cx: Float, val cy: Float,
        val x2: Float, val y2: Float,
        val type: Type,
        var t: Float = 0f,
        val speed: Float = 0.012f + Random.nextFloat() * 0.010f
    ) {
        enum class Type { PLANE, SHIP }
        val x get() = (1-t)*(1-t)*x0 + 2*(1-t)*t*cx + t*t*x2
        val y get() = (1-t)*(1-t)*y0 + 2*(1-t)*t*cy + t*t*y2
        val done get() = t >= 1f
    }
    private val vehicles = ArrayList<Vehicle>(16)

    // Частицы заражения
    private class Particle(val sx: Float, val sy: Float, val ex: Float, val ey: Float, var t: Float = 0f) {
        val x get() = sx + (ex-sx)*t; val y get() = sy + (ey-sy)*t; val done get() = t >= 1f
    }
    private val particles = ArrayList<Particle>(60)

    // Всплывающий текст
    private class FloatText(var x: Float, var y: Float, val text: String, val color: Int, var alpha: Int = 255)
    private val floatTexts = ArrayList<FloatText>(16)

    private val portIds = setOf(1, 4, 5, 6, 7, 9, 11, 12, 13, 14, 17, 18, 20, 21, 22)

    init {
        setLayerType(LAYER_TYPE_SOFTWARE, null)
        scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(det: ScaleGestureDetector): Boolean {
                val prev = zoom
                zoom = (zoom * det.scaleFactor).coerceIn(0.7f, 6f)
                panX = det.focusX - (det.focusX - panX) * (zoom / prev)
                panY = det.focusY - (det.focusY - panY) * (zoom / prev)
                clampPan(); invalidate(); return true
            }
        })
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        mapW = w.toFloat(); mapH = h.toFloat()
        buildStars()
        buildGeoPaths()
        onMapReady?.invoke()
    }

    private fun buildStars() {
        stars.clear()
        val r = Random(42L)
        repeat(100) { stars += Star(r.nextFloat()*mapW, r.nextFloat()*mapH, 0.5f+r.nextFloat()*2f, r.nextFloat()*(2*PI).toFloat()) }
    }

    private fun buildGeoPaths() {
        bgPaths = WorldMapPaths.backgroundLand.map { WorldMapPaths.makePath(it, mapW, mapH) }
        countryPaths = Array(WorldMapPaths.countryPolygons.size) { i ->
            WorldMapPaths.countryPolygons[i].map { WorldMapPaths.makePath(it, mapW, mapH) }
        }
    }

    private fun clampPan() {
        val mx = mapW*(zoom-1f)*0.7f + mapW*0.15f
        val my = mapH*(zoom-1f)*0.7f + mapH*0.15f
        panX = panX.coerceIn(-mx, mx); panY = panY.coerceIn(-my, my)
    }

    // Экранные координаты из lon/lat
    private fun gx(lon: Float) = WorldMapPaths.lonToX(lon, mapW)
    private fun gy(lat: Float) = WorldMapPaths.latToY(lat, mapH)

    // Экранные координаты из нормализованных (0-1)
    private fun wx(x: Float) = x * mapW
    private fun wy(y: Float) = y * mapH

    private fun getR(pop: Long) = (14f + ((ln(pop.coerceAtLeast(1L).toFloat()) - ln(20_000_000f)) / (ln(1_400_000_000f) - ln(20_000_000f))).coerceIn(0f,1f)*14f)

    fun addFloatText(countryId: Int, text: String, color: Int) {
        val c = engine?.countries?.getOrNull(countryId) ?: return
        floatTexts += FloatText(gx(c.lon), gy(c.lat) - 30f, text, color)
    }

    fun update() {
        anim += 0.04f
        val eng = engine ?: return

        // Частицы
        if (eng.gameState == GameEngine.GameState.RUNNING && Random.nextFloat() < 0.18f) {
            val src = eng.countries.filter { it.infectedCount > 300 }.randomOrNull()
            val dstId = src?.connections?.randomOrNull()
            if (src != null && dstId != null && !eng.countries[dstId].isFullyInfected)
                particles += Particle(gx(src.lon), gy(src.lat), gx(eng.countries[dstId].lon), gy(eng.countries[dstId].lat))
        }
        val pi = particles.iterator(); while (pi.hasNext()) { if (pi.next().also { it.t += 0.025f }.done) pi.remove() }

        // Транспорт
        if (eng.gameState == GameEngine.GameState.RUNNING && Random.nextFloat() < 0.04f && vehicles.size < 14) {
            val src = eng.countries.filter { it.infectedCount > 500 }.randomOrNull()
            val dstId = src?.connections?.randomOrNull()
            if (src != null && dstId != null) {
                val dst = eng.countries[dstId]
                val sx = gx(src.lon); val sy = gy(src.lat)
                val ex = gx(dst.lon); val ey = gy(dst.lat)
                val len = sqrt((ex-sx).pow(2) + (ey-sy).pow(2))
                if (len > 5f) {
                    val mx = (sx+ex)/2f; val my = (sy+ey)/2f
                    val nx = -(ey-sy)/len; val ny = (ex-sx)/len
                    val curveMag = len * 0.22f
                    val dist = sqrt((src.x-dst.x).pow(2) + (src.y-dst.y).pow(2))
                    val isAir = dst.climate == Climate.ISLAND || src.climate == Climate.ISLAND || dist > 0.20f
                    val isSea = !isAir && dst.id in portIds && src.id in portIds
                    if (isAir || isSea)
                        vehicles += Vehicle(sx, sy, mx+nx*curveMag, my+ny*curveMag, ex, ey,
                            if (isAir) Vehicle.Type.PLANE else Vehicle.Type.SHIP)
                }
            }
        }
        val vi = vehicles.iterator(); while (vi.hasNext()) { if (vi.next().also { it.t += it.speed }.done) vi.remove() }

        // Всплывающий текст
        val fi = floatTexts.iterator(); while (fi.hasNext()) { val ft = fi.next(); ft.y -= 2.5f; ft.alpha -= 5; if (ft.alpha <= 0) fi.remove() }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val eng = engine ?: return
        if (mapW == 0f) return

        drawOcean(canvas)
        drawStars(canvas)

        if (abs(zoom - lastGlowZoom) > 0.08f) {
            glowPaint.maskFilter = BlurMaskFilter((22f/zoom).coerceIn(4f, 35f), BlurMaskFilter.Blur.NORMAL)
            lastGlowZoom = zoom
        }

        canvas.save()
        canvas.translate(panX, panY)
        canvas.scale(zoom, zoom)

        drawGrid(canvas)
        drawBackgroundLand(canvas)
        drawCountryFills(canvas, eng)
        drawCountryBorders(canvas, eng)
        drawConnections(canvas, eng)
        drawParticles(canvas)
        drawVehicles(canvas)
        drawTransportIcons(canvas, eng)
        drawSelectedRing(canvas, eng)
        drawLabels(canvas, eng)
        drawFlags(canvas, eng)
        drawFloatTexts(canvas)

        canvas.restore()

        when (eng.gameState) {
            GameEngine.GameState.WON    -> drawEndOverlay(canvas, "🏆 ПОБЕДА!", Color.parseColor("#00FF88"), "Человечество заражено!")
            GameEngine.GameState.LOST   -> drawEndOverlay(canvas, "💀 ПОРАЖЕНИЕ", Color.parseColor("#FF4444"), "Лекарство создано. Вы проиграли.")
            GameEngine.GameState.WAITING -> drawStartPrompt(canvas)
            else -> {}
        }

        if (zoom > 1.15f) {
            textPaint.textSize = 13f; textPaint.color = Color.argb(110, 140, 165, 200)
            canvas.drawText("×${"%.1f".format(zoom)}", mapW - 28f, mapH - 12f, textPaint)
        }
    }

    private fun drawOcean(canvas: Canvas) {
        paint.shader = RadialGradient(mapW/2, mapH/2, maxOf(mapW, mapH)*0.85f,
            Color.parseColor("#041C30"), Color.parseColor("#020C18"), Shader.TileMode.CLAMP)
        paint.style = Paint.Style.FILL
        canvas.drawRect(0f, 0f, mapW, mapH, paint)
        paint.shader = null
    }

    private fun drawStars(canvas: Canvas) {
        paint.style = Paint.Style.FILL
        for (s in stars) {
            val b = ((sin((anim*0.38f+s.phase).toDouble())+1.0)/2.0).toFloat()
            paint.color = Color.argb((40+b*120).toInt(), 160, 185, 255)
            canvas.drawCircle(s.x, s.y, s.r, paint)
        }
    }

    private fun drawGrid(canvas: Canvas) {
        val sw = 0.4f / zoom
        paint.style = Paint.Style.STROKE; paint.strokeWidth = sw
        for (i in 0..12) {
            paint.color = Color.argb(12, 40, 120, 200)
            canvas.drawLine(i*mapW/12f, 0f, i*mapW/12f, mapH, paint)
        }
        for (i in 0..8) {
            paint.color = Color.argb(12, 40, 120, 200)
            canvas.drawLine(0f, i*mapH/8f, mapW, i*mapH/8f, paint)
        }
        paint.color = Color.argb(30, 50, 170, 230); paint.strokeWidth = sw*2
        canvas.drawLine(0f, mapH*0.50f, mapW, mapH*0.50f, paint)
        paint.style = Paint.Style.FILL
    }

    private fun drawBackgroundLand(canvas: Canvas) {
        paint.style = Paint.Style.FILL
        paint.color = Color.parseColor("#0C1E14")
        for (p in bgPaths) canvas.drawPath(p, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 0.6f / zoom
        paint.color = Color.parseColor("#182C1E")
        for (p in bgPaths) canvas.drawPath(p, paint)
        paint.style = Paint.Style.FILL
    }

    private fun drawCountryFills(canvas: Canvas, eng: GameEngine) {
        paint.style = Paint.Style.FILL
        for (c in eng.countries) {
            if (c.id >= countryPaths.size) continue
            val paths = countryPaths[c.id]

            val baseColor = when {
                !c.isDiscovered -> Color.parseColor("#0E2118")
                c.infectionPercent <= 0f -> Color.parseColor("#143D25")
                c.infectionPercent < 0.3f -> Color.parseColor("#5A1800")
                c.infectionPercent < 0.7f -> Color.parseColor("#8A0A00")
                else -> Color.parseColor("#AA0000")
            }
            paint.color = baseColor
            for (p in paths) canvas.drawPath(p, paint)

            // Пульсирующее свечение заражения
            if (c.isDiscovered && c.infectedCount > 0) {
                val pulse = (sin(c.pulsePhase.toDouble()).toFloat() + 1f) / 2f
                val alpha = ((c.infectionPercent * 80f + pulse * 40f)).toInt().coerceIn(0, 120)
                paint.color = Color.argb(alpha, 255, 30, 0)
                for (p in paths) canvas.drawPath(p, paint)
            }
        }
        paint.style = Paint.Style.FILL
    }

    private fun drawCountryBorders(canvas: Canvas, eng: GameEngine) {
        paint.style = Paint.Style.STROKE
        for (c in eng.countries) {
            if (c.id >= countryPaths.size) continue
            paint.strokeWidth = 1.2f / zoom
            paint.color = when {
                c.id == selectedCountryId -> Color.argb(220, 255, 215, 0)
                !c.isDiscovered -> Color.argb(35, 50, 100, 70)
                c.infectionPercent > 0.5f -> Color.argb(190, 220, 60, 0)
                c.infectionPercent > 0f -> Color.argb(155, 180, 100, 0)
                else -> Color.argb(120, 30, 180, 100)
            }
            for (p in countryPaths[c.id]) canvas.drawPath(p, paint)
        }
        paint.style = Paint.Style.FILL
    }

    private fun drawConnections(canvas: Canvas, eng: GameEngine) {
        for (c in eng.countries) {
            for (connId in c.connections) {
                if (connId <= c.id) continue
                val o = eng.countries[connId]
                val bothInf = c.infectedCount > 0 && o.infectedCount > 0
                val disc = c.isDiscovered && o.isDiscovered
                val dist = sqrt((c.x-o.x).pow(2)+(c.y-o.y).pow(2))
                val isAir = o.climate == Climate.ISLAND || c.climate == Climate.ISLAND || dist > 0.20f
                when {
                    bothInf && disc -> { connPaint.color = Color.argb(85, 255, 55, 0); connPaint.strokeWidth = 2f/zoom }
                    disc -> { connPaint.color = Color.argb(if (isAir) 65 else 45, 40, 155, 215); connPaint.strokeWidth = 1.2f/zoom }
                    else -> { connPaint.color = Color.argb(12, 30, 75, 115); connPaint.strokeWidth = 0.5f/zoom }
                }
                if (isAir && disc) connPaint.pathEffect = DashPathEffect(floatArrayOf(8f/zoom, 5f/zoom), 0f)
                else connPaint.pathEffect = null

                val x1=gx(c.lon); val y1=gy(c.lat); val x2=gx(o.lon); val y2=gy(o.lat)
                val len = sqrt((x2-x1).pow(2)+(y2-y1).pow(2))
                if (len > 0f) {
                    val mx=(x1+x2)/2f; val my=(y1+y2)/2f
                    val nx=-(y2-y1)/len; val ny=(x2-x1)/len
                    val off = (len*0.1f).coerceAtMost(mapW*0.06f)
                    pathTemp.reset(); pathTemp.moveTo(x1,y1); pathTemp.quadTo(mx+nx*off, my+ny*off, x2, y2)
                    canvas.drawPath(pathTemp, connPaint)
                }
            }
        }
        connPaint.pathEffect = null
    }

    private fun drawParticles(canvas: Canvas) {
        paint.style = Paint.Style.FILL
        for (p in particles) {
            val a = (240*(1f-p.t*p.t)).toInt().coerceIn(0,255)
            paint.color = Color.argb(a, 255, (45+p.t*130).toInt().coerceIn(0,255), 0)
            canvas.drawCircle(p.x, p.y, (3.5f/zoom)*(1f-p.t*0.4f), paint)
        }
    }

    private fun drawVehicles(canvas: Canvas) {
        for (v in vehicles) {
            val sz = (15f/zoom).coerceIn(9f, 20f)
            textPaint.textSize = sz
            textPaint.color = when (v.type) {
                Vehicle.Type.PLANE -> Color.argb(230, 200, 230, 255)
                Vehicle.Type.SHIP  -> Color.argb(230, 80, 190, 230)
            }
            canvas.drawText(if (v.type == Vehicle.Type.PLANE) "✈" else "⛵", v.x, v.y, textPaint)
        }
    }

    private fun drawTransportIcons(canvas: Canvas, eng: GameEngine) {
        for (c in eng.countries) {
            if (!c.isDiscovered) continue
            val x = gx(c.lon); val y = gy(c.lat)
            val r = getR(c.population)
            val sz = (9f/zoom).coerceIn(6f, 14f)
            textPaint.textSize = sz
            textPaint.color = Color.argb(160, 140, 200, 255)
            canvas.drawText("✈", x + r*0.8f, y - r*0.8f, textPaint)
            if (c.id in portIds) {
                textPaint.color = Color.argb(150, 60, 160, 210)
                canvas.drawText("⚓", x - r*0.8f, y - r*0.8f, textPaint)
            }
        }
    }

    private fun drawSelectedRing(canvas: Canvas, eng: GameEngine) {
        val id = selectedCountryId; if (id < 0 || id >= eng.countries.size) return
        val c = eng.countries[id]; val x = gx(c.lon); val y = gy(c.lat)
        val r = getR(c.population)
        val pulse = ((sin(anim.toDouble())+1.0)/2.0).toFloat()
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 3f/zoom; paint.color = Color.argb((160+pulse*90).toInt(),255,215,0)
        canvas.drawCircle(x, y, r+14f+pulse*8f, paint)
        paint.strokeWidth = 1.5f/zoom; paint.color = Color.argb((60+pulse*60).toInt(),255,255,130)
        canvas.drawCircle(x, y, r+24f+pulse*8f, paint)
        paint.style = Paint.Style.FILL
    }

    private fun drawFlags(canvas: Canvas, eng: GameEngine) {
        for (c in eng.countries) {
            if (!c.isDiscovered) continue
            val x = gx(c.lon); val y = gy(c.lat)
            val sz = (16f/zoom).coerceIn(10f, 22f)
            textPaint.textSize = sz; textPaint.color = Color.WHITE
            canvas.drawText(c.flag, x, y + sz/3f, textPaint)

            // Маленький пульсирующий индикатор заражения над флагом
            if (c.infectedCount > 0) {
                val pulse = (sin(c.pulsePhase.toDouble()).toFloat() + 1f) / 2f
                paint.style = Paint.Style.FILL
                paint.color = Color.argb((150 + (pulse*80).toInt()).coerceIn(0,255), 255, 40, 0)
                canvas.drawCircle(x, y - sz, (4f/zoom).coerceIn(2.5f, 7f), paint)
            }
        }
    }

    private fun drawLabels(canvas: Canvas, eng: GameEngine) {
        val ts = (14f/zoom).coerceIn(9f, 19f); val ps = (11f/zoom).coerceIn(8f, 15f)
        for (c in eng.countries) {
            if (!c.isDiscovered) continue
            val x = gx(c.lon); val r = getR(c.population); val baseY = gy(c.lat) + r + 2f
            textPaint.textSize = ts; textPaint.color = Color.argb(185, 210, 228, 255)
            canvas.drawText(c.name, x, baseY + ts + 2f, textPaint)
            if (c.infectionPercent > 0.01f) {
                val pct = (c.infectionPercent * 100).toInt()
                textPaint.textSize = ps
                textPaint.color = when { pct >= 75 -> Color.argb(220,255,35,0); pct >= 40 -> Color.argb(210,255,105,0); else -> Color.argb(190,255,175,0) }
                canvas.drawText("$pct%", x, baseY + ts + ps + 4f, textPaint)
            }
        }
    }

    private fun drawFloatTexts(canvas: Canvas) {
        for (ft in floatTexts) {
            textPaint.textSize = (20f/zoom).coerceIn(12f, 26f)
            textPaint.color = Color.argb(ft.alpha, Color.red(ft.color), Color.green(ft.color), Color.blue(ft.color))
            canvas.drawText(ft.text, ft.x, ft.y, textPaint)
        }
    }

    private fun drawEndOverlay(canvas: Canvas, title: String, color: Int, sub: String) {
        paint.color = Color.argb(190,0,0,0)
        canvas.drawRect(0f,mapH*0.27f,mapW,mapH*0.73f,paint)
        glowPaint.maskFilter = BlurMaskFilter(60f, BlurMaskFilter.Blur.NORMAL)
        glowPaint.color = Color.argb(60, Color.red(color), Color.green(color), Color.blue(color))
        canvas.drawRect(0f,mapH*0.27f,mapW,mapH*0.73f,glowPaint)
        glowPaint.maskFilter = BlurMaskFilter((22f/zoom).coerceIn(6f,35f), BlurMaskFilter.Blur.NORMAL)
        textPaint.textSize = 55f; textPaint.color = color
        canvas.drawText(title, mapW/2, mapH*0.46f, textPaint)
        textPaint.textSize = 22f; textPaint.color = Color.argb(200,205,205,210)
        canvas.drawText(sub, mapW/2, mapH*0.55f, textPaint)
    }

    private fun drawStartPrompt(canvas: Canvas) {
        val ty = mapH*0.42f
        paint.color = Color.argb(178,0,5,14)
        canvas.drawRoundRect(mapW*0.04f,ty,mapW*0.96f,ty+88f,14f,14f,paint)
        textPaint.textSize = 27f; textPaint.color = Color.parseColor("#00FFAA")
        canvas.drawText("Выберите страну для старта", mapW/2, ty+35f, textPaint)
        textPaint.textSize = 19f; textPaint.color = Color.argb(165,175,190,200)
        canvas.drawText("Нажмите на страну, чтобы начать заражение", mapW/2, ty+63f, textPaint)
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
                        dragged = true; panX = panStartX+dx; panY = panStartY+dy; clampPan(); invalidate()
                    }
                }
            }
            MotionEvent.ACTION_UP -> {
                if (!dragged && !scaleDetector.isInProgress) {
                    // Координата тапа в пространстве карты
                    val tapX = (event.x - panX) / zoom
                    val tapY = (event.y - panY) / zoom
                    val eng = engine ?: return true
                    for (c in eng.countries) {
                        val cx = gx(c.lon); val cy = gy(c.lat)
                        val r = getR(c.population) + 20f
                        if (sqrt((tapX-cx).pow(2) + (tapY-cy).pow(2)) < r) {
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
