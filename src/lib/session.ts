import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE = 'yarn_session'
export const MAX_AGE = 60 * 60 * 24 * 7 // 7 天，单位：秒
export const SHORT_SESSION_AGE = 60 * 60 * 8 // 8 小时

const SESSION_ISSUER = 'yarn-ms'
const SESSION_AUDIENCE = 'yarn-ms-app'

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('缺少 SESSION_SECRET 环境变量')
  if (new TextEncoder().encode(secret).length < 32) {
    throw new Error('SESSION_SECRET 至少需要 32 字节')
  }
  return new TextEncoder().encode(secret)
}

export interface SessionPayload {
  sub: string
  name: string
  role: string
}

export async function signSession(
  user: {
    id: string
    name: string
    role: string
  },
  maxAgeSeconds: number = MAX_AGE,
): Promise<string> {
  return new SignJWT({ name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(secretKey())
}

export async function verifySession(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, secretKey(), {
    algorithms: ['HS256'],
    issuer: SESSION_ISSUER,
    audience: SESSION_AUDIENCE,
  })
  if (!payload.sub || typeof payload.name !== 'string' || typeof payload.role !== 'string') {
    throw new Error('会话无效')
  }
  return { sub: payload.sub, name: payload.name, role: payload.role }
}
