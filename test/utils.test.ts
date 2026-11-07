import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cookieNames, formatBytes, isLocalHost, maskKey, splitByCmpkit, summarizeResources, clampPosition, parsePosition, cookieClearStrings, healthLevel } from '../src/runtime/utils.ts'

test('isLocalHost accepts loopback hosts only', () => {
  for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]', 'app.localhost']) assert.equal(isLocalHost(h), true, h)
  for (const h of ['example.com', 'localhost.example.com', '192.168.1.5', '']) assert.equal(isLocalHost(h), false, h)
})

test('maskKey keeps the last four characters', () => {
  assert.equal(maskKey(''), '')
  assert.equal(maskKey('abc'), '••••')
  assert.equal(maskKey(' demo-public-key-1234 '), '••••1234')
})

test('formatBytes', () => {
  assert.equal(formatBytes(null), '—')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 kB')
})

test('summarizeResources groups third-party origins and hides unknown sizes', () => {
  const rows = summarizeResources([
    { name: 'http://localhost:3000/_nuxt/a.js', startTime: 5, duration: 1, transferSize: 100 },
    { name: 'https://cmpkit.com/widget.js', startTime: 40, duration: 80, transferSize: 0 },
    { name: 'https://cmpkit.com/api/config', startTime: 200, duration: 30, transferSize: 0 },
    { name: 'https://www.googletagmanager.com/gtm.js', startTime: 20, duration: 50, transferSize: 90000 },
    { name: 'data:image/png;base64,xx', startTime: 1, duration: 0, transferSize: 0 },
  ], 'http://localhost:3000')
  assert.deepEqual(rows.map(r => r.origin), ['https://www.googletagmanager.com', 'https://cmpkit.com'])
  assert.equal(rows[1].requests, 2)
  assert.equal(rows[1].bytes, null)
  assert.equal(rows[0].bytes, 90000)
})

test('cookie names are split between CMPKit and the others', () => {
  const names = cookieNames('cmpkit_consent_x=1; _ga=2; ; cmpkit_vid=3')
  assert.deepEqual(names, ['cmpkit_consent_x', '_ga', 'cmpkit_vid'])
  assert.deepEqual(splitByCmpkit(names), { cmpkit: ['cmpkit_consent_x', 'cmpkit_vid'], other: ['_ga'] })
})

test('clampPosition keeps the button inside the viewport', () => {
  const size = { width: 60, height: 30 }
  const viewport = { width: 1000, height: 700 }
  assert.deepEqual(clampPosition({ x: 500, y: 300 }, size, viewport), { x: 500, y: 300 })
  assert.deepEqual(clampPosition({ x: -50, y: -50 }, size, viewport), { x: 8, y: 8 })
  assert.deepEqual(clampPosition({ x: 5000, y: 5000 }, size, viewport), { x: 932, y: 662 })
})

test('parsePosition accepts two finite numbers only', () => {
  assert.deepEqual(parsePosition('{"x":10,"y":20}'), { x: 10, y: 20 })
  for (const bad of [null, '', 'nope', '{"x":"1","y":2}', '{"x":1}', '{"x":null,"y":1}']) assert.equal(parsePosition(bad), null, String(bad))
})

test('healthLevel: bad beats warn beats ok', () => {
  assert.equal(healthLevel(0, 0), 'ok')
  assert.equal(healthLevel(0, 2), 'warn')
  assert.equal(healthLevel(1, 2), 'bad')
})

test('cookieClearStrings expires on the host and its parent domains, not on localhost or an IP', () => {
  assert.deepEqual(cookieClearStrings('a', 'localhost'), ['a=; Max-Age=0; path=/'])
  assert.deepEqual(cookieClearStrings('a', '127.0.0.1'), ['a=; Max-Age=0; path=/'])
  assert.deepEqual(cookieClearStrings('a', 'app.example.com'), [
    'a=; Max-Age=0; path=/',
    'a=; Max-Age=0; path=/; domain=app.example.com',
    'a=; Max-Age=0; path=/; domain=example.com',
  ])
})
