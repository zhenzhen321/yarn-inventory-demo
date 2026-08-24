import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { SESSION_COOKIE, verifySession, type SessionPayload } from '@/lib/session'

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function getSessionUser(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value
  if (!token) return null
  try {
    return await verifySession(token)
  } catch {
    return null
  }
}

export async function requireAdmin(): Promise<SessionPayload> {
  const user = await getSessionUser()
  if (!user || user.role !== 'OWNER') {
    throw new Error('无权限：仅最高管理员可修改')
  }
  return user
}
