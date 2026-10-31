/** ANotes Web 应用入口:状态、数据加载、原生桥、hash 路由(P0 全 Web UI)。 */
import '../android-main' // window.AmooNotes + 全局样式
import { parseHash, routeToHash } from '../router'
import { createNote, makeNoteId, parseNote, serializeNote } from '../frontmatter'
import { noteWordCount, remindAtLabel } from '../frontmatter'
import { isTrashExpired, toListItem } from '../notes-model'
import type { NoteListItem } from '../types'
import {
  deleteNoteRaw,
  getFileStatus,
  listNoteRefs,
  native,
  readNoteRaw,
  registerHandlers,
  writeNoteRaw,
  type FileStatus,
} from './bridge'
import { closeSheet, dismissToast, sheetOpen, toast, toastActionShown } from './ui'
import { renderEdit, renderList, renderSettings, renderTodos, renderTrash } from './pages'
import type { App } from './app-types'

interface CacheEntry {
  mtime: number
  raw: string
  item: NoteListItem
}

const rootEl = document.getElementById('app')!
const rawCache = new Map<string, CacheEntry>()

/** 排序键持久化(domStorage;非法/缺失回退 'updated')。 */
function loadSortKey(): 'updated' | 'created' | 'title' {
  try {
    const v = localStorage.getItem('anotes:sort')
    if (v === 'created' || v === 'title') return v
  } catch {
    /* 存储不可用 */
  }
  return 'updated'
}

let editingId: string | null = null
let pendingSave = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let savedAt: number | null = null
let queryTimer: ReturnType<typeof setTimeout> | null = null

