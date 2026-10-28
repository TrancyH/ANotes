/** DOM 工具、内联图标、Toast、bottom sheet(P0 全 Web UI 的通用件)。 */

export function h(
  tag: string,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    } else if (v === true) {
      el.setAttribute(k, '')
    } else {
      el.setAttribute(k, v as string)
    }
  }
  for (const c of children) {
    if (c == null) continue
    el.append(c instanceof Node ? c : document.createTextNode(c))
  }
  return el
}

/** 简单 path 图标(24 viewBox,currentColor)。 */
export function svg(paths: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('fill', 'none')
  s.setAttribute('stroke', 'currentColor')
  s.setAttribute('stroke-width', '2')
  s.setAttribute('stroke-linecap', 'round')
  s.setAttribute('stroke-linejoin', 'round')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', paths)
  s.appendChild(p)
  return s
}

export const icons = {
  back: svg('M15 18l-6-6 6-6'),
  search: svg('M21 21l-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z'),
  trash: svg('M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6'),
  gear: svg('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'),
  pin: svg('M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'),
  plus: svg('M12 5v14M5 12h14'),
  more: svg('M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'),
  note: svg('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4'),
  check: svg('M20 6L9 17l-5-5'),
  palette: svg('M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3-3 3h-2a2 2 0 0 0-1.5 3.3c.3.4.5.8.5 1.2a2.5 2.5 0 0 1-2.5 2.5zM7.5 10.5h.01M12 7h.01M16.5 10.5h.01'),
  chevron: svg('M9 18l6-6-6-6'),
}

// ── Toast ────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null
let toastEl: HTMLElement | null = null

export function toast(message: string, action?: { label: string; run: () => void }): void {
  if (!toastEl) {
    toastEl = h('div', { id: 'an-toast' })
    document.body.appendChild(toastEl)
  }
  toastEl.replaceChildren(
    h('span', {}, message),
    ...(action
      ? [
          h(
            'button',
            {
              class: 'toast-action',
              onclick: () => {
                hideToast()
                action.run()
              },
            },
            action.label,
          ),
        ]
      : []),
  )
  toastEl.classList.add('show')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(hideToast, action ? 5000 : 2500)
}

function hideToast(): void {
  toastEl?.classList.remove('show')
}

// ── bottom sheet ─────────────────────────────────────

let sheetRoot: HTMLElement | null = null
let sheetClose: (() => void) | null = null

/** 打开 bottom sheet;rows 传 null 行当分组标题。 */
export function openSheet(rows: (HTMLElement | string | null)[]): void {
  if (sheetRoot) closeSheet()
  sheetRoot = h('div', { id: 'an-sheet' })
  const mask = h('div', { class: 'sheet-mask' })
  const panel = h('div', { class: 'sheet-panel' })
  for (const r of rows) {
    if (r == null) continue
    panel.append(typeof r === 'string' ? h('div', { class: 'sheet-title' }, r) : r)
  }
  mask.addEventListener('click', () => closeSheet())
  sheetRoot.append(mask, panel)
  document.body.appendChild(sheetRoot)
  requestAnimationFrame(() => sheetRoot?.classList.add('open'))
  sheetClose = () => {
    sheetRoot?.classList.remove('open')
    const el = sheetRoot
    setTimeout(() => el?.remove(), 340)
    sheetClose = null
  }
}

export function closeSheet(): void {
  sheetClose?.()
}

export function sheetOpen(): boolean {
  return sheetRoot !== null
}

/** 通用 sheet 行。 */
export function sheetRow(
  label: string,
  onclick: () => void,
  opts: { danger?: boolean; value?: string; icon?: Node } = {},
): HTMLElement {
  return h(
    'button',
    { class: `sheet-row${opts.danger ? ' danger' : ''}`, onclick: () => { closeSheet(); onclick() } },
    opts.icon ?? null,
    h('span', {}, label),
    opts.value ? h('span', { class: 'row-value' }, opts.value) : null,
  )
}
