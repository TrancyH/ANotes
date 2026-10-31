import { describe, expect, it } from 'vitest'
import {
  createNote,
  fromLocalInputValue,
  hasExplicitTitle,
  makeNoteId,
  markdownToText,
  noteExcerpt,
  noteWordCount,
  parseNote,
  remindAtLabel,
  serializeNote,
  toLocalInputValue,
} from '../src/frontmatter'

describe('hasExplicitTitle(真机回归:派生标题不回填输入框)', () => {
  it('显式标题 true;空标题/无 frontmatter false', () => {
    expect(hasExplicitTitle(serializeNote({ ...createNote('正文'), title: '我的标题' }))).toBe(true)
    expect(hasExplicitTitle(serializeNote(createNote('')))).toBe(false)
    expect(hasExplicitTitle('裸 markdown')).toBe(false)
  })
})

describe('makeNoteId', () => {
  it('格式为 yyyyMMdd-HHmmss-xxxxx 且两次生成不同', () => {
    const a = makeNoteId(new Date('2026-10-27T06:32:01'))
    const b = makeNoteId(new Date('2026-10-27T06:32:01'))
    expect(a).toMatch(/^20261027-063201-[a-z0-9]{5}$/)
    expect(a).not.toBe(b)
  })

  it('后缀恒为 5 位定长(Kotlin idPattern 严格定长,短后缀会被 writeNote 拒绝)', () => {
    for (let i = 0; i < 1000; i++) {
      expect(makeNoteId(new Date('2026-10-27T06:32:01'))).toMatch(/^20261027-063201-[a-z0-9]{5}$/)
    }
  })
})

describe('提醒时间转换(P1)', () => {
  it('ISO ↔ datetime-local 本地时区往返', () => {
    const iso = new Date(2026, 9, 27, 14, 30).toISOString() // 本地 2026-10-27 14:30
    expect(toLocalInputValue(iso)).toBe('2026-10-27T14:30')
    expect(fromLocalInputValue('2026-10-27T14:30')).toBe(iso)
  })

  it('非法输入容错(空串/乱码 → 空值/null,不抛错)', () => {
    expect(toLocalInputValue('not-a-date')).toBe('')
    expect(fromLocalInputValue('')).toBeNull()
    expect(fromLocalInputValue('garbage')).toBeNull()
  })

  it('remindAtLabel 展示为 MM-DD HH:mm', () => {
    const iso = new Date(2026, 9, 27, 9, 5).toISOString()
    expect(remindAtLabel(iso)).toBe('10-27 09:05')
  })
})