const app: App = {
  root: rootEl,
  route: { page: 'list' },
  notes: [],
  status: { lastExternalWriteAt: 0, lastSelfWriteAt: 0 },
  query: '',
  colorFilter: 'all',
  selecting: false,
  selection: new Set<string>(),
  editor: null,
  dark: true,
  renderListItems: undefined,

  rawOf: (id) => rawCache.get(id)?.raw ?? '',

  refresh,
  render,
  navigate(route) {
    const target = routeToHash(route)
    if (location.hash === target) onRouteChange()
    else location.hash = target
  },

  flushEdit() {
    // flush 必须无条件落盘:颜色/置顶/提醒经 setMeta 只改内存上下文,
    // 不触发 onChange,pendingSave 为 false 时 flushNow 会静默跳过(真机实测发现)
    pendingSave = true
    flushNow()
  },
  onLeaveEdit() {
    flushNow()
    native()?.setCurrentNote('')
    editingId = null
  },

  createNote() {
    const id = makeNoteId()
    const raw = serializeNote(createNote(''))
    if (!writeNoteRaw(id, raw)) {
      toast('创建失败')
      return
    }
    putCache(id, Date.now(), raw)
    app.navigate({ page: 'edit', id })
  },

  trashNotes(ids) {
    const undoRaws = new Map<string, string>()
    const now = new Date().toISOString()
    for (const id of ids) {
      const raw = readNoteRaw(id)
      if (!raw && !rawCache.has(id)) continue
      undoRaws.set(id, raw)
      const note = { ...parseNote(raw), id }
      const next = serializeNote({ ...note, trashedAt: now, updatedAt: now })
      if (writeNoteRaw(id, next)) putCache(id, Date.now(), next)
    }
    // 不在此处渲染:调用方(编辑页先数据后导航/多选工具栏)各自决定,
    // 避免 route 仍为 edit 时把编辑页重渲一遍造成闪烁
    toast('已移入回收站', {
      label: '撤销',
      run: () => {
        for (const [id, raw] of undoRaws) {
          writeNoteRaw(id, raw)
          putCache(id, Date.now(), raw)
        }
        refresh()
      },
    })
  },

  restoreNotes(ids) {
    const now = new Date().toISOString()
    for (const id of ids) {
      const note = { ...parseNote(readNoteRaw(id)), id }
      if (writeNoteRaw(id, serializeNote({ ...note, trashedAt: null, updatedAt: now }))) {
        putCache(id, Date.now(), serializeNote({ ...note, trashedAt: null, updatedAt: now }))
      }
    }
  },

  deleteForever(ids) {
    for (const id of ids) {
      if (deleteNoteRaw(id)) rawCache.delete(id)
    }
  },

  setReminder(id, remindAt) {
    window.AmooNotes.setMeta({ remindAt })
    // setMeta 只改内存上下文,不置位 pendingSave 的话 flushNow 会直接 return,
    // remindAt 永不落盘(真机实测发现:过期清理 Toast 弹了但文件没写回)
    pendingSave = true
    flushNow()
    const n = native()
    if (remindAt) {
      // 首次设置先申请通知权限(targetSdk 34 必须);注册失败(如时间非法)也照写 frontmatter
      n?.requestNotificationPermission()
      n?.setReminder(id, remindAt)
      toast(`将于 ${remindAtLabel(remindAt)} 提醒`)
    } else {
      n?.cancelReminder(id)
      toast('已取消提醒')
    }
    app.refreshEditTop?.()
  },

  setQuery(q) {
    app.query = q
    if (queryTimer) clearTimeout(queryTimer)
    queryTimer = setTimeout(() => {
      if (app.route.page === 'list') app.renderListItems?.()
    }, 500)
  },

  setEditFooter: () => undefined,
  refreshEditTop: () => undefined,
  sortKey: loadSortKey(),
  setSortKey(key) {
    app.sortKey = key
    try {
      localStorage.setItem('anotes:sort', key)
    } catch {
      /* 隐私模式等存储不可用时静默降级为内存态 */
    }
    app.render()
  },

  toggleTodo(noteId, lineIndex, done) {
    const raw = rawCache.get(noteId)?.raw ?? readNoteRaw(noteId)
    if (!raw) return
    const note = { ...parseNote(raw), id: noteId }
    const lines = note.markdown.split('\n')
    const line = lines[lineIndex]
    if (line === undefined) return
    lines[lineIndex] = done ? line.replace('[ ]', '[x]') : line.replace('[x]', '[ ]').replace('[X]', '[ ]')
    const next = serializeNote({
      ...note,
      markdown: lines.join('\n'),
      updatedAt: new Date().toISOString(),
    })
    if (writeNoteRaw(noteId, next)) {
      putCache(noteId, Date.now(), next)
      if (app.route.page === 'todos') render()
      else if (app.route.page === 'list') app.renderListItems?.()
    }
  },
}

// ── 数据加载 ─────────────────────────────────────────

function putCache(id: string, mtime: number, raw: string): void {
  const note = { ...parseNote(raw), id }
  rawCache.set(id, { mtime, raw, item: toListItem(note) })
}

/** 数据重载(不渲染):mtime 变化的文件重读,消失的条目剔除,过期回收站清扫。 */
function loadData(): void {
  const refs = listNoteRefs()
  for (const ref of refs) {
    const cached = rawCache.get(ref.id)
    if (!cached || cached.mtime !== ref.lastModified) {
      putCache(ref.id, ref.lastModified, readNoteRaw(ref.id))
    }
  }
  const ids = new Set(refs.map((r) => r.id))
  for (const id of [...rawCache.keys()]) if (!ids.has(id)) rawCache.delete(id)
  // 先载入再清扫:冷启动缓存为空,若先 purge 则到期项要等下一次刷新才消失
  purgeExpiredTrash()
  app.notes = refs.filter((r) => rawCache.has(r.id)).map((r) => rawCache.get(r.id)!.item)
  app.status = getFileStatus()
}

function refresh(): void {
  loadData()
  render()
}

