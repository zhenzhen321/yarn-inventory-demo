import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { settlementSchema } from '@/lib/validation'
import { createSettlement, getPayableSummary, getReceivableSummary } from '@/services/settlement'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = settlementSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const row = await createSettlement(prisma, parsed.data)
    const user = await getSessionUser()
    await logAudit({
      userName: user?.name ?? '未知',
      action: 'SETTLEMENT_CREATE',
      target: '登记结算',
      detail: `方向 ${row.side === 'PURCHASE' ? '应付' : '应收'}，往来单位 ${row.counterparty.name}，金额 ${row.amount}`,
    })
    return NextResponse.json({ id: row.id }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  const [payables, receivables] = await Promise.all([
    getPayableSummary(prisma),
    getReceivableSummary(prisma),
  ])
  return NextResponse.json([
    ...payables.map((p) => ({ ...p, side: 'PURCHASE' })),
    ...receivables.map((r) => ({ ...r, side: 'SALE' })),
  ])
}
