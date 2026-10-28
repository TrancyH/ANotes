import type { NoteColor, NoteListItem } from '../types'
import type { NoteEditorHandle } from '../android-main'
import type { FileStatus } from './bridge'
import type { Route } from '../router'

/** 页面渲染器共享的 app 能力接口(main.ts 提供)。 */
export interface App {
  root: HTMLElement
  route: Route
  notes: NoteListItem[]
  status: FileStatus
  query: string
  colorFilter: NoteColor | 'all'
  selecting: boolean
  selection: Set<string>
  /** 编辑器句柄(进入编辑页后可用)。 */
  editor: NoteEditorHandle | null
  /** 列表页局部刷新(搜索过滤时避免整页重渲染丢焦点)。 */
  renderListItems?: () => void
  /** 笔记正文缓存(rawOf 供待办进度等即时计算)。 */
  rawOf(id: string): string
  /** 重新加载数据并重渲染当前页。 */
  refresh(): void
  /** 只重渲染当前页。 */
  render(): void
  navigate(route: Route): void
  /** 编辑页防抖落盘立即执行(切换笔记/返回/外部 flush 时)。 */
  flushEdit(): void
  /** 编辑页进入/离开时同步编辑器上下文。 */
  onLeaveEdit(): void
  /** 新建笔记并进入编辑。 */
  createNote(): void
  /** 移入回收站(可撤销)。 */
  trashNotes(ids: string[]): void
  /** 回收站恢复。 */
  restoreNotes(ids: string[]): void
  /** 彻底删除。 */
  deleteForever(ids: string[]): void
  /** 搜索词变更(500ms 防抖在实现内)。 */
  setQuery(q: string): void
  /** 编辑页底栏状态更新(重渲染后由 main 回挂)。 */
  setEditFooter(wc: number, savedAt: number | null): void
  dark: boolean
}

export const NOTE_COLOR_HEX: Record<NoteColor, string> = {
  default: 'transparent',
  blue: 'var(--an-note-blue)',
  green: 'var(--an-note-green)',
  amber: 'var(--an-note-amber)',
}
