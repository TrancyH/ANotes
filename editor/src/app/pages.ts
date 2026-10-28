import { NOTE_COLORS, type NoteColor, type NoteListItem } from '../types'
import {
  filterByColor,
  isConflictCopy,
  relativeTime,
  searchNotes,
  sortForList,
  sortForTrash,
  splitTrash,
  todoProgress,
} from '../notes-model'
import { h, icons, openSheet, sheetRow, toast } from './ui'
import { NOTE_COLOR_HEX, type App } from './app-types'

// ── 列表页 ───────────────────────────────────────────

export function renderList(app: App): HTMLElement {
  const page = h('div', { class: 'page' })

  if (app.selecting) {
    page.append(multiBar(app))
  } else {
    page.append(
      h(
        'div',
        { class: 'list-header' },
        h('h1', {}, '笔记'),
        h('span', { class: 'count' }, `${splitTrash(app.notes).live.length} 篇`),
        h('div', { class: 'spacer' }),
        h(
          'button',
          { class: 'icon-btn', title: '回收站', onclick: () => app.navigate({ page: 'trash' }) },
          icons.trash.cloneNode(true),
        ),
        h(
          'button',
          { class: 'icon-btn', title: '设置', onclick: () => app.navigate({ page: 'settings' }) },
          icons.gear.cloneNode(true),
        ),
      ),
    )
  }

  if (!app.selecting) {
    const search = h('input', {
      type: 'search',
      placeholder: '搜索标题与摘要',
      value: app.query,
      oninput: (e: Event) => app.setQuery((e.target as HTMLInputElement).value),
    })
    page.append(h('div', { class: 'search-bar' }, icons.search.cloneNode(true), search))
  }
  page.append(chipsRow(app))

  const listWrap = h('div', { class: 'list-scroll' })
  page.append(listWrap)
  app.renderListItems = (): void => listWrap.replaceChildren(...listCards(app))
  app.renderListItems()

  if (!app.selecting) {
    page.append(
      h(
        'button',
        { class: 'fab', title: '新建笔记', onclick: () => app.createNote() },
        icons.plus.cloneNode(true),
      ),
    )
  }
  return page
}

function multiBar(app: App): HTMLElement {
  return h(
    'div',
    { class: 'multi-bar' },
    h(
      'button',
      {
        class: 'bar-btn',
        onclick: () => {
          app.selecting = false
          app.selection.clear()
          app.render()
        },
      },
      '取消',
    ),
    h('span', { class: 'sel-count' }, `已选 ${app.selection.size} 篇`),
    h(
      'button',
      {
        class: 'bar-btn',
        onclick: () => {
          for (const n of splitTrash(app.notes).live) app.selection.add(n.id)
          app.render()
        },
      },
      '全选',
    ),
    h(
      'button',
      {
        class: 'bar-btn danger',
        onclick: () => {
          const ids = [...app.selection]
          if (!ids.length) return
          app.selecting = false
          app.selection.clear()
          app.trashNotes(ids)
        },
      },
      '删除',
    ),
  )
}

function chipsRow(app: App): HTMLElement {
  const options: { key: NoteColor | 'all'; label: string }[] = [
    { key: 'all', label: '全部' },
    ...NOTE_COLORS.map((c) => ({ key: c, label: colorLabel(c) })),
  ]
  return h(
    'div',
    { class: 'chips-row' },
    ...options.map((o) =>
      h(
        'button',
        {
          class: `chip${app.colorFilter === o.key ? ' sel' : ''}`,
          onclick: () => {
            app.colorFilter = o.key
            app.render()
          },
        },
        o.key !== 'all'
          ? h('span', {
              class: 'dot',
              style:
                o.key === 'default'
                  ? 'border:1.5px solid var(--an-border-strong)'
                  : `background:${NOTE_COLOR_HEX[o.key]}`,
            })
          : null,
        o.label,
      ),
    ),
  )
}

function colorLabel(c: NoteColor): string {
  return c === 'default' ? '默认' : c === 'blue' ? '蓝' : c === 'green' ? '绿' : '琥珀'
}

