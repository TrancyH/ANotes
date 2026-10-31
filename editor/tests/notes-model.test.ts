import { describe, expect, it } from 'vitest'
import { createNote, parseNote, serializeNote } from '../src/frontmatter'
import {
  collectTodos,
  filterByColor,
  isConflictCopy,
  isNoteColor,
  isTrashExpired,
  relativeTime,
  searchNotes,
  sortByKey,
  sortForList,
  sortForTrash,
  splitTrash,
  toListItem,
  todoProgress,
  TRASH_TTL_MS,
} from '../src/notes-model'
import type { NoteListItem } from '../src/types'

function item(partial: Partial<NoteListItem>): NoteListItem {
  return {
    id: '20261027-120000-aaaaa',
    title: '未命名笔记',
    createdAt: '2026-10-27T04:00:00.000Z',
    updatedAt: '2026-10-27T04:00:00.000Z',
    pinned: false,
    color: 'default',
    trashedAt: null,
    remindAt: null,
    excerpt: '',
    wordCount: 0,
    ...partial,
  }
}

describe('toListItem / todoProgress', () => {
  it('摘要与字数即时计算', () => {
    const note = { ...createNote('今天买牛奶\n\n再买鸡蛋'), id: 'x', title: '购物' }
    const li = toListItem(note)
    expect(li.excerpt).toContain('买牛奶')
    expect(li.wordCount).toBe(9)
  })

  it('待办进度:混合完成/未完成/嵌套/普通列表', () => {
    const md = [
      '- [x] 已完成',
      '- [ ] 未完成',
      '  - [X] 大写也算完成',
      '  - 嵌套普通项',
      '1. 有序列表不算',
      '- [ ]  未完成(多空格)',
    ].join('\n')
    expect(todoProgress(md)).toEqual({ done: 2, total: 4 })
  })

  it('无待办 total=0', () => {
    expect(todoProgress('普通正文\n- 列表项')).toEqual({ done: 0, total: 0 })
  })
})

describe('searchNotes / filterByColor', () => {
  const items = [
    item({ id: 'a', title: '会议纪要', excerpt: '接口联调完成' }),
    item({ id: 'b', title: '购物清单', excerpt: '牛奶 鸡蛋', color: 'blue' }),
    item({ id: 'c', title: '灵感', excerpt: '便签产品对标', color: 'green' }),
  ]

  it('标题或摘要包含匹配,大小写不敏感,空白 query 原样返回', () => {
    expect(searchNotes(items, '会议').map((n) => n.id)).toEqual(['a'])
    expect(searchNotes(items, '牛奶').map((n) => n.id)).toEqual(['b'])
    expect(searchNotes(items, 'ABC').map((n) => n.id)).toEqual([])
  })

  it('四色过滤与 all', () => {
    expect(filterByColor(items, 'all')).toHaveLength(3)
    expect(filterByColor(items, 'blue').map((n) => n.id)).toEqual(['b'])
    expect(filterByColor(items, 'amber')).toEqual([])
  })

  it('isNoteColor 非法值判 false', () => {
    expect(isNoteColor('blue')).toBe(true)
    expect(isNoteColor('pink')).toBe(false)
  })
})

describe('回收站:拆分 / 排序 / TTL', () => {
  const items = [
    item({ id: 'a', trashedAt: '2026-10-20T00:00:00.000Z' }),
    item({ id: 'b', trashedAt: null }),
    item({ id: 'c', trashedAt: '2026-10-25T00:00:00.000Z' }),
  ]

  it('splitTrash 分区', () => {
    const { live, trashed } = splitTrash(items)
    expect(live.map((n) => n.id)).toEqual(['b'])
    expect(trashed.map((n) => n.id)).toEqual(['a', 'c'])
  })

  it('sortForTrash 最近删除在前', () => {
    expect(sortForTrash(trashedOf(items)).map((n) => n.id)).toEqual(['c', 'a'])
  })

  it('isTrashExpired:满 30 天过期,未满不过期,无 trashedAt 恒 false', () => {
    const trashedAt = '2026-10-01T00:00:00.000Z'
    expect(isTrashExpired({ trashedAt }, new Date(trashedAt).getTime() + TRASH_TTL_MS)).toBe(true)
    expect(isTrashExpired({ trashedAt }, new Date(trashedAt).getTime() + TRASH_TTL_MS - 1)).toBe(
      false,
    )
    expect(isTrashExpired({ trashedAt: null })).toBe(false)
    expect(isTrashExpired({ trashedAt: '垃圾' })).toBe(false)
  })
})

function trashedOf(items: NoteListItem[]): NoteListItem[] {
  return items.filter((n): n is NoteListItem & { trashedAt: string } => n.trashedAt !== null)
}

describe('sortForList:置顶优先 + updatedAt 倒序', () => {
  it('分区与倒序', () => {
    const sorted = sortForList([
      item({ id: 'a', pinned: false, updatedAt: '2026-10-27T01:00:00.000Z' }),
      item({ id: 'b', pinned: true, updatedAt: '2026-10-26T00:00:00.000Z' }),
      item({ id: 'c', pinned: false, updatedAt: '2026-10-27T05:00:00.000Z' }),
      item({ id: 'd', pinned: true, updatedAt: '2026-10-27T00:00:00.000Z' }),
    ])
    expect(sorted.map((n) => n.id)).toEqual(['d', 'b', 'c', 'a'])
  })
})

