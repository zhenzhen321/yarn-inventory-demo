import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { warehouseSchema } from '@/lib/validation'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const rows = await prisma.warehouse.findMany({
    where: q ? { name: { contains: q } } : {},
    orderBy: { name: 'asc' },
  })
  const factoryIds = rows.filter((r) => r.type === 'FACTORY').map((r) => r.id)
  if (factoryIds.length === 0) return NextResponse.json(rows)
  const [feeAgg, payAgg, feeRecords] = await Promise.all([
    prisma.processingFeeSettlement.groupBy({
      by: ['warehouseId'],
      where: { warehouseId: { in: factoryIds } },
      _sum: { feeTotal: true },
      _count: { _all: true },
    }),
    prisma.processingFeePayment.groupBy({
      by: ['factoryId'],
      where: { factoryId: { in: factoryIds } },
      _sum: { amount: true },
    }),
    prisma.processingFeeSettlement.findMany({
      where: { warehouseId: { in: factoryIds } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { variant: { include: { yarn: true } } },
    }),
  ])
  const feeMap = new Map(feeAgg.map((r) => [r.warehouseId, r]))
  const payMap = new Map(payAgg.map((r) => [r.factoryId, r]))
  const byFactory = new Map<string, typeof feeRecords>()
  for (const r of feeRecords) {
    const arr = byFactory.get(r.warehouseId) ?? []
    arr.push(r)
    byFactory.set(r.warehouseId, arr)
  }
  return NextResponse.json(
    rows.map((r) => {
      if (r.type !== 'FACTORY') return r
      const total = feeMap.get(r.id)?._sum.feeTotal ?? new Prisma.Decimal(0)
      const paid = payMap.get(r.id)?._sum.amount ?? new Prisma.Decimal(0)
      const owed = total.minus(paid)
      return {
        ...r,
        feeTotal: total,
        feePaid: paid,
        feeOwed: owed.lessThan(0) ? new Prisma.Decimal(0) : owed,
        feeCount: feeMap.get(r.id)?._count._all ?? 0,
        processingFeeSettlements: (byFactory.get(r.id) ?? []).slice(0, 3),
      }
    }),
  )
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const parsed = warehouseSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '参数不正确' }, { status: 400 })
  const row = await prisma.warehouse.create({ data: parsed.data })
  await logAudit({
    userName: user?.name ?? '未知',
    action: 'WAREHOUSE_CREATE',
    target: '仓库',
    detail: `名称：${row.name}，类型：${row.type}`,
  })
  return NextResponse.json(row, { status: 201 })
}