function listCards(app: App): HTMLElement[] {
  const live = splitTrash(app.notes).live
  const filtered = filterByColor(searchNotes(live, app.query), app.colorFilter)
  const pinned = sortForList(filtered.filter((n) => n.pinned))
  const rest = sortForList(filtered.filter((n) => !n.pinned))
  const out: HTMLElement[] = []

  if (!filtered.length) return [listEmpty(app)]
  if (pinned.length) {
    out.push(h('div', { class: 'section-label' }, '置顶'))
    pinned.forEach((n) => out.push(noteCard(app, n)))
  }
  if (rest.length) {
    out.push(h('div', { class: 'section-label' }, pinned.length ? '全部笔记' : ''))
    rest.forEach((n) => out.push(noteCard(app, n)))
  }
  return out
}

function listEmpty(app: App): HTMLElement {
  if (app.query.trim() !== '') {
    return h(
      'div',
      { class: 'empty-state', style: 'padding-top:96px' },
      h('div', { class: 'empty-title' }, `没有匹配「${app.query.trim()}」的笔记`),
      h(
        'button',
        {
          class: 'btn btn-ghost',
          onclick: () => {
            app.query = ''
            app.render()
          },
        },
        '清除搜索',
      ),
    )
  }
  return h(
    'div',
    { class: 'empty-state', style: 'padding-top:96px' },
    h('div', { class: 'empty-icon' }, icons.note.cloneNode(true)),
    h('div', { class: 'empty-title' }, '还没有笔记'),
    h(
      'div',
      { class: 'empty-desc' },
      '在电脑上打开 ALink,数据线连接后会自动同步;',
      h('br'),
      '也可以在这里直接新建。',
    ),
    h('button', { class: 'btn btn-primary', onclick: () => app.createNote() }, '新建笔记'),
  )
}

function noteCard(app: App, n: NoteListItem): HTMLElement {
  const progress = todoProgress(app.rawOf(n.id))
  const card = h(
    'div',
    { class: `note-card${app.selection.has(n.id) ? ' checked' : ''}`, 'data-id': n.id },
    h(
      'div',
      { class: 'card-top' },
      h(
        'button',
        {
          class: 'card-check',
          onclick: (e: Event) => {
            e.stopPropagation()
            toggleSelect(app, n.id)
          },
        },
        icons.check.cloneNode(true),
      ),
      h('span', { class: 'card-title' }, n.title),
      isConflictCopy(n.title) ? h('span', { class: 'badge' }, '冲突') : null,
      h('span', {
        class: `card-dot${n.color === 'default' ? ' default' : ''}`,
        style: n.color === 'default' ? '' : `background:${NOTE_COLOR_HEX[n.color]}`,
      }),
    ),
    h('div', { class: 'card-excerpt' }, n.excerpt || ' '),
    h(
      'div',
      { class: 'card-meta' },
      h('span', {}, relativeTime(n.mtime)),
      progress.total
        ? h('span', { class: 'todo-progress' }, `待办 ${progress.done}/${progress.total}`)
        : null,
    ),
  )
  bindCardActivation(app, card, n.id)
  return card
}

/** 点击进入编辑;长按(500ms)/右键 进入多选。 */
function bindCardActivation(app: App, card: HTMLElement, id: string): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const cancel = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  card.addEventListener(
    'touchstart',
    () => {
      timer = setTimeout(() => {
        timer = null
        if (!app.selecting) {
          app.selecting = true
          app.selection.clear()
        }
        toggleSelect(app, id)
      }, 500)
    },
    { passive: true },
  )
  card.addEventListener('touchmove', cancel, { passive: true })
  card.addEventListener('touchend', cancel)
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (!app.selecting) {
      app.selecting = true
      app.selection.clear()
    }
    toggleSelect(app, id)
  })
  card.addEventListener('click', () => {
    if (app.selecting) toggleSelect(app, id)
    else app.navigate({ page: 'edit', id })
  })
}

function toggleSelect(app: App, id: string): void {
  if (app.selection.has(id)) app.selection.delete(id)
  else app.selection.add(id)
  if (app.selecting && !app.selection.size) {
    app.selecting = false
    app.render()
    return
  }
  app.render()
}

// ── 编辑页 ───────────────────────────────────────────

