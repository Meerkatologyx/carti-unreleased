// Lets the app run under a sub-path (GitHub Pages serves this site at
// /<repo>/, not at a domain root).
//
// The app routes on root-relative paths everywhere ("/tracker", "/news/12").
// Rather than touch every call site, the app reads its path through
// appPathname() (the real pathname minus the base), and history writes get the
// base put back in front. With base "/" both are no-ops.

const RAW_BASE = import.meta.env.BASE_URL || '/'
/** "/carti-unreleased" (no trailing slash), or "" at a domain root / relative base. */
export const APP_BASE = RAW_BASE.startsWith('/') ? RAW_BASE.replace(/\/+$/, '') : ''

export function appPathname(): string {
  const p = window.location.pathname
  if (!APP_BASE) return p
  if (p === APP_BASE) return '/'
  return p.startsWith(`${APP_BASE}/`) ? p.slice(APP_BASE.length) : p
}

function withBase(url: string | URL | null | undefined): string | URL | null | undefined {
  if (!APP_BASE || typeof url !== 'string') return url
  if (!url.startsWith('/') || url.startsWith('//')) return url
  if (url === APP_BASE || url.startsWith(`${APP_BASE}/`) || url.startsWith(`${APP_BASE}?`)) return url
  return APP_BASE + url
}

export function installBasePath(): void {
  ;(globalThis as unknown as { appPathname: () => string }).appPathname = appPathname
  if (!APP_BASE) return
  const push = history.pushState.bind(history)
  const replace = history.replaceState.bind(history)
  history.pushState = (data, unused, url) => push(data, unused, withBase(url))
  history.replaceState = (data, unused, url) => replace(data, unused, withBase(url))

  // GitHub Pages answers a deep link (/repo/tracker) with 404.html, which
  // stashes the path in ?p= and bounces here - restore it before routing.
  const params = new URLSearchParams(location.search)
  const stashed = params.get('__p')
  if (stashed != null) {
    params.delete('__p')
    const rest = params.toString()
    replace(history.state, '', `${APP_BASE}${stashed}${rest ? `?${rest}` : ''}${location.hash}`)
  }
}
