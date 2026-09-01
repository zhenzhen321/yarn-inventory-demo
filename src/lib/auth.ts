import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { SESSION_COOKIE, verifySession, type SessionPayload } from '@/lib/session'

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function getSessionUser(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null
  try {
    const payload = await verifySession(token)
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, role: true, active: true },
    })
    if (!user?.active) return null
    return { sub: user.id, name: user.name, role: user.role }
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