export function renderEdit(app: App, id: string): HTMLElement {
  const meta = window.AmooNotes.meta()

  const dotBtn = h(
    'button',
    { class: 'icon-btn', title: '颜色', onclick: () => openColorSheet(app, refreshTop) },
    colorDotIcon(meta.color),
  )
  const pinBtn = h(
    'button',
    {
      class: `icon-btn${meta.pinned ? ' on' : ''}`,
      title: '置顶',
      onclick: () => {
        const next = !window.AmooNotes.meta().pinned
        window.AmooNotes.setMeta({ pinned: next })
        app.flushEdit()
        pinBtn.classList.toggle('on', next)
      },
    },
    icons.pin.cloneNode(true),
  )
  const refreshTop = (): void => {
    dotBtn.replaceChildren(colorDotIcon(window.AmooNotes.meta().color))
  }

  const tools: ([string, string, string] | null)[] = [
    ['bold', 'B', 'tool b'],
    ['italic', 'I', 'tool i'],
    ['strike', 'S', 'tool s'],
    null,
    ['h2', 'H2', 'tool'],
    ['h3', 'H3', 'tool'],
    null,
    ['ul', '•≡', 'tool'],
    ['ol', '1.', 'tool'],
    ['task', '☑', 'tool'],
    null,
    ['quote', '❝', 'tool'],
    ['code', '‹›', 'tool code'],
  ]
  const toolbar = h(
    'div',
    { class: 'format-toolbar' },
    ...tools.map((t) =>
      t === null
        ? h('span', { class: 'sep' })
        : h(
            'button',
            { class: t[2], onclick: () => app.editor?.exec(t[0]) },
            t[1],
          ),
    ),
  )

  const footerWc = h('span', {}, '0 字')
  const footerSaved = h('span', {}, '')
  app.setEditFooter = (wc, savedAt) => {
    footerWc.textContent = `${wc} 字`
    footerSaved.textContent = savedAt ? `保存于 ${relativeTime(savedAt)}` : ''
  }

  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'edit-topbar' },
      h(
        'button',
        {
          class: 'icon-btn',
          onclick: () => {
            app.onLeaveEdit()
            app.navigate({ page: 'list' })
          },
        },
        icons.back.cloneNode(true),
      ),
      h('div', { class: 'spacer' }),
      dotBtn,
      pinBtn,
      h(
        'button',
        { class: 'icon-btn', title: '更多', onclick: () => openEditSheet(app, id) },
        icons.more.cloneNode(true),
      ),
    ),
    h('div', { class: 'edit-body' }, h('div', { id: 'host' })),
    toolbar,
    h('div', { class: 'edit-footer' }, footerWc, h('div', { class: 'spacer' }), footerSaved),
  )
}

function colorDotIcon(color: NoteColor): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  c.setAttribute('cx', '12')
  c.setAttribute('cy', '12')
  c.setAttribute('r', '8')
  c.setAttribute('fill', color === 'default' ? 'none' : NOTE_COLOR_HEX[color])
  c.setAttribute('stroke', 'currentColor')
  c.setAttribute('stroke-width', color === 'default' ? '1.5' : '0')
  s.appendChild(c)
  return s
}

function openColorSheet(app: App, refreshTop: () => void): void {
  const colors = NOTE_COLORS.map((c) =>
    h(
      'button',
      {
        class: `sheet-dot${window.AmooNotes.meta().color === c ? ' sel' : ''}`,
        onclick: () => {
          window.AmooNotes.setMeta({ color: c })
          app.flushEdit()
          refreshTop()
          openColorSheet(app, refreshTop)
        },
      },
      h('span', {
        class: 'inner',
        style:
          c === 'default'
            ? 'border:1.5px solid var(--an-border-strong);background:transparent'
            : `background:${NOTE_COLOR_HEX[c]}`,
      }),
    ),
  )
  openSheet([h('div', { class: 'sheet-title' }, '笔记颜色'), h('div', { class: 'sheet-colors' }, ...colors)])
}

function openEditSheet(app: App, id: string): void {
  const pinRow = h(
    'button',
    {
      class: 'sheet-row',
      onclick: () => {
        window.AmooNotes.setMeta({ pinned: !window.AmooNotes.meta().pinned })
        app.flushEdit()
        openEditSheet(app, id)
      },
    },
    icons.pin.cloneNode(true),
    h('span', {}, '置顶'),
    h('span', { class: 'row-value' }, window.AmooNotes.meta().pinned ? '已置顶' : '未置顶'),
  )
  openSheet([
    h('div', { class: 'sheet-title' }, '笔记操作'),
    pinRow,
    sheetRow(
      '移入回收站',
      () => {
        app.onLeaveEdit()
        app.navigate({ page: 'list' })
        app.trashNotes([id])
      },
      { danger: true, icon: icons.trash.cloneNode(true) },
    ),
  ])
}

