<script setup lang="ts">
// Development-only panel: renders only on localhost. Reads what the page already has (script tag,
// Performance API, cookies, localStorage, the public window.CMPKit API). It never sends anything anywhere.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRuntimeConfig } from '#imports'
import { cookieNames, formatBytes, isLocalHost, maskKey, splitByCmpkit, summarizeResources, type OriginRow, clampPosition, parsePosition, type Point, cookieClearStrings, healthLevel } from '../utils'

type Tab = 'overview' | 'loaded' | 'consent' | 'storage'
const tabs: { id: Tab, label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'loaded', label: 'Loaded' },
  { id: 'consent', label: 'Consent' },
  { id: 'storage', label: 'Storage' },
]

const position = (useRuntimeConfig().public.cmpkitDebug as { position?: string } | undefined)?.position === 'right' ? 'right' : 'left'
const STORAGE_KEY = 'nuxt-cmpkit-debug:position'
const pos = ref<Point | null>(null)
const dragging = ref(false)
const fabEl = ref<HTMLElement | null>(null)
let drag: { startX: number, startY: number, originX: number, originY: number, moved: boolean } | null = null
let suppressClick = false
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })
const style = computed(() => (pos.value ? { left: `${pos.value.x}px`, top: `${pos.value.y}px`, right: 'auto', bottom: 'auto' } : {}))
const openDown = computed(() => !!pos.value && pos.value.y < window.innerHeight / 2)
const alignRight = computed(() => (pos.value ? pos.value.x > window.innerWidth / 2 : position === 'right'))

function loadPosition() {
  try {
    const saved = parsePosition(localStorage.getItem(STORAGE_KEY))
    if (saved) pos.value = clampPosition(saved, { width: 64, height: 36 }, viewport())
  } catch { /* storage blocked */ }
}
function savePosition() {
  try {
    if (pos.value) localStorage.setItem(STORAGE_KEY, JSON.stringify(pos.value))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage blocked */ }
}
function resetPosition() {
  pos.value = null
  savePosition()
}
function onPointerDown(e: PointerEvent) {
  const el = fabEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  drag = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top, moved: false }
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* not supported */ }
}
function onPointerMove(e: PointerEvent) {
  const el = fabEl.value
  if (!drag || !el) return
  const dx = e.clientX - drag.startX
  const dy = e.clientY - drag.startY
  if (!drag.moved && Math.hypot(dx, dy) < 4) return
  drag.moved = true
  dragging.value = true
  const rect = el.getBoundingClientRect()
  pos.value = clampPosition({ x: drag.originX + dx, y: drag.originY + dy }, { width: rect.width, height: rect.height }, viewport())
}
function onPointerUp() {
  if (!drag) return
  const moved = drag.moved
  drag = null
  dragging.value = false
  if (!moved) return
  savePosition()
  suppressClick = true
  setTimeout(() => { suppressClick = false }, 0)
}
function onGripKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 48 : 16
  const delta = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key]
  const el = fabEl.value
  if (!delta || !el) return
  e.preventDefault()
  const rect = el.getBoundingClientRect()
  const from = pos.value ?? { x: rect.left, y: rect.top }
  pos.value = clampPosition({ x: from.x + delta[0], y: from.y + delta[1] }, { width: rect.width, height: rect.height }, viewport())
  savePosition()
}
function onResize() {
  if (!pos.value || !fabEl.value) return
  const rect = fabEl.value.getBoundingClientRect()
  pos.value = clampPosition(pos.value, { width: rect.width, height: rect.height }, viewport())
}

const visible = ref(false)
const open = ref(false)
const tab = ref<Tab>('overview')

const widget = ref({ found: 0, src: '', attrs: [] as { name: string, value: string }[], key: '', ready: false })
const timing = ref({ size: null as number | null, duration: 0, start: 0 })
const longTasks = ref(0)
const origins = ref<OriginRow[]>([])
const consent = ref<Record<string, unknown> | null>(null)
const cookies = ref({ cmpkit: [] as string[], other: [] as string[] })
const stored = ref<string[]>([])
const events = ref<string[]>([])

