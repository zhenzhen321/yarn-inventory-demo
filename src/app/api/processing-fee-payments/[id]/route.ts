import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { revertFactoryFeePayment } from '@/services/factory-fee'

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  try {
    const row = await prisma.processingFeePayment.findUnique({ where: { id: params.id } })
    if (!row) return NextResponse.json({ error: '付款记录不存在' }, { status: 404 })
    if (row.handlerName !== user.name) {
      return NextResponse.json({ error: '无权限：只能撤回自己的记录' }, { status: 403 })
    }
    const deleted = await revertFactoryFeePayment(prisma, params.id)
    await logAudit({
      userName: user.name,
      action: 'PROCESSING_FEE_PAYMENT_DELETE',
      target: '撤回加工费付款',
      detail: `加工厂 ${deleted.factoryId}，金额 ${deleted.amount}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : '撤回失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