// ── 回收站页 ─────────────────────────────────────────

export function renderTrash(app: App): HTMLElement {
  const trashed = sortForTrash(splitTrash(app.notes).trashed)
  const page = h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'sub-header' },
      h(
        'button',
        { class: 'icon-btn', onclick: () => app.navigate({ page: 'list' }) },
        icons.back.cloneNode(true),
      ),
      h('h1', {}, '回收站'),
      h('div', { class: 'spacer' }),
      ...(trashed.length
        ? [
            h(
              'button',
              {
                class: 'header-action',
                onclick: () => {
                  if (confirm('清空回收站?所有回收站笔记将被彻底删除。')) {
                    app.deleteForever(trashed.map((n) => n.id))
                    toast('回收站已清空')
                    app.refresh()
                  }
                },
              },
              '清空',
            ),
          ]
        : []),
    ),
    h('div', { class: 'info-banner' }, '移入回收站的笔记 30 天后自动彻底删除'),
  )
  const scroll = h('div', { class: 'list-scroll' })
  if (!trashed.length) {
    scroll.append(
      h(
        'div',
        { class: 'empty-state' },
        h('div', { class: 'empty-icon' }, icons.trash.cloneNode(true)),
        h('div', { class: 'empty-title' }, '回收站是空的'),
        h('div', { class: 'empty-desc' }, '在这里恢复或彻底删除笔记'),
      ),
    )
  }
  for (const n of trashed) {
    const trashedAtMs = n.trashedAt ? new Date(n.trashedAt).getTime() : n.mtime
    scroll.append(
      h(
        'div',
        { class: 'note-card' },
        h('div', { class: 'card-top' }, h('span', { class: 'card-title' }, n.title)),
        h('div', { class: 'card-meta' }, h('span', {}, `删于 ${relativeTime(trashedAtMs)}`)),
        h(
          'div',
          { class: 'trash-actions' },
          h(
            'button',
            {
              class: 'btn btn-ghost',
              onclick: () => {
                app.restoreNotes([n.id])
                toast('已恢复')
                app.refresh()
              },
            },
            '恢复',
          ),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-danger-text',
              onclick: () => {
                if (confirm(`彻底删除「${n.title}」?此操作不可撤销。`)) {
                  app.deleteForever([n.id])
                  toast('已彻底删除')
                  app.refresh()
                }
              },
            },
            '彻底删除',
          ),
        ),
      ),
    )
  }
  page.append(scroll)
  return page
}

// ── 设置页 ───────────────────────────────────────────

export function renderSettings(app: App): HTMLElement {
  const s = app.status
  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'sub-header' },
      h(
        'button',
        { class: 'icon-btn', onclick: () => app.navigate({ page: 'list' }) },
        icons.back.cloneNode(true),
      ),
      h('h1', {}, '设置'),
    ),
    h(
      'div',
      { class: 'settings-scroll' },
      h('div', { class: 'settings-group-title' }, '同步'),
      h(
        'div',
        { class: 'settings-card' },
        settingsRow('上次从电脑更新', s.lastExternalWriteAt ? relativeTime(s.lastExternalWriteAt) : '—'),
        settingsRow('本机最近写入', s.lastSelfWriteAt ? relativeTime(s.lastSelfWriteAt) : '—'),
        h(
          'div',
          { class: 'settings-row' },
          h('span', { class: 'row-label' }, '由电脑 ALink 主导(连接后自动双向)'),
          h(
            'button',
            {
              class: 'row-btn',
              onclick: () => {
                window.__flushNow()
                setTimeout(() => app.refresh(), 100)
                toast('已落盘并刷新')
              },
            },
            '立即落盘并刷新',
          ),
        ),
      ),
      h('div', { class: 'settings-group-title' }, '关于'),
      h(
        'div',
        { class: 'settings-card' },
        settingsRow('版本', '0.2.0(P0)'),
        settingsRow('数据格式', 'Markdown 文件'),
      ),
      h(
        'div',
        { class: 'settings-note' },
        '笔记以 Markdown 文件存放在本机应用目录 notes/,电脑 ALink 通过数据线双向同步;删除的笔记进入回收站,30 天后自动彻底删除。',
      ),
    ),
  )
}

function settingsRow(label: string, value: string): HTMLElement {
  return h(
    'div',
    { class: 'settings-row' },
    h('span', { class: 'row-label' }, label),
    h('span', { class: 'row-value' }, value),
  )
}
