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
    private val landPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val pathTemp = Path()

    private var mapW = 0f; private var mapH = 0f
    private var anim = 0f
    private var lastGlowZoom = -1f

    // Карта: полигоны континентов
    private data class LandShape(val path: Path)
    private val landShapes = ArrayList<LandShape>(10)

    // Звёздное небо
    private class Star(val x: Float, val y: Float, val r: Float, val phase: Float)
    private val stars = ArrayList<Star>(100)

    // Транспорт (самолёты и корабли)
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

    // Страны с морскими портами
    private val portIds = setOf(1, 4, 5, 6, 7, 9, 11, 12, 13, 14, 17, 18, 20, 21, 22)

    init {
        setLayerType(LAYER_TYPE_SOFTWARE, null)
        scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(det: ScaleGestureDetector): Boolean {
                val prev = zoom
                zoom = (zoom * det.scaleFactor).coerceIn(0.7f, 5f)
                panX = det.focusX - (det.focusX - panX) * (zoom / prev)
                panY = det.focusY - (det.focusY - panY) * (zoom / prev)
                clampPan(); invalidate(); return true
            }
        })
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        mapW = w.toFloat(); mapH = h.toFloat()
        buildStars(); buildContinentMap(); onMapReady?.invoke()
    }

    private fun buildStars() {
        stars.clear()
        val r = Random(42L)
        repeat(100) { stars += Star(r.nextFloat()*mapW, r.nextFloat()*mapH, 0.5f+r.nextFloat()*2f, r.nextFloat()*(2*PI).toFloat()) }
    }

    private fun buildContinentMap() {
        landShapes.clear()
        fun poly(vararg pts: Float): Path {
            val p = Path()
            p.moveTo(pts[0]*mapW, pts[1]*mapH)
            var i = 2; while (i < pts.size) { p.lineTo(pts[i]*mapW, pts[i+1]*mapH); i += 2 }
            p.close(); return p
        }
        // Северная Америка
        landShapes += LandShape(poly(
            0.05f,0.04f, 0.30f,0.04f, 0.36f,0.10f, 0.34f,0.17f,
            0.30f,0.24f, 0.27f,0.31f, 0.22f,0.39f, 0.20f,0.44f,
            0.13f,0.43f, 0.09f,0.36f, 0.06f,0.27f, 0.04f,0.16f))
        // Южная Америка
        landShapes += LandShape(poly(
            0.16f,0.46f, 0.22f,0.42f, 0.29f,0.44f, 0.35f,0.51f,
            0.35f,0.62f, 0.32f,0.72f, 0.27f,0.79f, 0.22f,0.77f,
            0.18f,0.70f, 0.15f,0.59f, 0.15f,0.50f))
        // Европа (материк)
        landShapes += LandShape(poly(
            0.38f,0.12f, 0.55f,0.11f, 0.58f,0.17f, 0.57f,0.24f,
            0.54f,0.32f, 0.50f,0.36f, 0.45f,0.35f, 0.40f,0.33f,
            0.37f,0.27f, 0.37f,0.17f))
        // Британские острова
        landShapes += LandShape(poly(
            0.40f,0.13f, 0.44f,0.12f, 0.46f,0.16f, 0.45f,0.22f,
            0.41f,0.22f, 0.39f,0.17f))
        // Африка
        landShapes += LandShape(poly(
            0.37f,0.33f, 0.60f,0.33f, 0.64f,0.40f, 0.64f,0.52f,
            0.61f,0.65f, 0.56f,0.75f, 0.51f,0.79f, 0.46f,0.76f,
            0.42f,0.68f, 0.38f,0.57f, 0.37f,0.45f))
        // Азия (основной массив — Россия, Ближний Восток, Южная Азия, Китай)
        landShapes += LandShape(poly(
            0.56f,0.09f, 0.96f,0.08f, 0.96f,0.32f, 0.92f,0.39f,
            0.89f,0.52f, 0.84f,0.62f, 0.78f,0.64f, 0.72f,0.58f,
            0.66f,0.53f, 0.62f,0.48f, 0.59f,0.42f, 0.57f,0.34f,
            0.57f,0.24f, 0.56f,0.16f))
        // Японские острова
        landShapes += LandShape(poly(
            0.83f,0.18f, 0.89f,0.19f, 0.91f,0.27f, 0.88f,0.32f,
            0.84f,0.30f, 0.82f,0.23f))
        // Австралия
        landShapes += LandShape(poly(
            0.78f,0.57f, 0.94f,0.57f, 0.97f,0.63f, 0.96f,0.74f,
            0.90f,0.81f, 0.83f,0.82f, 0.77f,0.75f, 0.76f,0.65f))
        // Гренландия
        landShapes += LandShape(poly(
            0.28f,0.02f, 0.40f,0.01f, 0.43f,0.07f, 0.38f,0.12f,
            0.32f,0.10f, 0.27f,0.06f))
    }

    private fun clampPan() {
        val mx = mapW*(zoom-1f)*0.65f + mapW*0.18f
        val my = mapH*(zoom-1f)*0.65f + mapH*0.18f
        panX = panX.coerceIn(-mx, mx); panY = panY.coerceIn(-my, my)
    }

    private fun wx(x: Float) = x * mapW
    private fun wy(y: Float) = y * mapH
    private fun getR(pop: Long) = (20f + ((ln(pop.coerceAtLeast(1L).toFloat()) - ln(20_000_000f)) / (ln(1_400_000_000f) - ln(20_000_000f))).coerceIn(0f,1f)*22f)

    fun addFloatText(countryId: Int, text: String, color: Int) {
        val c = engine?.countries?.getOrNull(countryId) ?: return
        floatTexts += FloatText(wx(c.x), wy(c.y) - getR(c.population) - 8f, text, color)
    }

    fun update() {
        anim += 0.04f
        val eng = engine ?: return

        // Частицы заражения
        if (eng.gameState == GameEngine.GameState.RUNNING && Random.nextFloat() < 0.20f) {
            val src = eng.countries.filter { it.infectedCount > 300 }.randomOrNull()
            val dstId = src?.connections?.randomOrNull()
            if (src != null && dstId != null && !eng.countries[dstId].isFullyInfected)
                particles += Particle(wx(src.x), wy(src.y), wx(eng.countries[dstId].x), wy(eng.countries[dstId].y))
        }
        val pi = particles.iterator(); while (pi.hasNext()) { if (pi.next().also { it.t += 0.028f }.done) pi.remove() }

        // Транспорт (самолёты и корабли)
        if (eng.gameState == GameEngine.GameState.RUNNING && Random.nextFloat() < 0.04f && vehicles.size < 14) {
            val src = eng.countries.filter { it.infectedCount > 500 }.randomOrNull()
            val dstId = src?.connections?.randomOrNull()
            if (src != null && dstId != null) {
                val dst = eng.countries[dstId]
                val sx = wx(src.x); val sy = wy(src.y)
                val ex = wx(dst.x); val ey = wy(dst.y)
                val len = sqrt((ex-sx).pow(2) + (ey-sy).pow(2))
                if (len > 5f) {
                    val mx = (sx+ex)/2f; val my = (sy+ey)/2f
                    val nx = -(ey-sy)/len; val ny = (ex-sx)/len
                    val curveMag = len * 0.22f
                    val dist = sqrt((src.x-dst.x).pow(2) + (src.y-dst.y).pow(2))
                    val isAir = dst.climate == Climate.ISLAND || src.climate == Climate.ISLAND || dist > 0.28f
                    val isSea = !isAir && dst.id in portIds && src.id in portIds && dist > 0.14f
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
            glowPaint.maskFilter = BlurMaskFilter((28f/zoom).coerceIn(5f, 40f), BlurMaskFilter.Blur.NORMAL)
            lastGlowZoom = zoom
        }

        canvas.save()
        canvas.translate(panX, panY)
        canvas.scale(zoom, zoom)

        drawLandMasses(canvas)
        drawGrid(canvas)
        drawConnections(canvas, eng)
        drawParticles(canvas)
        drawVehicles(canvas)
        for (c in eng.countries) drawCountry(canvas, c)
        drawTransportIcons(canvas, eng)
        drawSelectedRing(canvas, eng)
        drawLabels(canvas, eng)
        drawFloatTexts(canvas)

        canvas.restore()

        when (eng.gameState) {
            GameEngine.GameState.WON    -> drawEndOverlay(canvas, "🏆 ПОБЕДА!", Color.parseColor("#00FF88"), "Человечество заражено!")
            GameEngine.GameState.LOST   -> drawEndOverlay(canvas, "💀 ПОРАЖЕНИЕ", Color.parseColor("#FF4444"), "Лекарство создано. Вы проиграли.")
            GameEngine.GameState.WAITING -> drawStartPrompt(canvas)
            else -> {}
        }

        if (zoom > 1.12f) {
            textPaint.textSize = 13f
            textPaint.color = Color.argb(110, 140, 165, 200)
            canvas.drawText("×${"%.1f".format(zoom)}", mapW - 28f, mapH - 12f, textPaint)
        }
    }

    private fun drawOcean(canvas: Canvas) {
        paint.shader = RadialGradient(mapW/2, mapH/2, maxOf(mapW, mapH)*0.85f,
            Color.parseColor("#041628"), Color.parseColor("#020C18"), Shader.TileMode.CLAMP)
        paint.style = Paint.Style.FILL
        canvas.drawRect(0f, 0f, mapW, mapH, paint)
        paint.shader = null
    }

    private fun drawStars(canvas: Canvas) {
        paint.style = Paint.Style.FILL
        for (s in stars) {
            val b = ((sin((anim*0.38f+s.phase).toDouble())+1.0)/2.0).toFloat()
            paint.color = Color.argb((40+b*130).toInt(), 160, 185, 255)
            canvas.drawCircle(s.x, s.y, s.r, paint)
        }
    }

    private fun drawLandMasses(canvas: Canvas) {
        landPaint.style = Paint.Style.FILL
        landPaint.color = Color.parseColor("#0D2418")
        for (shape in landShapes) canvas.drawPath(shape.path, landPaint)

        landPaint.style = Paint.Style.STROKE
        landPaint.color = Color.parseColor("#1A3828")
        landPaint.strokeWidth = 1.2f / zoom
        for (shape in landShapes) canvas.drawPath(shape.path, landPaint)
        landPaint.style = Paint.Style.FILL
    }

    private fun drawGrid(canvas: Canvas) {
        val sw = 0.5f / zoom
        paint.style = Paint.Style.STROKE
        // Меридианы
        for (i in 0..12) {
            paint.color = Color.argb(14, 40, 120, 200)
            paint.strokeWidth = sw
            canvas.drawLine(i*mapW/12f, 0f, i*mapW/12f, mapH, paint)
        }
        // Параллели
        for (i in 0..8) {
            paint.color = Color.argb(14, 40, 120, 200)
            paint.strokeWidth = sw
            canvas.drawLine(0f, i*mapH/8f, mapW, i*mapH/8f, paint)
        }
        // Экватор
        paint.color = Color.argb(35, 50, 170, 230); paint.strokeWidth = sw*2
        canvas.drawLine(0f, mapH*0.50f, mapW, mapH*0.50f, paint)
        paint.style = Paint.Style.FILL
    }

    private fun drawConnections(canvas: Canvas, eng: GameEngine) {
        for (c in eng.countries) {
            for (connId in c.connections) {
                if (connId <= c.id) continue
                val o = eng.countries[connId]
                val bothInf = c.infectedCount > 0 && o.infectedCount > 0
                val disc = c.isDiscovered && o.isDiscovered
                val isAir = o.climate == Climate.ISLAND || c.climate == Climate.ISLAND ||
                    sqrt((c.x-o.x).pow(2)+(c.y-o.y).pow(2)) > 0.28f
                when {
                    bothInf && disc -> { connPaint.color = Color.argb(90, 255, 55, 0); connPaint.strokeWidth = 2f/zoom }
                    disc -> { connPaint.color = Color.argb(isAir.let { if (it) 70 else 50 }, 40, 155, 215); connPaint.strokeWidth = 1.2f/zoom }
                    else -> { connPaint.color = Color.argb(15, 30, 75, 115); connPaint.strokeWidth = 0.5f/zoom }
                }
                // Пунктир для авиамаршрутов при обнаружении
                if (isAir && disc) connPaint.pathEffect = DashPathEffect(floatArrayOf(8f/zoom, 5f/zoom), 0f)
                else connPaint.pathEffect = null

                val x1=wx(c.x); val y1=wy(c.y); val x2=wx(o.x); val y2=wy(o.y)
                val len = sqrt((x2-x1).pow(2)+(y2-y1).pow(2))
                if (len > 0f) {
                    val mx=(x1+x2)/2f; val my=(y1+y2)/2f
                    val nx=-(y2-y1)/len; val ny=(x2-x1)/len
                    val off = (len*0.08f).coerceAtMost(mapW*0.04f)
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
            canvas.drawCircle(p.x, p.y, (4.5f/zoom)*(1f-p.t*0.4f), paint)
        }
    }

    private fun drawVehicles(canvas: Canvas) {
        for (v in vehicles) {
            val sz = (16f/zoom).coerceIn(10f, 22f)
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
            val x = wx(c.x); val y = wy(c.y); val r = getR(c.population)
            val sz = (11f/zoom).coerceIn(8f, 16f)
            textPaint.textSize = sz
            // Аэропорт
            textPaint.color = Color.argb(170, 140, 200, 255)
            canvas.drawText("✈", x + r*0.72f, y - r*0.72f, textPaint)
            // Морской порт
            if (c.id in portIds) {
                textPaint.color = Color.argb(160, 60, 160, 210)
                canvas.drawText("⚓", x - r*0.72f, y - r*0.72f, textPaint)
            }
        }
    }

    private fun drawCountry(canvas: Canvas, c: Country) {
        val x=wx(c.x); val y=wy(c.y)
        val baseR=getR(c.population)
        val pulse=sin(c.pulsePhase.toDouble()).toFloat()
        val r=baseR + if(c.infectedCount>0) pulse*4.5f else 0f

        if (c.isDiscovered) {
            val (gc,ga) = when {
                c.isFullyInfected -> Color.parseColor("#FF0000") to 150
                c.infectionPercent>0.5f -> Color.parseColor("#CC1800") to 120
                c.infectionPercent>0.01f -> Color.parseColor("#FF6000") to 85
                else -> Color.parseColor("#00AADD") to 55
            }
            glowPaint.color = Color.argb(ga, Color.red(gc), Color.green(gc), Color.blue(gc))
            canvas.drawCircle(x, y, r+18f, glowPaint)
        }

        paint.style=Paint.Style.FILL
        paint.shader = when {
            !c.isDiscovered -> RadialGradient(x,y,r, Color.argb(90,22,45,65), Color.argb(55,8,18,30), Shader.TileMode.CLAMP)
            c.infectionPercent<=0f -> RadialGradient(x,y,r, Color.parseColor("#1E7085"), Color.parseColor("#072030"), Shader.TileMode.CLAMP)
            c.infectionPercent<0.5f -> RadialGradient(x,y,r, Color.parseColor("#E05200"), Color.parseColor("#601200"), Shader.TileMode.CLAMP)
            else -> RadialGradient(x,y,r, Color.parseColor("#FF1200"), Color.parseColor("#860000"), Shader.TileMode.CLAMP)
        }
        canvas.drawCircle(x,y,r,paint); paint.shader=null

        if (c.infectionPercent in 0.01f..0.99f) {
            paint.color=Color.argb(105,255,18,0)
            canvas.drawArc(x-r,y-r,x+r,y+r,-90f,360f*c.infectionPercent,true,paint)
        }

        paint.style=Paint.Style.STROKE; paint.strokeWidth=2f/zoom
        paint.color = when {
            !c.isDiscovered -> Color.argb(38,0,85,135)
            c.infectionPercent<=0f -> Color.argb(185,0,205,255)
            c.infectionPercent<0.5f -> Color.argb(195,255,105,0)
            else -> Color.argb(215,255,28,0)
        }
        canvas.drawCircle(x,y,r,paint); paint.style=Paint.Style.FILL

        textPaint.textSize=(19f/zoom).coerceIn(11f,24f)
        textPaint.color=Color.WHITE
        canvas.drawText(c.flag, x, y+(7f/zoom).coerceIn(4f,10f), textPaint)
    }

    private fun drawSelectedRing(canvas: Canvas, eng: GameEngine) {
        val id=selectedCountryId; if(id<0||id>=eng.countries.size) return
        val c=eng.countries[id]; val x=wx(c.x); val y=wy(c.y); val r=getR(c.population)
        val pulse=((sin(anim.toDouble())+1.0)/2.0).toFloat()
        paint.style=Paint.Style.STROKE
        paint.strokeWidth=3f/zoom; paint.color=Color.argb((165+pulse*90).toInt(),255,215,0)
        canvas.drawCircle(x,y,r+13f+pulse*9f,paint)
        paint.strokeWidth=1.5f/zoom; paint.color=Color.argb((65+pulse*70).toInt(),255,255,130)
        canvas.drawCircle(x,y,r+23f+pulse*9f,paint)
        paint.style=Paint.Style.FILL
    }

    private fun drawLabels(canvas: Canvas, eng: GameEngine) {
        val ts=(17f/zoom).coerceIn(10f,22f); val ps=(13f/zoom).coerceIn(9f,17f)
        for (c in eng.countries) {
            if (!c.isDiscovered) continue
            val x=wx(c.x); val r=getR(c.population); val baseY=wy(c.y)+r+4f
            textPaint.textSize=ts; textPaint.color=Color.argb(190,210,228,255)
            canvas.drawText(c.name, x, baseY+ts+2f, textPaint)
            if (c.infectionPercent>0.01f) {
                val pct=(c.infectionPercent*100).toInt()
                textPaint.textSize=ps
                textPaint.color = when { pct>=75->Color.argb(220,255,35,0); pct>=40->Color.argb(210,255,105,0); else->Color.argb(190,255,175,0) }
                canvas.drawText("$pct%", x, baseY+ts+ps+4f, textPaint)
            }
        }
    }

    private fun drawFloatTexts(canvas: Canvas) {
        for (ft in floatTexts) {
            textPaint.textSize=(22f/zoom).coerceIn(12f,28f)
            textPaint.color=Color.argb(ft.alpha, Color.red(ft.color), Color.green(ft.color), Color.blue(ft.color))
            canvas.drawText(ft.text, ft.x, ft.y, textPaint)
        }
    }

    private fun drawEndOverlay(canvas: Canvas, title: String, color: Int, sub: String) {
        paint.color=Color.argb(190,0,0,0)
        canvas.drawRect(0f,mapH*0.27f,mapW,mapH*0.73f,paint)
        glowPaint.maskFilter=BlurMaskFilter(60f,BlurMaskFilter.Blur.NORMAL)
        glowPaint.color=Color.argb(60,Color.red(color),Color.green(color),Color.blue(color))
        canvas.drawRect(0f,mapH*0.27f,mapW,mapH*0.73f,glowPaint)
        glowPaint.maskFilter=BlurMaskFilter((28f/zoom).coerceIn(6f,40f),BlurMaskFilter.Blur.NORMAL)
        textPaint.textSize=55f; textPaint.color=color
        canvas.drawText(title,mapW/2,mapH*0.46f,textPaint)
        textPaint.textSize=22f; textPaint.color=Color.argb(200,205,205,210)
        canvas.drawText(sub,mapW/2,mapH*0.55f,textPaint)
    }

    private fun drawStartPrompt(canvas: Canvas) {
        val ty=mapH*0.42f
        paint.color=Color.argb(178,0,5,14)
        canvas.drawRoundRect(mapW*0.04f,ty,mapW*0.96f,ty+88f,14f,14f,paint)
        textPaint.textSize=27f; textPaint.color=Color.parseColor("#00FFAA")
        canvas.drawText("Выберите страну для старта",mapW/2,ty+35f,textPaint)
        textPaint.textSize=19f; textPaint.color=Color.argb(165,175,190,200)
        canvas.drawText("Нажмите на страну, чтобы начать заражение",mapW/2,ty+63f,textPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { dragStartX=event.x; dragStartY=event.y; panStartX=panX; panStartY=panY; dragged=false }
            MotionEvent.ACTION_MOVE -> {
                if (event.pointerCount==1 && !scaleDetector.isInProgress) {
                    val dx=event.x-dragStartX; val dy=event.y-dragStartY
                    if (abs(dx)>10f||abs(dy)>10f) { dragged=true; panX=panStartX+dx; panY=panStartY+dy; clampPan(); invalidate() }
                }
            }
            MotionEvent.ACTION_UP -> {
                if (!dragged && !scaleDetector.isInProgress) {
                    val wx=(event.x-panX)/zoom; val wy=(event.y-panY)/zoom
                    val tx=wx/mapW; val ty=wy/mapH
                    val eng=engine ?: return true
                    for (c in eng.countries) {
                        val dx=tx-c.x; val dy=ty-c.y
                        if (sqrt(dx*dx+dy*dy)*mapW < getR(c.population)+22f) { onCountryClicked?.invoke(c.id); return true }
                    }
                }
            }
            MotionEvent.ACTION_POINTER_DOWN -> dragged=true
        }
        return true
    }
}
