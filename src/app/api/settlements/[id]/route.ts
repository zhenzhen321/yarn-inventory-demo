import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { revertSettlement } from '@/services/revert'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  try {
    const s = await prisma.settlement.findUnique({
      where: { id: id },
      include: { counterparty: true },
    })
    if (!s) return NextResponse.json({ error: '结算记录不存在' }, { status: 404 })
    if (user.name !== s.handlerName) {
      return NextResponse.json({ error: '无权限：只能撤回自己的记录' }, { status: 403 })
    }
    await revertSettlement(prisma, id)
    await logAudit({
      userName: user.name,
      action: 'SETTLEMENT_DELETE',
      target: '撤回结算',
      detail: `撤回误操作结算：方向 ${s.side === 'PURCHASE' ? '应付' : '应收'}，往来单位 ${s.counterparty.name}，金额 ${s.amount}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : '撤回失败'
    return NextResponse.json(
      { error: message },
      { status: message === '结算记录不存在' ? 404 : 400 },
    )
  }
}
