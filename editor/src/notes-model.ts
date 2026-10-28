import type { NoteColor, NoteFile, NoteListItem } from './types'
import { NOTE_COLORS } from './types'
import { noteExcerpt, noteWordCount } from './frontmatter'

/**
 * 列表/回收站页的纯逻辑(无 DOM,单测覆盖):
 * 摘要组装、待办进度、搜索、四色过滤、回收站 TTL、相对时间。
 */

/** 回收站自动彻底删除期限(与 ALink tombstone TTL 对齐)。 */
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function isNoteColor(v: unknown): v is NoteColor {
  return typeof v === 'string' && (NOTE_COLORS as readonly string[]).includes(v)
}

/** NoteFile → 列表条目(摘要/字数即时计算;mtime 由调用方传入)。 */
export function toListItem(note: NoteFile, mtime = Date.now()): NoteListItem {
  return {
    ...note,
    mtime,
    excerpt: noteExcerpt(note.markdown),
    wordCount: noteWordCount(note.markdown),
  }
}

/** 正文待办清单进度(TaskList 语法);无待办 total=0。 */
export function todoProgress(markdown: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const m of markdown.matchAll(/^[ \t]*[-*+][ \t]+\[([ xX])\]/gm)) {
    total++
    if (m[1] !== ' ') done++
  }
  return { done, total }
}

/** 搜索:标题 + 摘要包含匹配(大小写不敏感,query 去空白)。 */
export function searchNotes(items: NoteListItem[], query: string): NoteListItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter(
    (n) => n.title.toLowerCase().includes(q) || n.excerpt.toLowerCase().includes(q),
  )
}

/** 四色过滤;'all' 不过滤。 */
export function filterByColor(items: NoteListItem[], color: NoteColor | 'all'): NoteListItem[] {
  if (color === 'all') return items
  return items.filter((n) => n.color === color)
}

/** 回收站过期(trashedAt 起满 TTL)→ 应物理删除。 */
export function isTrashExpired(
  note: Pick<NoteListItem, 'trashedAt'>,
  now = Date.now(),
): boolean {
  if (!note.trashedAt) return false
  const t = new Date(note.trashedAt).getTime()
  if (Number.isNaN(t)) return false
  return now - t >= TRASH_TTL_MS
}

/** 拆分存活 / 回收站两区(各自内排序由调用方做)。 */
export function splitTrash<T extends { trashedAt: string | null }>(items: T[]): {
  live: T[]
  trashed: T[]
} {
  const live: T[] = []
  const trashed: T[] = []
  for (const n of items) (n.trashedAt ? trashed : live).push(n)
  return { live, trashed }
}

/** 置顶分区 + updatedAt 倒序(与桌面一致)。 */
export function sortForList<T extends { pinned: boolean; updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })
}

/** 回收站内按 trashedAt 倒序(最近删的在前)。 */
export function sortForTrash<T extends { trashedAt: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''))
}

const CONFLICT_RE = /-冲突-\d{8}-\d{4}$/

/** 冲突双副本识别(标题后缀 `-冲突-yyyyMMdd-HHmm`)。 */
export function isConflictCopy(title: string): boolean {
  return CONFLICT_RE.test(title)
}

/**
 * 相对时间:刚刚 / n 分钟前 / n 小时前 / 昨天 HH:mm / 周X / MM-DD(跨年 YYYY-MM-DD)。
 * epoch ms 输入,now 可注入(单测)。
 */
export function relativeTime(epochMs: number, now = Date.now()): string {
  const diff = now - epochMs
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const d = new Date(epochMs)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (epochMs >= startOfToday - 86_400_000 && epochMs < startOfToday) {
    return `昨天 ${p2(d.getHours())}:${p2(d.getMinutes())}`
  }
  if (now - epochMs < 7 * 86_400_000) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  }
  const md = `${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  return d.getFullYear() === today.getFullYear() ? md : `${d.getFullYear()}-${md}`
}

function p2(n: number): string {
  return String(n).padStart(2, '0')
}
