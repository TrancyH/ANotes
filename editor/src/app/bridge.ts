/**
 * 原生桥封装:JS→Kotlin 调用(AmooNative)+ Kotlin→JS 入口注册(__switch 等)。
 * Kotlin 侧实现见 android/app/src/main/java/com/amoolink/notes/MainActivity.kt。
 */

/** JS→Kotlin 桥(Android WebView 注入;纯浏览器 dev 环境为 undefined,走 fallback)。 */
export interface AmooNativeBridge {
  writeNote(id: string, raw: string): boolean
  readNote(id: string): string
  listNotes(): string
  deleteNote(id: string): boolean
  setTitle(title: string): void
  ready(): void
  log(message: string): void
  /** P0 新增:外链转系统浏览器(http/https)。 */
  openExternal(url: string): void
  /** P0 新增:'dark' | 'light'(同步返回,首帧主题来源)。 */
  getSystemTheme(): string
  /** P0 新增:可观测同步状态(JSON:{lastExternalWriteAt, lastSelfWriteAt},epoch ms)。 */
  getStatus(): string
  /** P0 新增:编辑页进入/离开时告知原生当前笔记(FileObserver 热替换与防回环依赖)。 */
  setCurrentNote(id: string): void
}

export interface FileStatus {
  lastExternalWriteAt: number
  lastSelfWriteAt: number
}

export function native(): AmooNativeBridge | undefined {
  return (window as unknown as { AmooNative?: AmooNativeBridge }).AmooNative
}

export function inNativeShell(): boolean {
  return native() !== undefined
}

/** listNotes() → [{id,title,lastModified}];原生不可用时返回空(浏览器 dev)。 */
export function listNoteRefs(): { id: string; lastModified: number }[] {
  const n = native()
  if (!n) return []
  try {
    const arr = JSON.parse(n.listNotes()) as { id: string; lastModified: number }[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function readNoteRaw(id: string): string {
  return native()?.readNote(id) ?? ''
}

export function writeNoteRaw(id: string, raw: string): boolean {
  return native()?.writeNote(id, raw) ?? false
}

export function deleteNoteRaw(id: string): boolean {
  return native()?.deleteNote(id) ?? false
}

export function getFileStatus(): FileStatus {
  const n = native()
  if (!n) return { lastExternalWriteAt: 0, lastSelfWriteAt: 0 }
  try {
    const s = JSON.parse(n.getStatus()) as Partial<FileStatus>
    return {
      lastExternalWriteAt: typeof s.lastExternalWriteAt === 'number' ? s.lastExternalWriteAt : 0,
      lastSelfWriteAt: typeof s.lastSelfWriteAt === 'number' ? s.lastSelfWriteAt : 0,
    }
  } catch {
    return { lastExternalWriteAt: 0, lastSelfWriteAt: 0 }
  }
}

/** Kotlin→JS 入口表:app 启动时挂到 window。 */
export interface NativeHandlers {
  __switch(json: string): void
  __flushNow(): void
  __themeChange(dark: boolean): void
  __notesChanged(): void
  __routeBack(): string
  /** 当前编辑的笔记被电脑端删除(退出编辑,防写回复活)。 */
  __noteRemoved(id: string): void
}

export function registerHandlers(handlers: NativeHandlers): void {
  const w = window as unknown as Record<string, unknown>
  w.__switch = handlers.__switch
  w.__flushNow = handlers.__flushNow
  w.__themeChange = handlers.__themeChange
  w.__notesChanged = handlers.__notesChanged
  w.__routeBack = handlers.__routeBack
}

declare global {
  interface Window {
    AmooNative?: AmooNativeBridge
    AmooNotes: import('../android-main').AndroidBridge
    /** Kotlin→JS 入口(main.ts 注册)。 */
    __switch(json: string): void
    __flushNow(): void
    __themeChange(dark: boolean): void
    __notesChanged(): void
    /** 返回键路由回退;消费返回 'true',否则 'false' 交还系统。 */
    __routeBack(): string
    __noteRemoved(id: string): void
  }
}
