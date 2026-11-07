import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cookieNames, formatBytes, isLocalHost, maskKey, splitByCmpkit, summarizeResources } from '../src/runtime/utils.ts'

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
