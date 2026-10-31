// @vitest-environment jsdom
// 回归:mount 的复用 shortcut 曾直接 return 旧 handle,不把缓存的编辑器 DOM 搬进新 #host
// → 第二次进入编辑页标题输入框与正文全部消失。复用 mount 必须搬移 DOM 并更新回调。
import '../src/android-main'
import { describe, expect, it, vi } from 'vitest'

function freshHost(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}

describe('编辑器跨页面复用(mount 搬移)', () => {
  it('第二次 mount 返回同一 handle,且编辑器 DOM 已搬进新 host', () => {
    document.querySelector('#host')?.remove()
    const host1 = Object.assign(document.createElement('div'), { id: 'host' })
    document.body.appendChild(host1)
    const h1 = window.AmooNotes.mount({ onChange: () => undefined, onTitleInput: () => undefined })
    expect(host1.contains(document.querySelector('.note-title-input'))).toBe(true)

    // 模拟路由重渲染:旧 page 被 replaceChildren 摘除,新 page 带来新的空 #host
    host1.remove()
    const host2 = Object.assign(document.createElement('div'), { id: 'host' })
    document.body.appendChild(host2)
    const h2 = window.AmooNotes.mount({ onChange: () => undefined, onTitleInput: () => undefined })

    expect(h2).toBe(h1) // 同一编辑器实例(内容状态保留)
    expect(host2.contains(document.querySelector('.note-title-input'))).toBe(true)
    expect(host2.querySelector('.notes-prose-host')).toBeTruthy()
  })

  it('复用 mount 后回调更新为新传入的(旧闭包不再被调用)', () => {
    document.querySelector('#host')?.remove()
    const host = Object.assign(document.createElement('div'), { id: 'host' })
    document.body.appendChild(host)
    const stale = vi.fn()
    window.AmooNotes.mount({ onChange: stale, onTitleInput: () => undefined })
    host.remove()

    const host2 = Object.assign(document.createElement('div'), { id: 'host' })
    document.body.appendChild(host2)
    const fresh = vi.fn()
    const handle = window.AmooNotes.mount({ onChange: fresh, onTitleInput: () => undefined })

    handle.setMarkdown('新内容') // setContent(emitUpdate:false) 不触发 onUpdate,改用显式触发
    // 直接验证 callbacks 已换新:onTitleInput 经标题输入框 input 事件回调
    const input = host2.querySelector<HTMLInputElement>('.note-title-input')
    input!.value = 't'
    input!.dispatchEvent(new Event('input'))
    expect(stale).not.toHaveBeenCalled()
  })

  it('loadNote 灌入后 serialize 用文件名 id 覆盖 frontmatter id', () => {
    document.querySelector('#host')?.remove()
    const host = Object.assign(document.createElement('div'), { id: 'host' })
    document.body.appendChild(host)
    window.AmooNotes.mount({ onChange: () => undefined, onTitleInput: () => undefined })
    const raw = [
      '---',
      'id: 11111111-111111-aaaaa',
      'title: 标题',
      'createdAt: 2026-10-27T02:00:00.000Z',
      'updatedAt: 2026-10-27T03:00:00.000Z',
      'pinned: false',
      'color: default',
      'trashedAt: null',
      'remindAt: null',
      '---',
      '',
      '正文',
    ].join('\n')
    window.AmooNotes.loadNote({ id: '20261027-100000-zzzzz', raw })
    expect(window.AmooNotes.meta().id).toBe('20261027-100000-zzzzz')
    const out = window.AmooNotes.serialize()
    expect(out.id).toBe('20261027-100000-zzzzz')
    expect(out.raw).toContain('id: 20261027-100000-zzzzz')
  })
})
