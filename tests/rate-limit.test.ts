import { beforeEach, describe, expect, it } from 'vitest'
import {
  checkLoginLock,
  recordLoginFailure,
  recordLoginSuccess,
  resetRateLimit,
} from '@/lib/rateLimit'

beforeEach(() => {
  resetRateLimit()
})

describe('登录限速', () => {
  it('连续失败 5 次后锁定', () => {
    for (let i = 0; i < 5; i++) recordLoginFailure('admin')
    const lock = checkLoginLock('admin')
    expect(lock.locked).toBe(true)
    expect(lock.remainingMs).toBeGreaterThan(0)
  })

  it('锁定前允许继续尝试', () => {
    for (let i = 0; i < 4; i++) recordLoginFailure('admin')
    expect(checkLoginLock('admin').locked).toBe(false)
  })

  it('登录成功后清除失败计数', () => {
    for (let i = 0; i < 4; i++) recordLoginFailure('admin')
    recordLoginSuccess('admin')
    expect(checkLoginLock('admin').locked).toBe(false)
    for (let i = 0; i < 4; i++) recordLoginFailure('admin')
    expect(checkLoginLock('admin').locked).toBe(false)
  })
})
