export function autoloadPhase(status) {
  if (['waiting', 'countdown', 'executing', 'done', 'aborted', 'failed', 'disabled'].includes(status.state)) return status.state
  if (status.current === 'DONE') return 'done'
  if (status.remaining === 0 && status.current) return 'executing'
  return Number.isFinite(status.remaining) && status.remaining >= 0 ? 'countdown' : 'disabled'
}

const nonnegative = value => Number.isFinite(value) && value >= 0 ? value : 0
export function autoloadDisplay(status, fallbackTotal = 0) {
  const total = Math.floor(nonnegative(status.total)) || Math.floor(nonnegative(fallbackTotal))
  const done = Math.min(total, Math.floor(nonnegative(status.done)))
  const delayMs = (status.delay === undefined ? 5 : Math.min(3600, nonnegative(status.delay))) * 1000
  const rawMs = Number.isFinite(status.remaining_ms) ? status.remaining_ms : nonnegative(status.remaining) * 1000
  const remainingMs = Math.min(delayMs, nonnegative(rawMs))
  return { total, done, progress: total ? done / total : 0, delayMs, remainingMs }
}

export function autoloadItemProgress(status, index) {
  const rawOutcome = typeof status.outcomes === 'string' ? status.outcomes[index] : null
  const outcome = ['p', 's', 'f', 'k'].includes(rawOutcome) ? rawOutcome : null
  const done = Math.floor(nonnegative(status.done))
  const processed = outcome ? outcome !== 'p' : autoloadPhase(status) === 'done' || index < done
  return {
    active: autoloadPhase(status) === 'executing' && status.current !== 'DELAY' && index === done,
    processed,
    failed: outcome === 'f',
    skipped: outcome === 'k',
  }
}
