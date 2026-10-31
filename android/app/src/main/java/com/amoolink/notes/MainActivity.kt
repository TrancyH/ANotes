package com.amoolink.notes

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.FileObserver
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.regex.Pattern

/**
 * ANotes P0:全 Web UI 壳 —— 列表/编辑/回收站/设置四页全部在 WebView 内
 * (assets/editor bundle,hash 路由)。原生只保留四件事(docs/01 §2.3):
 * 文件 IO 桥 / 系统主题与系统栏 / 返回键路由回退 / 外链转系统浏览器。
 * 目录:getExternalFilesDir/notes —— 免权限读写,adb 可直连,即 ALink 同步通道。
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var notesDir: File

    /** 当前编辑中的笔记(编辑页经 setCurrentNote 同步;FileObserver 防回环与热替换依赖)。 */
    @Volatile
    private var currentId = ""

    @Volatile
    private var lastSelfWriteAt = 0L

    @Volatile
    private var lastExternalWriteAt = 0L

    private var observer: FileObserver? = null
    private val ui = Handler(Looper.getMainLooper())

    private val idPattern = Pattern.compile("^[0-9]{8}-[0-9]{6}-[a-z0-9]{5}$")

    /** JS 侧 boot 完成(调 ready())前收到的 intent 动作先挂起,ready 时补投。 */
    @Volatile
    private var jsReady = false

    @Volatile
    private var pendingJs: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 主题与系统深浅色一致,消除启动白闪(零资源方案:直接用框架双主题)
        setTheme(
            if (isDarkTheme()) android.R.style.Theme_Material_NoActionBar
            else android.R.style.Theme_Material_Light_NoActionBar,
        )
        notesDir = File(getExternalFilesDir(null), "notes").apply { mkdirs() }
        web = WebView(this)
        setContentView(web)
        setupWebView()
        applySystemBars()
        startObserver()
        handleDeepIntents(intent)
    }

    /** singleTask:运行中再收 SEND/通知点击走这里(设计 §3.5)。 */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepIntents(intent)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.setBackgroundColor(Color.TRANSPARENT)
        web.addJavascriptInterface(Bridge(), "AmooNative")
        // 必须显式设置 WebChromeClient:否则 window.confirm()(回收站彻底删除/清空/
        // 批量删除二次确认)被 WebView 静默吞掉恒返回 false,删除功能整体失效(真机实测发现)
        web.webChromeClient = android.webkit.WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                val u = url ?: return false
                // http(s) 外链一律转系统浏览器(docs/01 §2.3);其余(file:// 等)留在壳内
                if (u.startsWith("http://") || u.startsWith("https://")) {
                    runCatching {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)))
                    }
                    return true
                }
                return false
            }
        }
        web.loadUrl("file:///android_asset/index.html")
    }

    /** 系统栏与页面同色(docs/01 §4.8);icon 亮暗随主题。 */
    private fun applySystemBars() {
        val dark = isDarkTheme()
        window.statusBarColor = if (dark) BG_DARK else BG_LIGHT
        window.navigationBarColor = if (dark) BG_DARK else BG_LIGHT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.setSystemBarsAppearance(
                if (dark) 0 else WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
            )
        } else {
            @Suppress("DEPRECATION")
            val flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (dark) 0 else flags
        }
    }

    private fun isDarkTheme(): Boolean =
        (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
            android.content.res.Configuration.UI_MODE_NIGHT_YES

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        applySystemBars()
        web.evaluateJavascript("window.__themeChange(${isDarkTheme()})", null)
    }

    /** 返回键:Web 路由优先消费(弹层→多选→编辑→子页),否则交还系统(列表页退到桌面)。 */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("window.__routeBack ? window.__routeBack() : 'false'") { value ->
            ui.post {
                if (!value.contains("true")) {
                    @Suppress("DEPRECATION")
                    super.onBackPressed()
                }
            }
        }
    }

    // ── P1:深链入口(分享接收 / 通知点击直达)与提醒闹钟 ────

    /** ACTION_SEND(text/plain) → __shareReceived;noteId extra → __openNote;shortcut extra → __shortcut。 */
    private fun handleDeepIntents(intent: Intent?) {
        val js = when {
            intent?.action == Intent.ACTION_SEND && intent.type == "text/plain" -> {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
                "window.__shareReceived(${JSONObject.quote(text)})"
            }
            intent?.hasExtra(EXTRA_NOTE_ID) == true -> {
                val id = intent.getStringExtra(EXTRA_NOTE_ID) ?: return
                if (!idPattern.matcher(id).matches()) return
                "window.__openNote(${JSONObject.quote(id)})"
            }
            intent?.getStringExtra(EXTRA_SHORTCUT) == "create" -> "window.__shortcut('create')"
            intent?.getStringExtra(EXTRA_SHORTCUT) == "search" -> "window.__shortcut('search')"
            else -> return
        }
        if (jsReady) web.evaluateJavascript(js, null) else pendingJs = js
    }

    private fun ensureReminderChannel() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_REMINDER) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_REMINDER, "笔记提醒", NotificationManager.IMPORTANCE_HIGH),
            )
        }
    }

    private fun reminderPendingIntent(id: String): PendingIntent {
        val fire = Intent(this, ReminderReceiver::class.java).putExtra(EXTRA_NOTE_ID, id)
        return PendingIntent.getBroadcast(
            this,
            id.hashCode(),
            fire,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun startObserver() {
        val mask = FileObserver.CLOSE_WRITE or FileObserver.MOVED_TO or FileObserver.DELETE
        observer = object : FileObserver(notesDir.absolutePath, mask) {
            override fun onEvent(event: Int, path: String?) {
                if (path == null || !path.endsWith(".md")) return
                ui.post { onExternalChange(event, path) }
            }
        }
        observer?.startWatching()
    }

    /**
     * 桌面端同步写入:当前笔记热替换;其余刷新列表;删除当前笔记则退出编辑。
     * 入口统一拦截自写窗口内的事件(writeNoteFile/deleteNote 均已提前置位时间戳):
     * 自身写入不更新 lastExternalWriteAt(设置页「上次从电脑更新」不失真),
     * 也不外溢 __notesChanged(JS 侧自行刷新,免整页重渲染丢搜索焦点)。
     */
    private fun onExternalChange(event: Int, name: String) {
        if (System.currentTimeMillis() - lastSelfWriteAt < 1500) return
        lastExternalWriteAt = System.currentTimeMillis()
        val id = name.removeSuffix(".md")
        if (id == currentId) {
            if (event == FileObserver.DELETE) {
                currentId = ""
                web.evaluateJavascript("window.__noteRemoved(${JSONObject.quote(id)})", null)
                Toast.makeText(this, "该笔记已从电脑删除", Toast.LENGTH_SHORT).show()
                return
            }
            val raw = readNoteFile(id) ?: return
            val payload = JSONObject().put("id", id).put("raw", raw)
            web.evaluateJavascript("window.__switch(${JSONObject.quote(payload.toString())})", null)
            Toast.makeText(this, "已从电脑同步更新", Toast.LENGTH_SHORT).show()
        }
        web.evaluateJavascript("window.__notesChanged()", null)
    }

    // ── 文件读写(原子写,防回环)─────────────────────────

    private fun readNoteFile(id: String): String? = try {
        File(notesDir, "$id.md").readText()
    } catch (_: Exception) {
        null
    }

    private fun writeNoteFile(id: String, raw: String): Boolean {
        val tmp = File(notesDir, "$id.md.tmp")
        val target = File(notesDir, "$id.md")
        return try {
            // 先开自写窗口再产生任何文件事件:防回环判定(DELETE/MOVED_TO 分支)依赖该时间戳,
            // 若写完才更新,DELETE 事件先到主线程时仍是旧值,拦不住
            lastSelfWriteAt = System.currentTimeMillis()
            tmp.writeText(raw)
            // rename(2) 对已存在目标原子覆盖;不预先 delete——那会产生 FileObserver.DELETE,
            // 被 onExternalChange 误判为「电脑端删除当前笔记」把用户踢出编辑页
            if (tmp.renameTo(target)) return true
            // 极端失败路径回退(delete 后重命名;此处的 DELETE 已被自写窗口抑制)
            target.delete()
            tmp.renameTo(target)
        } catch (_: Exception) {
            false
        }
    }

    private fun listNoteFiles(): List<File> =
        notesDir.listFiles { f -> f.name.endsWith(".md") }?.sortedByDescending { it.lastModified() }
            ?: emptyList()

    // ── JS 桥(JS 线程调用,文件 IO 直接执行)────────────────

    inner class Bridge {
        @JavascriptInterface
        fun writeNote(id: String, raw: String): Boolean {
            if (!idPattern.matcher(id).matches()) return false
            return writeNoteFile(id, raw)
        }

        @JavascriptInterface
        fun readNote(id: String): String = readNoteFile(id) ?: ""

        @JavascriptInterface
        fun listNotes(): String {
            val arr = org.json.JSONArray()
            for (f in listNoteFiles()) {
                arr.put(JSONObject().put("id", f.nameWithoutExtension).put("lastModified", f.lastModified()))
            }
            return arr.toString()
        }

        @JavascriptInterface
        fun deleteNote(id: String): Boolean {
            if (!idPattern.matcher(id).matches()) return false
            // 删除也是本端写:先开自写窗口,DELETE 事件不外溢为 __notesChanged(JS 自行刷新)
            lastSelfWriteAt = System.currentTimeMillis()
            return File(notesDir, "$id.md").delete()
        }

        /** 兼容保留(旧 glue 调用;全 Web UI 后标题由 Web 渲染)。 */
        @JavascriptInterface
        fun setTitle(title: String) = Unit

        /** JS boot 完成:此后深链 intent 可直接投递,并补投挂起的动作。 */
        @JavascriptInterface
        fun ready() {
            jsReady = true
            pendingJs?.let { js ->
                pendingJs = null
                ui.post { web.evaluateJavascript(js, null) }
            }
        }

        @JavascriptInterface
        fun log(message: String) {
            android.util.Log.d("AmooNotes", message)
        }

        /** P0 新增:http(s) 外链转系统浏览器。 */
        @JavascriptInterface
        fun openExternal(url: String) {
            if (!url.startsWith("http://") && !url.startsWith("https://")) return
            ui.post {
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            }
        }

        /** P0 新增:'dark' | 'light'(同步返回)。 */
        @JavascriptInterface
        fun getSystemTheme(): String = if (isDarkTheme()) "dark" else "light"

        /** P0 新增:可观测同步状态(JSON)。 */
        @JavascriptInterface
        fun getStatus(): String =
            JSONObject()
                .put("lastExternalWriteAt", lastExternalWriteAt)
                .put("lastSelfWriteAt", lastSelfWriteAt)
                .toString()

        /** P0 新增:编辑页进入/离开同步当前笔记 id。 */
        @JavascriptInterface
        fun setCurrentNote(id: String) {
            currentId = id
        }

        /** P1 新增:分享纯文本(标题+正文)到系统(设计 §3.5)。 */
        @JavascriptInterface
        fun shareText(text: String) {
            ui.post {
                runCatching {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, text)
                    }
                    startActivity(Intent.createChooser(send, "分享笔记"))
                }
            }
        }

        /** P1 新增:注册精确闹钟;remindAt 为 ISO 8601 UTC,已过期/非法返回 false(设计 §3.4)。 */
        @JavascriptInterface
        fun setReminder(id: String, remindAt: String): Boolean {
            if (!idPattern.matcher(id).matches()) return false
            val triggerAt = try {
                Instant.parse(remindAt).toEpochMilli()
            } catch (_: Exception) {
                return false
            }
            if (triggerAt <= System.currentTimeMillis()) return false
            ensureReminderChannel()
            val am = getSystemService(AlarmManager::class.java) ?: return false
            val pi = reminderPendingIntent(id)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                // 精确闹钟降级:setWindow 十分钟窗口内近似触发(设计 §3.4)
                am.setWindow(AlarmManager.RTC_WAKEUP, triggerAt, 10 * 60_000L, pi)
            } else {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            }
            return true
        }

        /** P1 新增:注销闹钟。 */
        @JavascriptInterface
        fun cancelReminder(id: String) {
            getSystemService(AlarmManager::class.java)?.cancel(reminderPendingIntent(id))
        }

        /** P1 新增:运行时申请 POST_NOTIFICATIONS(API 33+;以下系统默认已授予)。 */
        @JavascriptInterface
        fun requestNotificationPermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                ui.post {
                    requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 100)
                }
            }
        }

        /** P1 新增:提醒授权状态 JSON(设置页数据源)。 */
        @JavascriptInterface
        fun getReminderStatus(): String {
            val notifications = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED
            } else {
                true
            }
            val exactAlarms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() ?: false
            } else {
                true
            }
            return JSONObject()
                .put("notifications", notifications)
                .put("exactAlarms", exactAlarms)
                .toString()
        }

        /** P1 新增:跳系统精确闹钟授权页(API 31+)。 */
        @JavascriptInterface
        fun openExactAlarmSettings() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                ui.post {
                    runCatching {
                        startActivity(
                            Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM),
                        )
                    }
                }
            }
        }
    }

    companion object {
        internal val BG_DARK = Color.parseColor("#0e0f13")
        internal val BG_LIGHT = Color.parseColor("#f7f8fa")
        /** 提醒通知渠道 id(ReminderReceiver 同用;minSdk 26 起必须渠道化)。 */
        const val CHANNEL_REMINDER = "notes-reminder"
        private const val EXTRA_NOTE_ID = "noteId"
        private const val EXTRA_SHORTCUT = "shortcut"
    }
}
