import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { purchaseSchema } from '@/lib/validation'
import { createPurchaseIdempotent } from '@/services/inventory'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { invalidateMasterData } from '@/lib/master-data-cache'
import { idempotencyKeyFromRequest } from '@/services/idempotency'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const parsed = purchaseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const result = await createPurchaseIdempotent(
      prisma,
      parsed.data,
      idempotencyKeyFromRequest(req),
    )
    invalidateMasterData()
    const order = result.value
    if (!result.replayed) await logAudit({
      userName: user?.name ?? '未知',
      action: 'PURCHASE_CREATE',
      target: '买入入库',
      detail: `单号 ${order.orderNo}，供应商 ${order.supplier.name}，货款 ${order.totalAmount}，运费 ${order.freight}`,
    })
    return NextResponse.json(
      {
        orderNo: order.orderNo,
        items: order.items.map((item) => ({
          yarnName: item.variant.yarn.name,
          spec: item.variant.spec,
          color: item.variant.color,
          weight: item.weight.toString(),
          unit: item.variant.unit,
          packages: item.packages,
          batchNo: item.batch.batchNo,
          lotNo: item.lot?.lotNo ?? null,
          scanCode: item.lot?.scanCode ?? null,
        })),
      },
      {
        status: result.replayed ? 200 : 201,
        headers: { 'Idempotent-Replayed': String(result.replayed) },
      },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  const orders = await prisma.purchaseOrder.findMany({
    where: { reversedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { supplier: true, warehouse: true },
  })
  return NextResponse.json(orders)
}
