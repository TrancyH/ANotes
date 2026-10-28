import { describe, expect, it } from 'vitest'
import { parseHash, routeToHash, type Route } from '../src/router'

describe('parseHash', () => {
  it('四个合法路由', () => {
    expect(parseHash('#/list')).toEqual({ page: 'list' })
    expect(parseHash('#/trash')).toEqual({ page: 'trash' })
    expect(parseHash('#/settings')).toEqual({ page: 'settings' })
    expect(parseHash('#/edit/20261028-101500-x9y2z')).toEqual({
      page: 'edit',
      id: '20261028-101500-x9y2z',
    })
  })

  it('空 hash / 根路径 / 非法路由回退 list', () => {
    expect(parseHash('')).toEqual({ page: 'list' })
    expect(parseHash('#/')).toEqual({ page: 'list' })
    expect(parseHash('#/unknown')).toEqual({ page: 'list' })
    expect(parseHash('#/edit/')).toEqual({ page: 'list' })
  })
})

describe('routeToHash / parseHash 往返', () => {
  it('全部路由往返无损', () => {
    const routes: Route[] = [
      { page: 'list' },
      { page: 'trash' },
      { page: 'settings' },
      { page: 'edit', id: '20261028-101500-x9y2z' },
    ]
    for (const r of routes) expect(parseHash(routeToHash(r))).toEqual(r)
  })
})
