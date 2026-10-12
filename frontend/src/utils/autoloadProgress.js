export function autoloadPhase(status) {
  if (status.state) return status.state
  if (status.current === 'DONE') return 'done'
  if (status.remaining === 0 && status.current) return 'executing'
  return status.remaining >= 0 ? 'countdown' : 'disabled'
}

export function autoloadItemProgress(status, index) {
  const outcome = status.outcomes?.[index]
  const processed = outcome ? outcome !== 'p' : autoloadPhase(status) === 'done' || index < status.done
  return {
    active: autoloadPhase(status) === 'executing' && status.current !== 'DELAY' && index === status.done,
    processed,
    failed: outcome === 'f',
    skipped: outcome === 'k',
  }
}
