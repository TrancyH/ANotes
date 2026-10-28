/** ANotes Web 应用入口:状态、数据加载、原生桥、hash 路由(P0 全 Web UI)。 */
import '../android-main' // window.AmooNotes + 全局样式
import { parseHash, routeToHash } from '../router'
import { createNote, makeNoteId, parseNote, serializeNote } from '../frontmatter'
import { noteWordCount } from '../frontmatter'
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
import { closeSheet, sheetOpen, toast } from './ui'
import { renderEdit, renderList, renderSettings, renderTrash } from './pages'
import type { App } from './app-types'

interface CacheEntry {
  mtime: number
  raw: string
  item: NoteListItem
}

const rootEl = document.getElementById('app')!
const rawCache = new Map<string, CacheEntry>()

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

  flushEdit: flushNow,
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
    refresh()
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

  setQuery(q) {
    app.query = q
    if (queryTimer) clearTimeout(queryTimer)
    queryTimer = setTimeout(() => {
      if (app.route.page === 'list') app.renderListItems?.()
    }, 500)
  },

  setEditFooter: () => undefined,
}

// ── 数据加载 ─────────────────────────────────────────

function putCache(id: string, mtime: number, raw: string): void {
  const note = { ...parseNote(raw), id }
  rawCache.set(id, { mtime, raw, item: toListItem(note) })
}

function refresh(): void {
  purgeExpiredTrash()
  const refs = listNoteRefs()
  for (const ref of refs) {
    const cached = rawCache.get(ref.id)
    if (!cached || cached.mtime !== ref.lastModified) {
      putCache(ref.id, ref.lastModified, readNoteRaw(ref.id))
    }
  }
  const ids = new Set(refs.map((r) => r.id))
  for (const id of [...rawCache.keys()]) if (!ids.has(id)) rawCache.delete(id)
  app.notes = refs.map((r) => rawCache.get(r.id)!.item)
  app.status = getFileStatus()
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
    case 'settings':
      rootEl.replaceChildren(renderSettings(app))
      break
    case 'edit':
      rootEl.replaceChildren(renderEdit(app, app.route.id))
      break
  }
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
  render()
  if (route.page === 'edit') {
    // DOM(#host)就绪后才能 mount + 灌内容(loadNote 依赖 #host 存在)
    const raw = readNoteRaw(route.id)
    if (!raw && !rawCache.has(route.id)) {
      // 笔记不存在(已被彻底删除/同步移除)→ 回列表
      editingId = null
      native()?.setCurrentNote('')
      location.hash = '#/list'
      return
    }
    const handle = window.AmooNotes.mount({
      onChange: () => scheduleSave(),
      onTitleInput: () => scheduleSave(),
    })
    app.editor = handle
    window.AmooNotes.loadNote({ id: route.id, raw })
    updateFooter()
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
    app.status = getFileStatus()
    refresh()
  },
  /** 返回键:消费返回 true(Kotlin 据此决定是否退到桌面)。 */
  __routeBack(): string {
    if (sheetOpen()) {
      closeSheet()
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
      location.hash = '#/list'
      return 'true'
    }
    if (app.route.page === 'trash' || app.route.page === 'settings') {
      location.hash = '#/list'
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
      location.hash = '#/list'
      render()
    }
  },
})

// ── 启动 ─────────────────────────────────────────────

function boot(): void {
  const t = native()?.getSystemTheme()
  applyTheme(t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches)
  window.addEventListener('hashchange', onRouteChange)
  refresh()
  if (!location.hash) history.replaceState(null, '', '#/list')
  onRouteChange()
  native()?.ready()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()

export type { FileStatus }