const cmp = () => (window as unknown as { CMPKit?: Record<string, (...a: unknown[]) => unknown> }).CMPKit

function refresh() {
  const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[data-api-key]')]
    .filter(s => /cmpkit|widget/i.test(s.src) || s.hasAttribute('data-cmpkit'))
  const first = scripts[0]
  widget.value = {
    found: scripts.length,
    src: first?.src ?? '',
    attrs: first ? [...first.attributes].filter(a => a.name.startsWith('data-') && a.name !== 'data-api-key').map(a => ({ name: a.name, value: a.value })) : [],
    key: first?.getAttribute('data-api-key') ?? '',
    ready: typeof cmp()?.getConsent === 'function',
  }
  const entry = first ? performance.getEntriesByType('resource').find(e => e.name === first.src) as PerformanceResourceTiming | undefined : undefined
  timing.value = entry
    ? { size: entry.transferSize > 0 ? entry.transferSize : null, duration: Math.round(entry.duration), start: Math.round(entry.startTime) }
    : { size: null, duration: 0, start: 0 }
  origins.value = summarizeResources(performance.getEntriesByType('resource') as unknown as PerformanceResourceTiming[], location.origin)
  try {
    consent.value = (cmp()?.getConsent?.() as Record<string, unknown> | null) ?? null
  } catch {
    consent.value = null
  }
  cookies.value = splitByCmpkit(cookieNames(document.cookie))
  try {
    stored.value = Object.keys(localStorage).filter(k => k.toLowerCase().startsWith('cmpkit'))
  } catch {
    stored.value = []
  }
}

const problems = computed(() => {
  const list: string[] = []
  if (!widget.value.found) list.push('No CMPKit script tag found on this page.')
  if (widget.value.found > 1) list.push(`${widget.value.found} CMPKit script tags found: the widget is loaded more than once.`)
  if (widget.value.found && !widget.value.key.trim()) list.push('The script tag has an empty data-api-key.')
  if (widget.value.found && !widget.value.ready) list.push('window.CMPKit is not ready yet (script still loading, blocked or failed).')
  return list
})
const notices = computed(() => {
  const list: string[] = []
  if (cookies.value.other.length) list.push(`${cookies.value.other.length} other cookie(s) set (see the Storage tab). On localhost, every app on any port shares the same cookies, so many of them can come from other projects.`)
  return list
})
const warnings = computed(() => [...problems.value, ...notices.value])
const level = computed(() => healthLevel(problems.value.length, notices.value.length))
const allCookieCount = computed(() => cookies.value.cmpkit.length + cookies.value.other.length)
const confirmAll = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | undefined

function clearCookie(name: string) {
  for (const entry of cookieClearStrings(name, location.hostname)) document.cookie = entry
}
function resetCmpkitCookies() {
  for (const name of cookieNames(document.cookie)) if (name.toLowerCase().startsWith('cmpkit')) clearCookie(name)
  try {
    for (const k of Object.keys(localStorage)) if (k.toLowerCase().startsWith('cmpkit')) localStorage.removeItem(k)
  } catch { /* storage blocked */ }
  location.reload()
}
// Two clicks, no browser dialog: the first arms the button for 4 seconds, the second deletes.
function resetAllCookies() {
  if (!confirmAll.value) {
    confirmAll.value = true
    confirmTimer = setTimeout(() => { confirmAll.value = false }, 4000)
    return
  }
  if (confirmTimer) clearTimeout(confirmTimer)
  for (const name of cookieNames(document.cookie)) clearCookie(name)
  location.reload()
}

const consentRows = computed(() => Object.entries(consent.value ?? {}).map(([name, value]) => ({ name, value: typeof value === 'boolean' ? (value ? 'granted' : 'denied') : JSON.stringify(value) })))

