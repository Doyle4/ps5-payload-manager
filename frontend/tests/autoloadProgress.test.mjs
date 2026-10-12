import test from 'node:test'
import assert from 'node:assert/strict'
import { autoloadPhase, autoloadItemProgress, autoloadDisplay } from '../src/utils/autoloadProgress.js'

test('autoload phases distinguish waiting, execution delays, done and aborted', () => {
  for (const state of ['waiting', 'countdown', 'executing', 'done', 'aborted', 'failed', 'disabled']) {
    assert.equal(autoloadPhase({ state, remaining: 0, current: '' }), state)
  }
  assert.equal(autoloadPhase({ remaining: 0, current: 'DONE' }), 'done')
  assert.equal(autoloadPhase({ remaining: 0, current: 'local/a' }), 'executing')
})
test('processed failed/skipped entries never appear successful and pending entries remain pending after abort', () => {
  const status = { state: 'aborted', done: 3, current: '', outcomes: 'sfkp' }
  assert.deepEqual(autoloadItemProgress(status, 0), { active: false, processed: true, failed: false, skipped: false })
  assert.deepEqual(autoloadItemProgress(status, 1), { active: false, processed: true, failed: true, skipped: false })
  assert.deepEqual(autoloadItemProgress(status, 2), { active: false, processed: true, failed: false, skipped: true })
  assert.deepEqual(autoloadItemProgress(status, 3), { active: false, processed: false, failed: false, skipped: false })
})
test('sequence delays do not mark the next payload as currently launching', () => {
  assert.equal(autoloadItemProgress({ state: 'executing', current: 'DELAY', done: 1, outcomes: 'sp' }, 1).active, false)
  assert.equal(autoloadItemProgress({ state: 'executing', current: 'local/next', done: 1, outcomes: 'sp' }, 1).active, true)
})
test('countdown/progress stay finite and clamped for zero, negative and malformed numbers', () => {
  assert.deepEqual(autoloadDisplay({ delay: 0, remaining: 0, total: 0, done: 0 }),
    { total: 0, done: 0, progress: 0, delayMs: 0, remainingMs: 0 })
  for (const value of [NaN, Infinity, -Infinity, -1, '3', null]) {
    const display = autoloadDisplay({ delay: value, remaining_ms: value, remaining: value, total: value, done: value }, 3)
    assert.equal(display.total, 3)
    assert.equal(display.done, 0)
    for (const number of Object.values(display)) assert.ok(Number.isFinite(number) && number >= 0)
  }
  assert.equal(autoloadDisplay({ delay: 5, remaining_ms: 9000, total: 3, done: 99 }).progress, 1)
  assert.equal(autoloadDisplay({ delay: 5, remaining_ms: 9000 }).remainingMs, 5000)
  assert.equal(autoloadDisplay({ remaining: 2 }).remainingMs, 2000)
  assert.equal(autoloadPhase({ remaining: Infinity }), 'disabled')
})
