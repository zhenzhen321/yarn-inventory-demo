import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  await logAudit({
    userName: user?.name ?? '未知',
    action: 'LOGOUT',
    target: '登录',
    detail: '退出登录',
  })
  const res = NextResponse.redirect(new URL('/login', req.url), { status: 303 })
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 0,
    path: '/',
  })
  return res
}
