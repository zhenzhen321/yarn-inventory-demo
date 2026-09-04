import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { getCounterpartyStatement } from '@/services/settlement'
import { getFactoryStatement } from '@/services/factory-fee'

const querySchema = z.object({
  side: z.enum(['PURCHASE', 'SALE', 'PROCESSING_FEE']),
  counterpartyId: z.string().min(1),
})

export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    side: url.searchParams.get('side'),
    counterpartyId: url.searchParams.get('counterpartyId'),
  })
  if (!parsed.success) {
    return NextResponse.json({ error: '结算方向或对象不正确' }, { status: 400 })
  }

  const { side, counterpartyId } = parsed.data
  if (side === 'PROCESSING_FEE') {
    const factory = await prisma.warehouse.findFirst({
      where: { id: counterpartyId, type: 'FACTORY' },
      select: { name: true },
    })
    if (!factory) return NextResponse.json({ error: '加工厂不存在' }, { status: 404 })

    const rows = await getFactoryStatement(prisma, counterpartyId)
    return NextResponse.json({
      name: factory.name,
      side,
      rows: rows.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        type: row.type,
        orderNo: null,
        yarnName: row.yarnName,
        spec: row.spec,
        color: row.color,
        unit: row.unit,
        batchNo: row.batchNo,
        lots: row.lots,
        weight: null,
        inputWeight: row.inputWeight?.toString() ?? null,
        outputWeight: row.outputWeight?.toString() ?? null,
        price: null,
        feePerKg: row.feePerKg?.toString() ?? null,
        amount: row.amount.toString(),
        balance: row.balance.toString(),
        detail: row.detail,
      })),
    })
  }

  const counterparty = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { name: true },
  })
  if (!counterparty) return NextResponse.json({ error: '往来单位不存在' }, { status: 404 })

  const rows = (await getCounterpartyStatement(prisma, counterpartyId)).filter(
    (row) => row.side === side,
  )
  return NextResponse.json({
    name: counterparty.name,
    side,
    rows: rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      type: row.type,
      orderNo: row.orderNo === '-' ? null : row.orderNo,
      yarnName: row.yarnName,
      spec: row.spec,
      color: row.color,
      unit: row.unit,
      batchNo: row.batchNo,
      lots: row.lots,
      weight: row.weight?.toString() ?? null,
      inputWeight: null,
      outputWeight: null,
      price: row.price?.toString() ?? null,
      feePerKg: null,
      amount: row.amount.toString(),
      balance:
        side === 'PURCHASE'
          ? row.payableBalance.toString()
          : row.receivableBalance.toString(),
      detail: row.detail,
    })),
  })
}