/** 30 天 TTL 到期的回收站笔记物理删除(设计 §4.6;桌面端有同款 tombstone 清扫)。 */
function purgeExpiredTrash(): void {
  for (const [id, entry] of rawCache) {
    if (isTrashExpired(entry.item)) {
      if (deleteNoteRaw(id)) rawCache.delete(id)
    }
  }
}

// ── 渲染 / 路由 ──────────────────────────────────────

function render(): void {
  switch (app.route.page) {
    case 'list':
      rootEl.replaceChildren(renderList(app))
      break
    case 'trash':
      rootEl.replaceChildren(renderTrash(app))
      break
    case 'todos':
      rootEl.replaceChildren(renderTodos(app))
      break
    case 'settings':
      rootEl.replaceChildren(renderSettings(app))
      break
    case 'edit':
      rootEl.replaceChildren(renderEdit(app, app.route.id))
      break
  }
}

/** 回列表页(hash 路由跳转,hashchange 驱动后续重渲染)。 */
function backToList(): void {
  location.hash = '#/list'
}

function onRouteChange(): void {
  const route = parseHash(location.hash)
  if (route.page === 'edit') {
    if (editingId !== route.id) {
      flushNow()
      if (editingId !== null) native()?.setCurrentNote('')
      editingId = route.id
      native()?.setCurrentNote(route.id)
      pendingSave = false
      savedAt = rawCache.get(route.id)?.mtime ?? Date.now()
    }
  } else if (editingId !== null) {
    flushNow()
    native()?.setCurrentNote('')
    editingId = null
  }
  app.route = route
  // 自写文件事件已被原生侧吞掉,路由到达时总是重载数据兜底(新建/回收站操作后列表保持最新)
  loadData()
  render()
  if (route.page === 'edit') {
    // DOM(#host)就绪后才能 mount + 灌内容(loadNote 依赖 #host 存在)
    const raw = readNoteRaw(route.id)
    if (!raw && !rawCache.has(route.id)) {
      // 笔记不存在(已被彻底删除/同步移除)→ 回列表
      editingId = null
      native()?.setCurrentNote('')
      backToList()
      return
    }
    const handle = window.AmooNotes.mount({
      onChange: () => scheduleSave(),
      onTitleInput: () => scheduleSave(),
    })
    app.editor = handle
    window.AmooNotes.loadNote({ id: route.id, raw })
    updateFooter()
    // 打开笔记发现提醒已过期(设计 §3.4):清空字段并注销闹钟
    const meta = window.AmooNotes.meta()
    if (meta.remindAt && new Date(meta.remindAt).getTime() < Date.now()) {
      app.setReminder(route.id, null)
      toast('提醒已过期,已清除')
    }
  }
}

function scheduleSave(): void {
  pendingSave = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushNow, 500)
}

function flushNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!pendingSave || editingId === null) return
  pendingSave = false
  const { id, raw } = window.AmooNotes.serialize()
  if (!id) return
  if (writeNoteRaw(id, raw)) {
    savedAt = Date.now()
    putCache(id, savedAt, raw)
    updateFooter()
  }
}

function updateFooter(): void {
  const wc = noteWordCount(app.editor?.getMarkdown() ?? '')
  app.setEditFooter(wc, savedAt)
  // loadNote/热替换晚于 renderEdit,顶栏(颜色点/置顶)在此回刷,否则显示上一篇的状态
  app.refreshEditTop?.()
}

// 「保存于 xx 前」随时间刷新
setInterval(() => {
  if (app.route.page === 'edit' && savedAt) updateFooter()
}, 30_000)

// ── 主题 ─────────────────────────────────────────────

