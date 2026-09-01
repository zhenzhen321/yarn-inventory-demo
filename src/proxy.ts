import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/session'

export async function proxy(req: NextRequest) {
  if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
    const origin = req.headers.get('origin')
    const host = req.headers.get('host')
    if (origin) {
      try {
        if (new URL(origin).host !== host) {
          return NextResponse.json({ error: '请求来源不合法' }, { status: 403 })
        }
      } catch {
        return NextResponse.json({ error: '请求来源不合法' }, { status: 403 })
      }
    }
  }

  const { pathname } = req.nextUrl
  if (pathname === '/api/auth/login') return NextResponse.next()

  const token = req.cookies.get(SESSION_COOKIE)?.value
  let ok = false
  if (token) {
    try {
      await verifySession(token)
      ok = true
    } catch {
      ok = false
    }
  }

  if (!ok) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/app/:path*', '/api/:path*'],
}