describe('serializeNote / parseNote 往返', () => {
  it('完整字段(v2 八字段)往返无损', () => {
    const note = {
      id: '20261027-100000-abcde',
      title: '会议纪要\n第二行',
      createdAt: '2026-10-27T02:00:00.000Z',
      updatedAt: '2026-10-27T03:00:00.000Z',
      pinned: true,
      color: 'blue',
      trashedAt: null,
      remindAt: null,
      markdown: '# 标题\n\n正文 **加粗** 与 `代码`。',
    }
    const raw = serializeNote(note)
    expect(raw).toContain('id: 20261027-100000-abcde')
    expect(raw).toContain('pinned: true')
    expect(raw).toContain('color: blue')
    expect(parseNote(raw)).toEqual(note)
  })

  it('v2 全量字段(color/trashedAt/remindAt)往返无损', () => {
    const note = {
      ...createNote('body'),
      title: '全量字段',
      color: 'amber' as const,
      trashedAt: '2026-10-27T04:00:00.000Z',
      remindAt: '2026-11-01T08:30:00.000Z',
    }
    expect(parseNote(serializeNote(note))).toEqual(note)
  })

  it('旧 5 字段文件读入按 v2 缺省值,再保存补齐全量(无损升级)', () => {
    const legacy =
      '---\nid: old01\ntitle: 旧笔记\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-02T00:00:00.000Z\npinned: true\n---\n旧正文'
    const parsed = parseNote(legacy)
    expect(parsed.color).toBe('default')
    expect(parsed.trashedAt).toBeNull()
    expect(parsed.remindAt).toBeNull()
    expect(parsed.pinned).toBe(true)
    expect(parsed.title).toBe('旧笔记')
    expect(parsed.markdown).toBe('旧正文')
    const upgraded = parseNote(serializeNote(parsed))
    expect(upgraded).toEqual(parsed)
    const raw = serializeNote(parsed)
    expect(raw).toContain('color: default')
    expect(raw).toContain('trashedAt: null')
    expect(raw).toContain('remindAt: null')
  })

  it('空正文 / 空标题', () => {
    const note = createNote('')
    const back = parseNote(serializeNote(note))
    expect(back.markdown).toBe('')
    expect(back.id).toBe(note.id)
    expect(back.pinned).toBe(false)
    expect(back.color).toBe('default')
  })

  it('正文包含 frontmatter 形态文本时不误切', () => {
    const note = createNote('---\nid: fake\n---\n这是正文里的假 frontmatter')
    const back = parseNote(serializeNote(note))
    expect(back.id).toBe(note.id)
    expect(back.markdown).toBe(note.markdown)
  })

  it('无 frontmatter 的裸 Markdown 尽力还原并派生标题', () => {
    const note = parseNote('你好世界\n\n第二段')
    expect(note.markdown).toBe('你好世界\n\n第二段')
    expect(note.title).toBe('你好世界')
    expect(note.pinned).toBe(false)
  })

  it('损坏字段(坏日期/缺字段)不抛错', () => {
    const note = parseNote('---\nid: x1\ntitle: T\ncreatedAt: not-a-date\n---\nbody')
    expect(note.id).toBe('x1')
    expect(note.title).toBe('T')
    expect(note.createdAt).not.toBe('not-a-date')
    expect(Number.isNaN(new Date(note.createdAt).getTime())).toBe(false)
  })

  it('pinned 非法值按 false', () => {
    const note = parseNote('---\nid: x2\npinned: maybe\n---\n')
    expect(note.pinned).toBe(false)
  })

  it('v2 非法值容错:color 非法按 default,坏时间按 null,null 字面量按 null', () => {
    const note = parseNote(
      '---\nid: x6\ncolor: pink\ntrashedAt: not-a-date\nremindAt: null\n---\n',
    )
    expect(note.color).toBe('default')
    expect(note.trashedAt).toBeNull()
    expect(note.remindAt).toBeNull()
  })
})

describe('markdownToText / 摘要 / 字数', () => {
  it('剥离标题/列表/强调/代码/链接', () => {
    const md = '## 标题\n\n- **粗体** 项\n- [x] 待办项\n\n> 引用\n\n[链接](https://a.b)\n\n`code`'
    expect(markdownToText(md)).toBe('标题\n粗体 项\n待办项\n引用\n链接\ncode')
  })

  it('代码块整体移除', () => {
    expect(markdownToText('前\n```\nsecret\n```\n后')).toBe('前\n后')
  })

  it('excerpt 截断加省略号', () => {
    expect(noteExcerpt('一二三四五', 3)).toBe('一二三…')
    expect(noteExcerpt('一二三', 3)).toBe('一二三')
  })

  it('字数按可见字符,CJK 与英文一致', () => {
    expect(noteWordCount('hello 世界')).toBe(7) // h e l l o 世 界
    expect(noteWordCount('')).toBe(0)
  })
})

describe('派生标题', () => {
  it('正文首行为空行时跳过', () => {
    const note = parseNote('---\nid: x3\n---\n\n\n真正的标题\n')
    expect(note.title).toBe('真正的标题')
  })
  it('全空正文回退「未命名笔记」', () => {
    expect(parseNote('---\nid: x4\n---\n\n\n').title).toBe('未命名笔记')
  })
  it('超长标题截断 40 字', () => {
    const long = '字'.repeat(50)
    const note = parseNote(`---\nid: x5\n---\n${long}`)
    expect(note.title.length).toBe(40)
  })
})
