import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { revertSale } from '@/services/revert'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  try {
    const order = await prisma.saleOrder.findUnique({
      where: { id: id },
      include: { customer: true },
    })
    if (!order) return NextResponse.json({ error: '卖出单不存在' }, { status: 404 })
    if (user.name !== order.handlerName) {
      return NextResponse.json({ error: '无权限：只能撤回自己的记录' }, { status: 403 })
    }
    await revertSale(prisma, id, user.name)
    await logAudit({
      userName: user.name,
      action: 'SALE_REVERSE',
      target: '撤回卖出',
      detail: `保留原单并生成反向批次流水：单号 ${order.orderNo}，客户 ${order.customer.name}，货款 ${order.totalAmount}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : '撤回失败'
    return NextResponse.json(
      { error: message },
      { status: message === '卖出单不存在' ? 404 : 400 },
    )
  }
}