let timer: ReturnType<typeof setInterval> | undefined
let observer: PerformanceObserver | undefined
let onChange: ((e: Event) => void) | undefined

onMounted(() => {
  if (!import.meta.dev || !isLocalHost(location.hostname)) return
  visible.value = true
  loadPosition()
  window.addEventListener('resize', onResize)
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.value += e.duration
    })
    observer.observe({ type: 'longtask', buffered: true })
  } catch { /* longtask not supported */ }
  onChange = (e: Event) => {
    events.value = [`${new Date().toLocaleTimeString()} ${JSON.stringify((e as CustomEvent).detail)}`, ...events.value].slice(0, 8)
    refresh()
  }
  window.addEventListener('cmpkit:consent-changed', onChange)
  refresh()
  timer = setInterval(() => { refresh() }, 3000)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (timer) clearInterval(timer)
  observer?.disconnect()
  if (onChange) window.removeEventListener('cmpkit:consent-changed', onChange)
})

function toggle() {
  if (suppressClick) return
  open.value = !open.value
  if (open.value) refresh()
}

const call = (name: string) => { try { cmp()?.[name]?.() } catch { /* widget not ready */ } }

function resetConsent() {
  try {
    for (const k of Object.keys(localStorage)) if (k.toLowerCase().startsWith('cmpkit_consent')) localStorage.removeItem(k)
  } catch { /* storage blocked */ }
  for (const name of cookieNames(document.cookie)) {
    if (name.toLowerCase().startsWith('cmpkit_consent')) document.cookie = `${name}=; Max-Age=0; path=/`
  }
  location.reload()
}
</script>

