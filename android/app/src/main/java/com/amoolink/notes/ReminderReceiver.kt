package com.amoolink.notes

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.io.File

/**
 * P1 提醒链路终点:AlarmManager 到期 → 发通知(docs/01 §3.4)。
 * 通知点击回到 MainActivity(携带 noteId extra)→ handleSendIntent → __openNote。
 * Kotlin 不做 frontmatter 序列化(约束);仅正则读取 title 行作通知文案,不回写文件。
 */
class ReminderReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_NOTE_ID) ?: return
        val title = noteTitle(context, id)

        val tap = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NOTE_ID, id)
        }
        val pending = PendingIntent.getActivity(
            context,
            id.hashCode(),
            tap,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = Notification.Builder(context, MainActivity.CHANNEL_REMINDER)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("笔记提醒")
            .setContentText(if (title.isNotBlank()) title else "点击查看笔记")
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()

        context.getSystemService(NotificationManager::class.java)?.notify(id.hashCode(), notification)
    }

    /** 读 .md 的 title: 行作文案(只读展示,不解析不回写;失败返回空串)。 */
    private fun noteTitle(context: Context, id: String): String = try {
        val dir = File(context.getExternalFilesDir(null), "notes")
        val raw = File(dir, "$id.md").readText()
        TITLE_RE.find(raw)?.groupValues?.get(1)?.replace("\\n", " ")?.trim() ?: ""
    } catch (_: Exception) {
        ""
    }

    private companion object {
        const val EXTRA_NOTE_ID = "noteId"
        val TITLE_RE = Regex("^title: (.+)$", RegexOption.MULTILINE)
    }
}
