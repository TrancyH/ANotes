package com.amoolink.notes

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
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
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.setBackgroundColor(Color.TRANSPARENT)
        web.addJavascriptInterface(Bridge(), "AmooNative")
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

    /** 桌面端同步写入:当前笔记热替换(1.5s 防自身回环);其余刷新列表;删除当前笔记则退出编辑。 */
    private fun onExternalChange(event: Int, name: String) {
        lastExternalWriteAt = System.currentTimeMillis()
        val id = name.removeSuffix(".md")
        if (id == currentId) {
            if (event == FileObserver.DELETE) {
                currentId = ""
                web.evaluateJavascript("window.__noteRemoved(${JSONObject.quote(id)})", null)
                Toast.makeText(this, "该笔记已从电脑删除", Toast.LENGTH_SHORT).show()
                return
            }
            if (System.currentTimeMillis() - lastSelfWriteAt < 1500) return
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
            tmp.writeText(raw)
            if (target.exists()) target.delete()
            val ok = tmp.renameTo(target)
            if (ok) lastSelfWriteAt = System.currentTimeMillis()
            ok
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
            return File(notesDir, "$id.md").delete()
        }

        /** 兼容保留(旧 glue 调用;全 Web UI 后标题由 Web 渲染)。 */
        @JavascriptInterface
        fun setTitle(title: String) = Unit

        @JavascriptInterface
        fun ready() = Unit

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
    }

    private companion object {
        val BG_DARK = Color.parseColor("#0e0f13")
        val BG_LIGHT = Color.parseColor("#f7f8fa")
    }
}
