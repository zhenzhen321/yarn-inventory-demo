import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { counterpartySchema } from '@/lib/validation'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getDiscountByCounterparty } from '@/services/settlement'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const [rows, discounts] = await Promise.all([
    prisma.counterparty.findMany({
      where: q ? { name: { contains: q } } : {},
      orderBy: { name: 'asc' },
    }),
    getDiscountByCounterparty(prisma),
  ])
  return NextResponse.json(
    rows.map((r) => {
      const isCustomer = r.type === 'CUSTOMER' || r.type === 'BOTH'
      const d = discounts.get(r.id)
      return {
        ...r,
        discountTotal: isCustomer ? (d ? Number(d.total) : 0) : null,
        discountRecords: isCustomer
          ? (d?.records.map((rec) => ({
              id: rec.id,
              date: rec.date,
              amount: Number(rec.amount),
              handlerName: rec.handlerName,
            })) ?? [])
          : [],
      }
    }),
  )
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = counterpartySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '参数不正确' }, { status: 400 })
  const row = await prisma.counterparty.create({ data: parsed.data })
  const user = await getSessionUser()
  await logAudit({
    userName: user?.name ?? '未知',
    action: 'COUNTERPARTY_CREATE',
    target: '往来单位',
    detail: `名称：${row.name}，类型：${row.type}`,
  })
  return NextResponse.json(row, { status: 201 })
}
