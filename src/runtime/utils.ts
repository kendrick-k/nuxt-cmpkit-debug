export interface ResourceLike {
  name: string
  startTime: number
  duration: number
  transferSize: number
  initiatorType?: string
}

export interface OriginRow {
  origin: string
  requests: number
  /** Transferred bytes, or null when the browser hides the size (cross-origin without Timing-Allow-Origin). */
  bytes: number | null
  /** Start of the first request, in ms since navigation start. */
  firstStart: number
}

/** True for localhost, loopback addresses and `*.localhost`. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost')
}

/** Keeps the last 4 characters of a key, hides the rest. */
export function maskKey(key: string): string {
  const k = key.trim()
  if (!k) return ''
  return k.length <= 4 ? '••••' : `••••${k.slice(-4)}`
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} kB`
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Groups resource timing entries by origin, same-origin requests left out. Sorted by first start. */
export function summarizeResources(entries: ResourceLike[], pageOrigin: string): OriginRow[] {
  const rows = new Map<string, OriginRow>()
  for (const entry of entries) {
    const origin = originOf(entry.name)
    if (!origin || origin === pageOrigin || !/^https?:/.test(origin)) continue
    const row = rows.get(origin) ?? { origin, requests: 0, bytes: null, firstStart: entry.startTime }
    row.requests += 1
    if (entry.transferSize > 0) row.bytes = (row.bytes ?? 0) + entry.transferSize
    row.firstStart = Math.min(row.firstStart, entry.startTime)
    rows.set(origin, row)
  }
  return [...rows.values()].sort((a, b) => a.firstStart - b.firstStart)
}

/** Cookie names from a `document.cookie` string. */
export function cookieNames(cookie: string): string[] {
  return cookie
    .split(';')
    .map(part => part.split('=')[0].trim())
    .filter(Boolean)
}

/** Splits names in the ones set by CMPKit (`cmpkit_*`) and all the others. */
export function splitByCmpkit(names: string[]): { cmpkit: string[], other: string[] } {
  const cmpkit = names.filter(name => name.toLowerCase().startsWith('cmpkit'))
  return { cmpkit, other: names.filter(name => !cmpkit.includes(name)) }
}

export interface Point { x: number, y: number }
export interface Size { width: number, height: number }

/** Keeps a box of `size` fully inside the viewport, with a small margin. */
export function clampPosition(pos: Point, size: Size, viewport: Size, margin = 8): Point {
  const maxX = Math.max(margin, viewport.width - size.width - margin)
  const maxY = Math.max(margin, viewport.height - size.height - margin)
  return { x: Math.min(Math.max(pos.x, margin), maxX), y: Math.min(Math.max(pos.y, margin), maxY) }
}

/** Reads a stored position. Returns null for anything that is not two finite numbers. */
export function parsePosition(raw: string | null): Point | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<Point>
    return typeof value.x === 'number' && typeof value.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null
  } catch {
    return null
  }
}
