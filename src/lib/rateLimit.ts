interface Entry {
  count: number
  lastFail: number
  lockedUntil: number | null
}

const MAX_ATTEMPTS = 5
const LOCK_MS = 15 * 60 * 1000
const WINDOW_MS = 15 * 60 * 1000

const attempts = new Map<string, Entry>()

export function checkLoginLock(key: string): { locked: boolean; remainingMs: number | null } {
  const e = attempts.get(key)
  if (e?.lockedUntil && e.lockedUntil > Date.now()) {
    return { locked: true, remainingMs: e.lockedUntil - Date.now() }
  }
  return { locked: false, remainingMs: null }
}

export function recordLoginFailure(key: string): void {
  const now = Date.now()
  const e = attempts.get(key) ?? { count: 0, lastFail: 0, lockedUntil: null }
  if (e.lockedUntil && e.lockedUntil > now) return
  if (now - e.lastFail > WINDOW_MS) e.count = 0
  e.count += 1
  e.lastFail = now
  if (e.count >= MAX_ATTEMPTS) {
    e.lockedUntil = now + LOCK_MS
    e.count = 0
  }
  attempts.set(key, e)
}

export function recordLoginSuccess(key: string): void {
  attempts.delete(key)
}

export function resetRateLimit(): void {
  attempts.clear()
}
