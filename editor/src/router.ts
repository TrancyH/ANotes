/** hash 路由(#/list、#/edit/:id、#/trash、#/settings)—— 纯解析,单测覆盖。 */

export type Route =
  | { page: 'list' }
  | { page: 'edit'; id: string }
  | { page: 'trash' }
  | { page: 'todos' }
  | { page: 'settings' }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '')
  if (h === '' || h === 'list') return { page: 'list' }
  if (h === 'trash') return { page: 'trash' }
  if (h === 'todos') return { page: 'todos' }
  if (h === 'settings') return { page: 'settings' }
  const edit = /^edit\/([A-Za-z0-9-]+)$/.exec(h)
  if (edit) return { page: 'edit', id: edit[1] }
  return { page: 'list' }
}

export function routeToHash(route: Route): string {
  switch (route.page) {
    case 'list':
      return '#/list'
    case 'trash':
      return '#/trash'
    case 'todos':
      return '#/todos'
    case 'settings':
      return '#/settings'
    case 'edit':
      return `#/edit/${route.id}`
  }
}
