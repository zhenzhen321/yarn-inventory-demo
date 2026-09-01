import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/auth'
import { loginSchema } from '@/lib/validation'
import { SESSION_COOKIE, MAX_AGE, SHORT_SESSION_AGE, signSession } from '@/lib/session'
import { checkLoginLock, recordLoginFailure, recordLoginSuccess } from '@/lib/rateLimit'
import { logAudit } from '@/lib/audit'

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real
  return '未知'
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 })
  }

  const username = parsed.data.username
  const ip = clientIp(req)
  const rateLimitKey = `${ip}:${username.toLocaleLowerCase()}`
  const lock = checkLoginLock(rateLimitKey)
  if (lock.locked) {
    const minutes = Math.ceil((lock.remainingMs ?? 0) / 60000)
    await logAudit({
      userName: username,
      action: 'LOGIN_FAILED',
      target: '登录',
      detail: `账号 ${username} 因尝试次数过多被暂时锁定，IP：${ip}`,
    })
    return NextResponse.json(
      { error: `尝试次数过多，请 ${minutes} 分钟后再试` },
      { status: 429 },
    )
  }

  const user = await prisma.user.findUnique({ where: { username } })
  if (!user || !user.active || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    recordLoginFailure(rateLimitKey)
    await logAudit({
      userName: username,
      action: 'LOGIN_FAILED',
      target: '登录',
      detail: `账号 ${username} 登录失败，IP：${ip}`,
    })
    return NextResponse.json({ error: '账号或密码错误' }, { status: 401 })
  }

  const remember = parsed.data.remember ?? true
  const maxAge = remember ? MAX_AGE : SHORT_SESSION_AGE
  recordLoginSuccess(rateLimitKey)
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'LOGIN_SUCCESS',
    target: '登录',
    detail: `账号 ${username} 登录成功，IP：${ip}`,
  })

  const token = await signSession({ id: user.id, name: user.name, role: user.role }, maxAge)
  const res = NextResponse.json({ ok: true, name: user.name })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge,
    path: '/',
  })
  return res
}
