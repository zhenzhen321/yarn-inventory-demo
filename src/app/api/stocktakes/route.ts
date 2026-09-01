import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { stocktakeSchema } from '@/lib/validation'
import { createStocktake } from '@/services/inventory'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const parsed = stocktakeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const stocktake = await createStocktake(prisma, parsed.data)
    await logAudit({
      userName: user?.name ?? '未知',
      action: 'STOCKTAKE_CREATE',
      target: '盘库',
      detail: `单号 ${stocktake.orderNo}，仓库 ${stocktake.warehouse.name}`,
    })
    return NextResponse.json({ orderNo: stocktake.orderNo }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  const rows = await prisma.stocktake.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { warehouse: true, items: true },
  })
  return NextResponse.json(rows)
}
