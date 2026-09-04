import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { saleSchema } from '@/lib/validation'
import { createSale } from '@/services/inventory'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const parsed = saleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const order = await createSale(prisma, parsed.data)
    await logAudit({
      userName: user?.name ?? '未知',
      action: 'SALE_CREATE',
      target: '卖出出库',
      detail: `单号 ${order.orderNo}，客户 ${order.customer.name}，货款 ${order.totalAmount}，运费 ${order.freight}`,
    })
    return NextResponse.json({ orderNo: order.orderNo }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  const orders = await prisma.saleOrder.findMany({
    where: { reversedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { customer: true, warehouse: true },
  })
  return NextResponse.json(orders)
}