<template>
  <div v-if="visible" class="cmpkit-debug" :class="[`is-${position}`, { moved: !!pos }]" :style="style" data-cmpkit-debug>
    <section v-if="open" class="panel" :class="[openDown ? 'down' : 'up', alignRight ? 'right0' : 'left0']" role="dialog" aria-label="CMPKit debug">
      <header>
        <strong>CMPKit debug</strong>
        <span class="tag" :class="widget.ready ? 'ok' : 'bad'">{{ widget.ready ? 'ready' : 'not ready' }}</span>
        <button v-if="pos" type="button" class="reset" @click="resetPosition">Reset position</button>
        <button type="button" class="x" aria-label="Close the CMPKit debug panel" @click="open = false">×</button>
      </header>
      <nav aria-label="CMPKit debug sections">
        <button v-for="t in tabs" :key="t.id" type="button" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
      </nav>

      <div v-if="tab === 'overview'" class="body">
        <ul v-if="warnings.length" class="warn"><li v-for="w in warnings" :key="w">{{ w }}</li></ul>
        <dl>
          <dt>Script</dt><dd class="mono">{{ widget.src || '—' }}</dd>
          <dt>Public key</dt><dd class="mono">{{ maskKey(widget.key) || '—' }}</dd>
          <template v-for="a in widget.attrs" :key="a.name"><dt class="mono">{{ a.name }}</dt><dd class="mono">{{ a.value }}</dd></template>
          <dt>Download</dt><dd>{{ timing.duration ? `${timing.duration} ms, starts at ${timing.start} ms` : '—' }}</dd>
          <dt>Size</dt><dd>{{ formatBytes(timing.size) }}</dd>
          <dt>Long tasks</dt><dd>{{ Math.round(longTasks) }} ms in total on this page (all scripts, not only CMPKit)</dd>
        </dl>
      </div>

      <div v-else-if="tab === 'loaded'" class="body">
        <p class="hint">Third-party origins requested by this page, in order of first request. A size of — means the browser hides it for that origin.</p>
        <table v-if="origins.length">
          <thead><tr><th>Origin</th><th>Req.</th><th>Size</th><th>At</th></tr></thead>
          <tbody>
            <tr v-for="o in origins" :key="o.origin">
              <td class="mono">{{ o.origin.replace(/^https?:\/\//, '') }}</td><td>{{ o.requests }}</td><td>{{ formatBytes(o.bytes) }}</td><td>{{ Math.round(o.firstStart) }} ms</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="hint">No third-party request yet.</p>
      </div>

      <div v-else-if="tab === 'consent'" class="body">
        <dl v-if="consentRows.length"><template v-for="r in consentRows" :key="r.name"><dt>{{ r.name }}</dt><dd>{{ r.value }}</dd></template></dl>
        <p v-else class="hint">No consent state yet: the visitor has not chosen, or the widget is not ready.</p>
        <div class="actions">
          <button type="button" @click="call('openSettings')">Open settings</button>
          <button type="button" @click="call('showBanner')">Show banner</button>
          <button type="button" @click="resetConsent">Reset consent</button>
        </div>
        <p class="hint">Last changes</p>
        <ul class="log"><li v-for="e in events" :key="e" class="mono">{{ e }}</li><li v-if="!events.length" class="hint">None since the page loaded.</li></ul>
      </div>

      <div v-else class="body">
        <p class="hint">Cookies set by CMPKit</p>
        <ul class="log"><li v-for="c in cookies.cmpkit" :key="c" class="mono">{{ c }}</li><li v-if="!cookies.cmpkit.length" class="hint">None.</li></ul>
        <p class="hint">Other cookies (names only)</p>
        <ul class="log"><li v-for="c in cookies.other" :key="c" class="mono">{{ c }}</li><li v-if="!cookies.other.length" class="hint">None.</li></ul>
        <p class="hint">localStorage keys</p>
        <ul class="log"><li v-for="k in stored" :key="k" class="mono">{{ k }}</li><li v-if="!stored.length" class="hint">None.</li></ul>
        <div class="actions">
          <button type="button" :disabled="!cookies.cmpkit.length && !stored.length" @click="resetCmpkitCookies">Reset CMPKit cookies</button>
          <button type="button" :class="{ danger: confirmAll }" :disabled="!allCookieCount" @click="resetAllCookies">{{ confirmAll ? `Click again to delete ${allCookieCount}` : 'Reset all cookies' }}</button>
        </div>
        <p class="hint">On localhost, “all cookies” also signs you out of your other local apps.</p>
      </div>
    </section>

    <div ref="fabEl" class="dock" :class="{ dragging }">
      <button type="button" class="grip" aria-label="Drag to move the button (arrow keys also work)" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @keydown="onGripKey">
        <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" fill="currentColor"><circle cx="2.5" cy="3" r="1.4" /><circle cx="7.5" cy="3" r="1.4" /><circle cx="2.5" cy="8" r="1.4" /><circle cx="7.5" cy="8" r="1.4" /><circle cx="2.5" cy="13" r="1.4" /><circle cx="7.5" cy="13" r="1.4" /></svg>
      </button>
      <button type="button" class="fab" :aria-expanded="open" :aria-label="`Toggle the CMPKit debug panel (status: ${level})`" @click="toggle"><span class="light" :class="`lvl-${level}`" aria-hidden="true" />CMP</button>
    </div>
  </div>
</template>

<style scoped>
.cmpkit-debug { position: fixed; bottom: 16px; z-index: 2147483000; font: 12px/1.45 system-ui, sans-serif; color: #e8e6e1; }
.panel.up { bottom: calc(100% + 8px); } .panel.down { top: calc(100% + 8px); } .panel.left0 { left: 0; } .panel.right0 { right: 0; }
.moved { right: auto; bottom: auto; }
.reset { cursor: pointer; border: 1px solid #ffffff33; background: none; color: #e8e6e1; border-radius: 999px; padding: 2px 8px; font: inherit; font-size: 10px; white-space: nowrap; }
.is-left { left: 16px; } .is-right { right: 16px; }
.dock { position: relative; display: inline-flex; align-items: center; border: 1px solid #ffffff26; background: #1b1a17f2; color: #e8e6e1; border-radius: 999px; }
.grip { cursor: grab; touch-action: none; user-select: none; display: inline-flex; align-items: center; border: 0; background: none; color: inherit; opacity: .65; padding: 8px 4px 8px 12px; border-radius: 999px 0 0 999px; }
.grip:hover, .grip:focus-visible { opacity: 1; }
.dock.dragging .grip { cursor: grabbing; }
.fab { cursor: pointer; border: 0; background: none; color: inherit; border-radius: 0 999px 999px 0; padding: 8px 14px 8px 6px; font: 600 11px/1 system-ui, sans-serif; letter-spacing: .14em; white-space: nowrap; }
.light { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: 1px; }
.light.lvl-ok { background: #5fbf6a; box-shadow: 0 0 0 3px #5fbf6a33; } .light.lvl-warn { background: #e0b341; box-shadow: 0 0 0 3px #e0b34133; } .light.lvl-bad { background: #e5584a; box-shadow: 0 0 0 3px #e5584a33; }
.actions button:disabled { opacity: .45; cursor: default; } .actions button.danger { border-color: #c46a5c; color: #f0b3a9; }
.panel { width: min(380px, calc(100vw - 32px)); max-height: min(70vh, 560px); display: flex; flex-direction: column; position: absolute; background: #1b1a17f7; border: 1px solid #ffffff26; border-radius: 14px; box-shadow: 0 18px 50px #0008; overflow: hidden; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #ffffff1a; }
header strong { flex: 1; white-space: nowrap; }
.tag { border-radius: 999px; padding: 2px 8px; font-size: 10px; white-space: nowrap; } .tag.ok { background: #3f6140; } .tag.bad { background: #9e3b2f; }
.x { cursor: pointer; border: 0; background: none; color: inherit; font-size: 18px; line-height: 1; }
nav { display: flex; gap: 2px; padding: 6px 8px; border-bottom: 1px solid #ffffff1a; }
nav button { cursor: pointer; border: 0; background: none; color: #a8a49b; padding: 4px 8px; border-radius: 6px; white-space: nowrap; font: inherit; }
nav button.on { background: #ffffff1a; color: #fff; }
.body { padding: 10px 12px; overflow: auto; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; } dt { color: #a8a49b; white-space: nowrap; } dd { margin: 0; word-break: break-all; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.hint { color: #a8a49b; margin: 8px 0 4px; }
.warn { margin: 0 0 10px; padding: 8px 10px 8px 24px; background: #c9a14a26; border-radius: 8px; color: #e9d29a; }
table { width: 100%; border-collapse: collapse; } th { text-align: left; color: #a8a49b; font-weight: 500; white-space: nowrap; } td, th { padding: 3px 6px 3px 0; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.actions button { cursor: pointer; border: 1px solid #ffffff33; background: #ffffff0d; color: inherit; border-radius: 8px; padding: 5px 10px; white-space: nowrap; font: inherit; }
.log { list-style: none; margin: 0; padding: 0; }
.panel, .panel * { box-sizing: border-box; }
.body { min-width: 0; overscroll-behavior: contain; }
nav { overflow-x: auto; }
header { flex-wrap: wrap; }
/* Narrow screens: the panel is a sheet pinned to the viewport edges (never clipped, whatever the dock position). */
@media (max-width: 520px) {
  .panel, .panel.up, .panel.down, .panel.left0, .panel.right0 { position: fixed; left: 8px; right: 8px; width: auto; max-height: calc(100dvh - 88px); }
  .panel.up { top: auto; bottom: 64px; }
  .panel.down { bottom: auto; top: 64px; }
  dl { grid-template-columns: 1fr; gap: 0; }
  dt { margin-top: 6px; }
}
</style>
