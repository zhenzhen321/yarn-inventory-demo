import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { purchaseSchema } from '@/lib/validation'
import { createPurchase } from '@/services/inventory'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = purchaseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const order = await createPurchase(prisma, parsed.data)
    const user = await getSessionUser()
    await logAudit({
      userName: user?.name ?? '未知',
      action: 'PURCHASE_CREATE',
      target: '买入入库',
      detail: `单号 ${order.orderNo}，供应商 ${order.supplier.name}，货款 ${order.totalAmount}，运费 ${order.freight}`,
    })
    return NextResponse.json({ orderNo: order.orderNo }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  const orders = await prisma.purchaseOrder.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { supplier: true, warehouse: true },
  })
  return NextResponse.json(orders)
}
