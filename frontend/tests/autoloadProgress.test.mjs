import test from 'node:test'
import assert from 'node:assert/strict'
import { autoloadPhase, autoloadItemProgress } from '../src/utils/autoloadProgress.js'

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
