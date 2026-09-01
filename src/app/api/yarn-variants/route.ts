import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { yarnVariantSchema } from '@/lib/validation'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const yarnId = url.searchParams.get('yarnId') ?? ''
  const rows = await prisma.yarnVariant.findMany({
    where: yarnId ? { yarnId } : {},
    include: { yarn: true },
    orderBy: [{ spec: 'asc' }, { color: 'asc' }, { unit: 'asc' }],
  })
  return NextResponse.json(rows)
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const parsed = yarnVariantSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const row = await prisma.yarnVariant.create({ data: parsed.data, include: { yarn: true } })
    await logAudit({
      userName: user?.name ?? '未知',
      action: 'YARN_VARIANT_CREATE',
      target: '纱线规格',
      detail: `产品：${row.yarn.name}，支数：${row.spec}，色号：${row.color}，单位：${row.unit}`,
    })
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
