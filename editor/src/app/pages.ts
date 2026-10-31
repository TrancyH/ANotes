import { NOTE_COLORS, type NoteColor, type NoteListItem } from '../types'
import {
  fromLocalInputValue,
  parseNote,
  remindAtLabel,
  toLocalInputValue,
} from '../frontmatter'
import {
  collectTodos,
  filterByColor,
  isConflictCopy,
  relativeTime,
  searchNotes,
  sortByKey,
  sortForList,
  sortForTrash,
  splitTrash,
  todoProgress,
  type SortKey,
} from '../notes-model'
import { getReminderStatus, native } from './bridge'
import { h, icons, openSheet, sheetRow, toast } from './ui'
import { NOTE_COLOR_HEX, type App } from './app-types'

// ── 列表页 ───────────────────────────────────────────

export function renderList(app: App): HTMLElement {
  // 多选态加 .multi:checkbox 显示与选中高亮(.multi .note-card …)依赖该类
  const page = h('div', { class: app.selecting ? 'page multi' : 'page' })
  let countEl: HTMLElement | null = null

  if (app.selecting) {
    page.append(multiBar(app))
  } else {
    countEl = h('span', { class: 'count' }, `${splitTrash(app.notes).live.length} 篇`)
    page.append(
      h(
        'div',
        { class: 'list-header' },
        h('h1', {}, '笔记'),
        countEl,
        h('div', { class: 'spacer' }),
        h(
          'button',
          { class: 'icon-btn', title: '待办汇总', onclick: () => app.navigate({ page: 'todos' }) },
          icons.todos.cloneNode(true),
        ),
        h(
          'button',
          { class: 'icon-btn', title: '排序', onclick: () => openSortSheet(app) },
          icons.sort.cloneNode(true),
        ),
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
    // 多选状态下过滤与搜索冻结(设计 §4.4):chips 一并隐藏,列表保持进入时状态
    page.append(chipsRow(app))
  }

  const listWrap = h('div', { class: 'list-scroll' })
  page.append(listWrap)
  app.renderListItems = (): void => {
    // 计数随列表区一并更新(局部刷新不重建 header,搜索框焦点得以保留)
    if (countEl) countEl.textContent = `${splitTrash(app.notes).live.length} 篇`
    listWrap.replaceChildren(...listCards(app))
  }
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
          // 全选 = 当前过滤/搜索后可见的笔记(多选状态下过滤冻结,与列表展示一致)
          const visible = filterByColor(
            searchNotes(splitTrash(app.notes).live, app.query, app.rawOf),
            app.colorFilter,
          )
          for (const n of visible) app.selection.add(n.id)
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
          if (!confirm(`将 ${ids.length} 篇笔记移入回收站?`)) return
          app.selecting = false
          app.selection.clear()
          app.trashNotes(ids)
          app.render()
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

/** 排序 sheet:三选一(选择后即时生效并持久化)。 */
function openSortSheet(app: App): void {
  const options: { key: SortKey; label: string }[] = [
    { key: 'updated', label: '按修改时间' },
    { key: 'created', label: '按创建时间' },
    { key: 'title', label: '按标题' },
  ]
  openSheet([
    h('div', { class: 'sheet-title' }, '排序方式'),
    ...options.map((o) =>
      sheetRow(o.label, () => app.setSortKey(o.key), {
        value: app.sortKey === o.key ? '✓' : undefined,
      }),
    ),
  ])
}

function listCards(app: App): HTMLElement[] {
  const live = splitTrash(app.notes).live
  const filtered = filterByColor(searchNotes(live, app.query, app.rawOf), app.colorFilter)
  const pinned = sortByKey(filtered.filter((n) => n.pinned), app.sortKey)
  const rest = sortByKey(filtered.filter((n) => !n.pinned), app.sortKey)
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
  // 全部笔记都在回收站(设计 §4.4):专属文案 + 回收站入口
  if (splitTrash(app.notes).trashed.length) {
    return h(
      'div',
      { class: 'empty-state', style: 'padding-top:96px' },
      h('div', { class: 'empty-icon' }, icons.trash.cloneNode(true)),
      h('div', { class: 'empty-title' }, '笔记都在回收站里'),
      h('div', { class: 'empty-desc' }, '恢复它们,或去回收站彻底清理'),
      h(
        'button',
        { class: 'btn btn-ghost', onclick: () => app.navigate({ page: 'trash' }) },
        '打开回收站',
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
  // 同一手势内长按只处理一次(500ms 定时器与系统 contextmenu 谁先到谁处理),
  // 并抑制该手势结束时浏览器补发的合成 click(否则选中被 click 再 toggle 抵消)
  let handledThisGesture = false
  let suppressClick = false
  const cancel = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const longSelect = (): void => {
    if (handledThisGesture) return
    handledThisGesture = true
    suppressClick = true
    if (!app.selecting) {
      app.selecting = true
      app.selection.clear()
    }
    toggleSelect(app, id)
  }
  card.addEventListener(
    'touchstart',
    () => {
      handledThisGesture = false
      suppressClick = false
      timer = setTimeout(() => {
        timer = null
        longSelect()
      }, 500)
    },
    { passive: true },
  )
  card.addEventListener('touchmove', cancel, { passive: true })
  card.addEventListener('touchend', cancel)
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    longSelect()
  })
  card.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false
      return
    }
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
  // 冲突副本呈现(设计 §4.5/§5.3):标题含 -冲突-yyyyMMdd-HHmm 后缀 → 顶栏加徽标
  const conflictBadge = isConflictCopy(parseNote(app.rawOf(id)).title)
    ? h('span', { class: 'badge' }, '冲突')
    : null

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
    const meta = window.AmooNotes.meta()
    dotBtn.replaceChildren(colorDotIcon(meta.color))
    pinBtn.classList.toggle('on', meta.pinned)
  }
  // renderEdit 早于 loadNote 执行,顶栏初始显示的是上一篇的 meta:
  // 挂到 app 供 main 在 loadNote/热替换后(updateFooter 内)回刷
  app.refreshEditTop = refreshTop

  const tools: ([string, string, string] | null)[] = [
    ['undo', '↶', 'tool'],
    ['redo', '↷', 'tool'],
    null,
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
    h('span', { class: 'sep' }),
    h(
      'button',
      { class: 'tool', title: '插入链接', onclick: () => openLinkSheet(app) },
      icons.link.cloneNode(true),
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
      conflictBadge,
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
  // 提醒(设计 §4.5):行内 datetime-local,选值即设;已设提醒时追加「移除」行
  const remindAt = window.AmooNotes.meta().remindAt
  const remindRow = h(
    'div',
    { class: 'sheet-row' },
    icons.clock.cloneNode(true),
    h('span', {}, '提醒'),
    h('input', {
      type: 'datetime-local',
      class: 'remind-input',
      value: remindAt ? toLocalInputValue(remindAt) : '',
      onchange: (e: Event) => {
        const iso = fromLocalInputValue((e.target as HTMLInputElement).value)
        if (iso) app.setReminder(id, iso)
      },
    }),
  )
  const removeRemindRow = remindAt
    ? sheetRow('移除提醒', () => app.setReminder(id, null), { danger: true })
    : null
  const shareRow = sheetRow(
    '分享文本',
    () => {
      app.flushEdit() // 分享含未保存的编辑内容
      const note = window.AmooNotes.parse(window.AmooNotes.serialize().raw)
      const n = native()
      if (n) n.shareText(`${note.title}\n\n${note.markdown}`)
      else toast('仅在 App 内可用')
    },
    { icon: icons.share.cloneNode(true) },
  )
  openSheet([
    h('div', { class: 'sheet-title' }, '笔记操作'),
    pinRow,
    remindRow,
    removeRemindRow,
    shareRow,
    sheetRow(
      '移入回收站',
      () => {
        // 先落盘最新内容再入回收站(撤销/恢复拿到的才是完整版本),
        // 数据操作完成后才退出编辑并导航——route 保持 edit 期间不发生整页重渲,无闪烁
        app.flushEdit()
        app.trashNotes([id])
        app.onLeaveEdit()
        app.navigate({ page: 'list' })
      },
      { danger: true, icon: icons.trash.cloneNode(true) },
    ),
  ])
}

/** 插入链接 sheet:URL 必填(缺协议自动补 https://);有选区作用于选区,无选区插入文本+链接。 */
function openLinkSheet(app: App): void {
  const urlInput = h('input', {
    type: 'url',
    class: 'remind-input link-input',
    placeholder: 'https://…',
  }) as HTMLInputElement
  const textInput = h('input', {
    type: 'text',
    class: 'remind-input link-input',
    placeholder: '显示文本(已选中文字时忽略)',
  }) as HTMLInputElement
  const apply = (): void => {
    let url = urlInput.value.trim()
    if (!url) return
    const lower = url.toLowerCase()
    if (!lower.startsWith('http://') && !lower.startsWith('https://')) url = `https://${url}`
    app.editor?.insertLink(url, textInput.value.trim() || undefined)
  }
  const inLink = app.editor?.inLink() ?? false
  openSheet([
    h('div', { class: 'sheet-title' }, '插入链接'),
    h('div', { class: 'sheet-row' }, icons.link.cloneNode(true), h('span', {}, '网址'), urlInput),
    h('div', { class: 'sheet-row' }, icons.note.cloneNode(true), h('span', {}, '文本'), textInput),
    sheetRow('应用', apply),
    ...(inLink ? [sheetRow('移除当前链接', () => app.editor?.removeLink())] : []),
  ])
}

// ── 待办汇总页 ───────────────────────────────────────

/** 跨笔记待办聚合:未完成在前,勾选即时写回原笔记,点文本跳编辑。 */
export function renderTodos(app: App): HTMLElement {
  const live = splitTrash(app.notes).live
  const todos = collectTodos(live, app.rawOf)
  const open = todos.filter((t) => !t.done).length
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
      h('h1', {}, '待办'),
      h('div', { class: 'spacer' }),
      h('span', { class: 'count' }, `${open} 项未完成`),
    ),
    h('div', { class: 'info-banner' }, '汇总全部笔记中的待办清单;勾选即写回原笔记'),
  )
  const scroll = h('div', { class: 'list-scroll' })
  if (!todos.length) {
    scroll.append(
      h(
        'div',
        { class: 'empty-state' },
        h('div', { class: 'empty-icon' }, icons.todos.cloneNode(true)),
        h('div', { class: 'empty-title' }, '没有待办'),
        h('div', { class: 'empty-desc' }, '在笔记中输入「- [ ] 事项」即可出现在这里'),
      ),
    )
  }
  for (const t of todos) {
    scroll.append(
      h(
        'div',
        { class: `todo-entry${t.done ? ' done' : ''}` },
        h('input', {
          type: 'checkbox',
          ...(t.done ? { checked: true } : {}),
          onchange: (e: Event) => app.toggleTodo(t.noteId, t.lineIndex, (e.target as HTMLInputElement).checked),
        }),
        h(
          'div',
          { class: 'todo-main', onclick: () => app.navigate({ page: 'edit', id: t.noteId }) },
          h('div', { class: 'todo-text' }, t.text),
          h('div', { class: 'todo-note' }, t.noteTitle || '未命名笔记'),
        ),
      ),
    )
  }
  page.append(scroll)
  return page
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
  // 提醒授权状态(设计 §4.7):未授权时显示引导行;精确闹钟仅 API 31+ 需要授权
  const rs = getReminderStatus()
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
      h('div', { class: 'settings-group-title' }, '提醒'),
      h(
        'div',
        { class: 'settings-card' },
        settingsRow('通知权限', rs.notifications ? '已允许' : '未允许'),
        rs.notifications
          ? null
          : h(
              'div',
              { class: 'settings-row' },
              h('span', { class: 'row-label' }, '未开启时收不到提醒通知'),
              h(
                'button',
                {
                  class: 'row-btn',
                  onclick: () => {
                    native()?.requestNotificationPermission()
                    setTimeout(() => app.refresh(), 100)
                  },
                },
                '去授权',
              ),
            ),
        settingsRow('精确闹钟', rs.exactAlarms ? '已允许' : '未允许'),
        rs.exactAlarms
          ? null
          : h(
              'div',
              { class: 'settings-row' },
              h('span', { class: 'row-label' }, '未授权时提醒时间可能偏差'),
              h(
                'button',
                { class: 'row-btn', onclick: () => native()?.openExactAlarmSettings() },
                '去授权',
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
