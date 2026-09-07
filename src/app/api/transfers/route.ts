import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { transferSchema } from '@/lib/validation'
import { createTransferIdempotent } from '@/services/inventory'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { idempotencyKeyFromRequest } from '@/services/idempotency'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const parsed = transferSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const result = await createTransferIdempotent(prisma, parsed.data, idempotencyKeyFromRequest(req))
    const order = result.value
    if (!result.replayed) await logAudit({
      userName: user?.name ?? '未知',
      action: 'TRANSFER_CREATE',
      target: '仓库调拨',
      detail: `单号 ${order.orderNo}，加工费单价 ${order.processingFeePerKg ?? 0}，运费 ${order.freight}`,
    })
    return NextResponse.json(
      { orderNo: order.orderNo },
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
  const orders = await prisma.transferOrder.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { fromWarehouse: true, toWarehouse: true },
  })
  return NextResponse.json(orders)
}
