import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { processingFeePaymentSchema } from '@/lib/validation'
import { createFactoryFeePayment, getFactoryFeePayments } from '@/services/factory-fee'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const parsed = processingFeePaymentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const row = await createFactoryFeePayment(prisma, parsed.data)
    await logAudit({
      userName: user?.name ?? '未知',
      action: 'PROCESSING_FEE_PAYMENT',
      target: '加工费付款',
      detail: `加工厂 ${row.factory.name}，金额 ${row.amount}，方式 ${row.method ?? '未指定'}`,
    })
    return NextResponse.json({ id: row.id }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  const rows = await getFactoryFeePayments(prisma)
  return NextResponse.json(rows)
}
