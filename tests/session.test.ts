import { describe, expect, it } from 'vitest'
import { signSession, verifySession } from '@/lib/session'

describe('session', () => {
  it('签名后可验签，载荷一致', async () => {
    process.env.SESSION_SECRET = 'test-secret-at-least-32-characters-long!!'
    const token = await signSession({ id: 'u1', name: '爸爸', role: 'OWNER' })
    const payload = await verifySession(token)
    expect(payload.sub).toBe('u1')
    expect(payload.name).toBe('爸爸')
    expect(payload.role).toBe('OWNER')
  })

  it('篡改令牌后验签失败', async () => {
    process.env.SESSION_SECRET = 'test-secret-at-least-32-characters-long!!'
    const token = await signSession({ id: 'u1', name: '爸爸', role: 'OWNER' })
    const tampered = token.slice(0, -3) + 'abc'
    await expect(verifySession(tampered)).rejects.toThrow()
  })
})