function applyTheme(dark: boolean): void {
  app.dark = dark
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

// ── Kotlin→JS 入口 ───────────────────────────────────

registerHandlers({
  /** 当前笔记被电脑同步更新(FileObserver 路径)。 */
  __switch(json) {
    try {
      const { id, raw } = JSON.parse(json) as { id: string; raw: string }
      if (editingId === id) {
        pendingSave = false
        if (saveTimer) clearTimeout(saveTimer)
        window.AmooNotes.loadNote({ id, raw })
        savedAt = Date.now()
        updateFooter()
      }
      putCache(id, Date.now(), raw)
      app.status = { ...app.status, lastExternalWriteAt: Date.now() }
      if (app.route.page === 'list') app.renderListItems?.()
      else if (app.route.page !== 'edit') render()
    } catch {
      /* 非法载荷忽略 */
    }
  },
  /** 立即落盘(原生入口/设置页按钮)。 */
  __flushNow() {
    flushNow()
  },
  /** 系统深浅色变化。 */
  __themeChange(dark) {
    applyTheme(dark)
  },
  /** 任意外部 .md 变化:刷新列表与状态(当前笔记另走 __switch)。 */
  __notesChanged() {
    loadData()
    // 列表页只重渲列表区(含计数),保住搜索框焦点;
    // 编辑页不整页重渲——renderEdit 会把编辑器 DOM 摘出文档
    if (app.route.page === 'list') app.renderListItems?.()
    else if (app.route.page !== 'edit') render()
  },
  /** 返回键:消费返回 true(Kotlin 据此决定是否退到桌面)。 */
  __routeBack(): string {
    if (sheetOpen()) {
      closeSheet()
      return 'true'
    }
    if (toastActionShown()) {
      dismissToast()
      return 'true'
    }
    if (app.selecting) {
      app.selecting = false
      app.selection.clear()
      render()
      return 'true'
    }
    if (app.route.page === 'edit') {
      flushNow()
      native()?.setCurrentNote('')
      editingId = null
      backToList()
      return 'true'
    }
    if (app.route.page === 'trash' || app.route.page === 'todos' || app.route.page === 'settings') {
      backToList()
      return 'true'
    }
    return 'false'
  },
  /** 当前编辑的笔记被电脑端删除:退出编辑并清缓存(防写回复活)。 */
  __noteRemoved(id) {
    rawCache.delete(id)
    if (editingId === id) {
      pendingSave = false
      if (saveTimer) clearTimeout(saveTimer)
      native()?.setCurrentNote('')
      editingId = null
      app.route = { page: 'list' }
      backToList()
      render()
    }
  },
  /** 系统分享接收(ACTION_SEND text/plain):新建笔记并进入编辑(设计 §3.5)。 */
  __shareReceived(text) {
    const id = makeNoteId()
    const raw = serializeNote(createNote(text))
    if (!writeNoteRaw(id, raw)) {
      toast('接收分享失败')
      return
    }
    putCache(id, Date.now(), raw)
    app.navigate({ page: 'edit', id })
  },
  /** 通知点击/intent extra 直达指定笔记;不存在则提示并回列表。 */
  __openNote(id) {
    if (rawCache.has(id) || readNoteRaw(id)) app.navigate({ page: 'edit', id })
    else {
      toast('笔记不存在(可能已被删除)')
      app.navigate({ page: 'list' })
    }
  },
  /** 桌面图标长按快捷方式(Kotlin shortcuts.xml → here)。 */
  __shortcut(action) {
    if (action === 'create') {
      app.createNote()
      return
    }
    if (action === 'search') {
      app.query = ''
      app.navigate({ page: 'list' })
      // 渲染完成后再聚焦搜索框
      setTimeout(() => document.querySelector<HTMLInputElement>('.search-bar input')?.focus(), 60)
    }
  },
})

// ── 启动 ─────────────────────────────────────────────

function boot(): void {
  const t = native()?.getSystemTheme()
  applyTheme(t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches)
  window.addEventListener('hashchange', onRouteChange)
  if (!location.hash) history.replaceState(null, '', '#/list')
  // 首次路由到达时 onRouteChange 内部 loadData+render,无需先行 refresh
  onRouteChange()
  native()?.ready()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()

export type { FileStatus }
