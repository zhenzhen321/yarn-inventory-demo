import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { yarnSchema } from '@/lib/validation'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { invalidateMasterData } from '@/lib/master-data-cache'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const rows = await prisma.yarn.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q } },
            { variants: { some: { spec: { contains: q } } } },
            { variants: { some: { color: { contains: q } } } },
          ],
        }
      : {},
    include: { variants: { orderBy: [{ spec: 'asc' }, { color: 'asc' }] } },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(rows)
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const parsed = yarnSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '参数不正确' }, { status: 400 })
  const row = await prisma.yarn.create({ data: parsed.data })
  invalidateMasterData()
  await logAudit({
    userName: user?.name ?? '未知',
    action: 'YARN_CREATE',
    target: '纱线',
    detail: `名称：${row.name}`,
  })
  return NextResponse.json(row, { status: 201 })
}
