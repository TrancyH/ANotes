/** 笔记模块共享类型(Android WebView 端;与 ALink packages/notes-editor 同源副本)。 */

/** 笔记四色(frontmatter v2 `color`;缺省 default)。 */
export type NoteColor = 'default' | 'blue' | 'green' | 'amber'

export const NOTE_COLORS: readonly NoteColor[] = ['default', 'blue', 'green', 'amber']

/** 笔记元数据(与 .md 文件 frontmatter 一一对应,v2 共 8 字段)。 */
export interface NoteMeta {
  /** 全局唯一 id:`yyyyMMdd-HHmmss-xxxxx`(时间戳+随机后缀,双端生成不冲突)。 */
  id: string
  title: string
  /** ISO 8601(UTC)。 */
  createdAt: string
  updatedAt: string
  pinned: boolean
  /** v2 起有效;旧文件缺失按 default。 */
  color: NoteColor
  /** v2 起有效;null/缺失 = 存活,非空 = 在回收站。 */
  trashedAt: string | null
  /** v2 起有效;null/缺失 = 无提醒。 */
  remindAt: string | null
}

/** 一条完整笔记:元数据 + Markdown 正文(不含 frontmatter)。 */
export interface NoteFile extends NoteMeta {
  markdown: string
}

/** 列表页条目:元数据 + 摘要 + 文件时间(卡片时间展示用)。 */
export interface NoteListItem extends NoteMeta {
  excerpt: string
  wordCount: number
  /** 文件最后修改(epoch ms,取自原生 listNotes)。 */
  mtime: number
}

/** 同步清单条目:md5 + 最后写入时间;删除走 tombstone。 */
export interface ManifestEntry {
  md5: string
  /** 该端最后写入时间(epoch ms)。 */
  mtime: number
  /** tombstone:删除时间(epoch ms);null 表示存在。 */
  deletedAt: number | null
}

/** manifest.json(两端各持一份)。 */
export interface Manifest {
  version: 1
  notes: Record<string, ManifestEntry>
}

/** 同步状态机(note-service 推给渲染端)。 */
export type SyncState =
  | { phase: 'idle'; lastSyncAt: number | null }
  | { phase: 'scanning' }
  | { phase: 'syncing'; up: number; down: number }
  | { phase: 'done'; up: number; down: number; at: number }
  | { phase: 'error'; message: string }
