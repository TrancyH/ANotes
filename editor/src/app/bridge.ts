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
  /** P1 新增:分享纯文本(标题+正文)到系统。 */
  shareText(text: string): void
  /** P1 新增:注册精确闹钟(remindAt 为 ISO 8601 UTC;过期/非法返回 false)。 */
  setReminder(id: string, remindAt: string): boolean
  /** P1 新增:注销闹钟。 */
  cancelReminder(id: string): void
  /** P1 新增:运行时申请 POST_NOTIFICATIONS(API 33+)。 */
  requestNotificationPermission(): void
  /** P1 新增:提醒授权状态 JSON:{notifications:boolean, exactAlarms:boolean}。 */
  getReminderStatus(): string
  /** P1 新增:跳系统精确闹钟授权页(API 31+)。 */
  openExactAlarmSettings(): void
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

/** 提醒授权状态(设置页展示;无桥/解析失败按已允许,浏览器 dev 不显示引导)。 */
export interface ReminderStatus {
  notifications: boolean
  exactAlarms: boolean
}

export function getReminderStatus(): ReminderStatus {
  const n = native()
  if (!n) return { notifications: true, exactAlarms: true }
  try {
    const s = JSON.parse(n.getReminderStatus()) as Partial<ReminderStatus>
    return {
      notifications: s.notifications !== false,
      exactAlarms: s.exactAlarms !== false,
    }
  } catch {
    return { notifications: true, exactAlarms: true }
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
  /** P1:系统分享接收(ACTION_SEND text/plain)→ 新建笔记并进入编辑。 */
  __shareReceived(text: string): void
  /** P1:通知点击/intent extra 直达指定笔记。 */
  __openNote(id: string): void
  /** 桌面图标长按快捷方式:'create'=新建并进入编辑,'search'=回列表聚焦搜索框。 */
  __shortcut(action: string): void
}

export function registerHandlers(handlers: NativeHandlers): void {
  const w = window as unknown as Record<string, unknown>
  w.__switch = handlers.__switch
  w.__flushNow = handlers.__flushNow
  w.__themeChange = handlers.__themeChange
  w.__notesChanged = handlers.__notesChanged
  w.__routeBack = handlers.__routeBack
  w.__noteRemoved = handlers.__noteRemoved
  w.__shareReceived = handlers.__shareReceived
  w.__openNote = handlers.__openNote
  w.__shortcut = handlers.__shortcut
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
    __shareReceived(text: string): void
    __openNote(id: string): void
    __shortcut(action: string): void
  }
}
