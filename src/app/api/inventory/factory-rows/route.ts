import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  const rows = await prisma.inventory.findMany({
    where: {
      archived: false,
      warehouseId: url.searchParams.get('warehouseId') || undefined,
      warehouse: { type: 'FACTORY' },
      ...(url.searchParams.get('includeZero') === '1' ? {} : { weight: { gt: 0 } }),
      ...(q ? { variant: { OR: [{ yarn: { name: { contains: q } } }, { color: { contains: q } }, { spec: { contains: q } }] } } : {}),
    },
    select: {
      id: true, warehouseId: true, weight: true, packages: true, cost: true, freight: true,
      processingFeePerKg: true, processingFeeSettled: true,
      warehouse: { select: { name: true } },
      variant: { select: { yarnId: true, spec: true, color: true, unit: true, yarn: { select: { name: true } } } },
      batch: { select: { batchNo: true } }, lot: { select: { lotNo: true } },
    },
    orderBy: [{ warehouse: { name: 'asc' } }, { variant: { yarn: { name: 'asc' } } }, { batch: { batchNo: 'asc' } }],
  })
  return NextResponse.json({
    rows: rows.map((row) => ({
      id: row.id,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      yarnId: row.variant.yarnId,
      yarnName: row.variant.yarn.name,
      spec: row.variant.spec,
      color: row.variant.color,
      unit: row.variant.unit,
      batchNo: row.batch.batchNo,
      lotNo: row.lot?.lotNo ?? null,
      weight: Number(row.weight),
      packages: row.packages,
      cost: Number(row.cost),
      freight: Number(row.freight),
      feePerKg: row.processingFeePerKg ? Number(row.processingFeePerKg) : null,
      settled: row.processingFeeSettled,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
