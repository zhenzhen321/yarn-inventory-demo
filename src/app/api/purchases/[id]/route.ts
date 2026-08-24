import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { purchaseUpdateSchema } from '@/lib/validation'
import { getSessionUser, requireAdmin } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { updatePurchaseFreight } from '@/services/inventory'
import { revertPurchase } from '@/services/revert'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin().catch(() => null)
  if (!admin) {
    return NextResponse.json({ error: '无权限：仅最高管理员可修改' }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  const parsed = purchaseUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const order = await updatePurchaseFreight(prisma, params.id, parsed.data.freight)
    await logAudit({
      userName: admin.name,
      action: 'PURCHASE_UPDATE',
      target: '买入入库',
      detail: `单号 ${order.orderNo}，运费 ${order.freight}`,
    })
    return NextResponse.json({ orderNo: order.orderNo, freight: order.freight })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json(
      { error: message },
      { status: message === '买入单不存在' ? 404 : 400 },
    )
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: params.id },
      include: { supplier: true },
    })
    if (!order) return NextResponse.json({ error: '买入单不存在' }, { status: 404 })
    if (user.name !== order.handlerName) {
      return NextResponse.json({ error: '无权限：只能撤回自己的记录' }, { status: 403 })
    }
    await revertPurchase(prisma, params.id)
    await logAudit({
      userName: user.name,
      action: 'PURCHASE_DELETE',
      target: '撤回买入',
      detail: `撤回误操作买入：单号 ${order.orderNo}，供应商 ${order.supplier.name}，货款 ${order.totalAmount}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : '撤回失败'
    return NextResponse.json(
      { error: message },
      { status: message === '买入单不存在' ? 404 : 400 },
    )
  }
}
