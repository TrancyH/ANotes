/**
 * Android WebView 壳专用入口(无 React,IIFE bundle,暴露 window.AmooNotes)。
 * 原生工具栏通过 exec() 驱动格式命令;FileObserver 触发的远程更新走 setMarkdown()。
 */
import { Editor } from '@tiptap/core'
import { createNoteExtensions, editorToMarkdown } from './extensions'
import { makeNoteId, parseNote, serializeNote, type NoteColor, type NoteFile } from './frontmatter'
import './android.css'

export interface NoteEditorHandle {
  setMarkdown: (markdown: string) => void
  getMarkdown: () => string
  setTitle: (title: string) => void
  /** 原生工具栏命令:bold/italic/strike/h2/h3/ul/ol/task/quote/code */
  exec: (command: string) => void
  focus: () => void
  destroy: () => void
}

/** 原生层持有的当前笔记上下文(JS 序列化,Kotlin 只读写原始 .md 字符串)。 */
export interface AndroidBridge {
  mount: (opts: {
    onChange: (raw: string) => void // 已序列化的 .md 全文(Kotlin 直接落盘)
    onTitleInput: (title: string) => void
  }) => NoteEditorHandle
  /** 原生把某条笔记(原始 .md 或空)灌进编辑器。 */
  loadNote: (payload: { id: string; raw: string; readOnly?: boolean }) => void
  /** 当前编辑内容序列化为 .md(原生保存用)。 */
  serialize: () => { id: string; raw: string }
  /** 编辑页改颜色/置顶:写上下文,下次 serialize 落盘。 */
  setMeta: (patch: { color?: NoteColor; pinned?: boolean }) => void
  /** 当前上下文(v2 字段,列表卡片即时刷新用)。 */
  meta: () => { id: string; pinned: boolean; color: NoteColor }
  makeId: () => string
  parse: (raw: string) => NoteFile
}

declare global {
  interface Window {
    AmooNotes: AndroidBridge
  }
}

/** 编辑器回调(复用挂载时可更新;闭包经此间接调用)。 */
let callbacks = { onChange: (_raw: string) => {}, onTitleInput: (_t: string) => {} }

export function mountNoteEditor(
  host: HTMLElement,
  onChange: (markdown: string) => void,
  onTitleInput: (title: string) => void,
): NoteEditorHandle {
  callbacks = { onChange, onTitleInput }
  // 跨页面复用:编辑器 DOM(Tiptap 实例)只建一次,后续挂载直接搬移节点,内容状态保留
  if (mountedWrap) {
    host.appendChild(mountedWrap)
    return handle!
  }
  const wrap = document.createElement('div')
  const titleInput = document.createElement('input')
  titleInput.className = 'note-title-input'
  titleInput.placeholder = '标题'
  titleInput.addEventListener('input', () => callbacks.onTitleInput(titleInput.value))

  const editorHost = document.createElement('div')
  editorHost.className = 'notes-prose-host'
  wrap.append(titleInput, editorHost)
  host.appendChild(wrap)
  mountedWrap = wrap

  const editor = new Editor({
    extensions: createNoteExtensions(),
    content: '',
    element: editorHost,
    editorProps: { attributes: { class: 'notes-prose' } },
    onUpdate: ({ editor: ed }) => callbacks.onChange(editorToMarkdown(ed)),
  })

  handle = {
    setMarkdown(markdown) {
      editor.commands.setContent(markdown, { emitUpdate: false })
    },
    getMarkdown: () => editorToMarkdown(editor),
    setTitle: (t) => {
      titleInput.value = t
    },
    exec(command) {
      const c = editor.chain().focus()
      switch (command) {
        case 'bold': c.toggleBold().run(); break
        case 'italic': c.toggleItalic().run(); break
        case 'strike': c.toggleStrike().run(); break
        case 'h2': c.toggleHeading({ level: 2 }).run(); break
        case 'h3': c.toggleHeading({ level: 3 }).run(); break
        case 'ul': c.toggleBulletList().run(); break
        case 'ol': c.toggleOrderedList().run(); break
        case 'task': c.toggleTaskList().run(); break
        case 'quote': c.toggleBlockquote().run(); break
        case 'code': c.toggleCode().run(); break
        default: break
      }
    },
    focus: () => editor.commands.focus(),
    destroy: () => editor.destroy(),
  }
  return handle
}

let mountedWrap: HTMLElement | null = null
let handle: NoteEditorHandle | null = null

let currentHandle: NoteEditorHandle | null = null
let currentContext = {
  id: '',
  createdAt: new Date().toISOString(),
  pinned: false,
  color: 'default' as NoteColor,
  trashedAt: null as string | null,
  remindAt: null as string | null,
}

function noteTitleInput(): HTMLInputElement | null {
  return document.querySelector('.note-title-input')
}

window.AmooNotes = {
  mount: (opts) => {
    const host = document.getElementById('host')
    if (!host) throw new Error('#host 不存在')
    if (currentHandle) return currentHandle
    currentHandle = mountNoteEditor(host, opts.onChange, opts.onTitleInput)
    return currentHandle
  },
  loadNote: (payload) => {
    const host = document.getElementById('host')
    if (!host) return
    if (!currentHandle) currentHandle = mountNoteEditor(host, () => undefined, () => undefined)
    const note = payload.raw.trim() ? parseNote(payload.raw) : null
    currentHandle.setMarkdown(note?.markdown ?? '')
    currentHandle.setTitle(note?.title ?? '')
    const now = new Date().toISOString()
    currentContext = {
      id: payload.id || note?.id || makeNoteId(),
      createdAt: note?.createdAt ?? now,
      pinned: note?.pinned ?? false,
      color: note?.color ?? 'default',
      trashedAt: note?.trashedAt ?? null,
      remindAt: note?.remindAt ?? null,
    }
  },
  serialize: () => {
    if (!currentHandle) return { id: '', raw: '' }
    const now = new Date().toISOString()
    const raw = serializeNote({
      id: currentContext.id,
      title: noteTitleInput()?.value ?? '',
      createdAt: currentContext.createdAt,
      updatedAt: now,
      pinned: currentContext.pinned,
      color: currentContext.color,
      trashedAt: currentContext.trashedAt,
      remindAt: currentContext.remindAt,
      markdown: currentHandle.getMarkdown(),
    })
    return { id: currentContext.id, raw }
  },
  makeId: () => makeNoteId(),
  parse: (raw) => parseNote(raw),
  setMeta: (patch) => {
    if (patch.color) currentContext.color = patch.color
    if (patch.pinned !== undefined) currentContext.pinned = patch.pinned
  },
  meta: () => ({
    id: currentContext.id,
    pinned: currentContext.pinned,
    color: currentContext.color,
  }),
}
