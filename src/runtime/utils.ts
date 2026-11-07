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