describe('isConflictCopy', () => {
  it('识别 `-冲突-yyyyMMdd-HHmm` 后缀', () => {
    expect(isConflictCopy('灵感随手记-冲突-20261028-1012')).toBe(true)
    expect(isConflictCopy('灵感随手记')).toBe(false)
    expect(isConflictCopy('冲突-2026-10-28')).toBe(false)
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-10-28T12:00:00').getTime() // 周三

  it('刚刚 / 分钟 / 小时', () => {
    expect(relativeTime(now - 10_000, now)).toBe('刚刚')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 小时前')
  })

  it('昨天带 HH:mm(>24h 且仍属昨天)', () => {
    expect(relativeTime(new Date('2026-10-27T00:30:00').getTime(), now)).toBe('昨天 00:30')
  })

  it('不足 24 小时优先按小时(即使已属昨天)', () => {
    expect(relativeTime(new Date('2026-10-27T14:30:00').getTime(), now)).toBe('21 小时前')
  })

  it('一周内显示周X', () => {
    expect(relativeTime(new Date('2026-10-26T08:00:00').getTime(), now)).toBe('周一')
  })

  it('更早显示 MM-DD,跨年带年份', () => {
    expect(relativeTime(new Date('2026-10-20T09:00:00').getTime(), now)).toBe('10-20')
    expect(relativeTime(new Date('2025-12-01T09:00:00').getTime(), now)).toBe('2025-12-01')
  })
})

describe('frontmatter ↔ 列表纯函数联测:回收站写入往返', () => {
  it('parse → 标记 trashedAt → serialize → parse 保持字段', () => {
    const note = parseNote('---\nid: t01\ntitle: 草稿\n---\n内容')
    const trashedAt = '2026-10-28T04:00:00.000Z'
    const raw = serializeNote({ ...note, trashedAt, updatedAt: trashedAt })
    const back = parseNote(raw)
    expect(back.trashedAt).toBe(trashedAt)
    expect(back.title).toBe('草稿')
    expect(splitTrash([back]).trashed).toHaveLength(1)
  })
})

// ── 第一批增量:全文搜索 / 排序键 / 待办聚合 ─────────────

describe('searchNotes 全文(第一批)', () => {
  const rawA = serializeNote({
    ...createNote('开头\n\n很深处的关键词蓝鲸\n\n结尾'),
    id: '20261027-120000-aaaaa',
    title: '笔记A',
  })
  const rawB = serializeNote({ ...createNote('普通内容'), id: '20261027-130000-bbbbb', title: '笔记B' })
  const rawOf = (id: string): string => (id.endsWith('aaaaa') ? rawA : rawB)

  it('正文命中(摘要截断覆盖不到的深处文本)', () => {
    const items = [
      item({ id: '20261027-120000-aaaaa', title: '笔记A' }),
      item({ id: '20261027-130000-bbbbb', title: '笔记B' }),
    ]
    const hit = searchNotes(items, '蓝鲸', rawOf)
    expect(hit.map((n) => n.title)).toEqual(['笔记A'])
  })

  it('frontmatter 字段不算正文命中(搜 blue 不命中颜色字段)', () => {
    const items = [item({ id: '20261027-130000-bbbbb', title: '笔记B' })]
    expect(searchNotes(items, 'blue', rawOf)).toEqual([])
  })

  it('无 rawOf 时退化为标题+摘要', () => {
    const items = [item({ title: '购物清单' }), item({ title: '会议' })]
    expect(searchNotes(items, '购物')).toHaveLength(1)
  })
})

describe('sortByKey(第一批)', () => {
  const a = item({ id: 'a', title: '乙', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z' })
  const b = item({
    id: 'b',
    title: '甲',
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    pinned: true,
  })

  it('updated = 修改时间倒序(置顶在前)', () => {
    expect(sortByKey([a, b], 'updated').map((n) => n.id)).toEqual(['b', 'a'])
  })
  it('created = 创建时间倒序', () => {
    expect(sortByKey([a, b], 'created').map((n) => n.id)).toEqual(['b', 'a'])
  })
  it('title = 字典序且置顶仍在前', () => {
    expect(sortByKey([a, b], 'title').map((n) => n.id)).toEqual(['b', 'a'])
  })
})

describe('collectTodos(第一批)', () => {
  const raw = serializeNote({
    ...createNote('- [ ] 买牛奶\n正文\n- [x] 寄快递\n  - [ ] 缩进待办\n* [X] 星号大写待办\n- [ ] \n- 普通列表项'),
    id: '20261027-120000-ccccc',
    title: '购物',
  })
  const rawOf = (): string => raw

  it('收集待办行(含缩进/星号/大小写;空文本不算)', () => {
    const todos = collectTodos([item({ id: '20261027-120000-ccccc', title: '购物' })], rawOf)
    expect(todos.map((t) => t.text)).toEqual(['买牛奶', '缩进待办', '寄快递', '星号大写待办'])
    expect(todos.map((t) => t.done)).toEqual([false, false, true, true])
  })

  it('行号记录正确(写回定位用)且未完成在前', () => {
    const todos = collectTodos([item({ id: '20261027-120000-ccccc', title: '购物' })], rawOf)
    expect(todos[0]?.lineIndex).toBe(0)
    expect(todos[1]?.lineIndex).toBe(3) // 缩进待办(未完成)排在已完成的寄快递(行2)之前
    const dones = todos.map((t) => t.done)
    expect(dones).toEqual([...dones.filter((d) => !d), ...dones.filter((d) => d)])
  })
})
