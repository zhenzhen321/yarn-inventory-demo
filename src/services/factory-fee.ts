import { Prisma, PrismaClient } from '@prisma/client'
import { settlementStatus, type SettlementStatus } from './settlement'

export interface FactoryFeeSummary {
  id: string
  name: string
  totalAmount: Prisma.Decimal
  paidAmount: Prisma.Decimal
  owedAmount: Prisma.Decimal
  status: SettlementStatus
  feeCount: number
}

export async function getFactoryFeeSummary(db: PrismaClient): Promise<FactoryFeeSummary[]> {
  const factories = await db.warehouse.findMany({
    where: { type: 'FACTORY', active: true },
    orderBy: { name: 'asc' },
  })
  const [feeAgg, payAgg] = await Promise.all([
    db.processingFeeSettlement.groupBy({
      by: ['warehouseId'],
      _sum: { feeTotal: true },
      _count: { _all: true },
    }),
    db.processingFeePayment.groupBy({
      by: ['factoryId'],
      _sum: { amount: true },
    }),
  ])
  const feeMap = new Map(feeAgg.map((r) => [r.warehouseId, r]))
  const payMap = new Map(payAgg.map((r) => [r.factoryId, r]))
  return factories.map((f) => {
    const total = (feeMap.get(f.id)?._sum.feeTotal ?? new Prisma.Decimal(0)).toDecimalPlaces(2)
    const paid = (payMap.get(f.id)?._sum.amount ?? new Prisma.Decimal(0)).toDecimalPlaces(2)
    const owed = total.minus(paid)
    return {
      id: f.id,
      name: f.name,
      totalAmount: total,
      paidAmount: paid,
      owedAmount: owed.lessThan(0) ? new Prisma.Decimal(0) : owed,
      status: settlementStatus(paid, total),
      feeCount: feeMap.get(f.id)?._count._all ?? 0,
    }
  })
}

export interface FactoryFeePaymentInput {
  factoryId: string
  amount: number
  date: Date
  method?: string | null
  handlerName: string
}

export async function createFactoryFeePayment(db: PrismaClient, input: FactoryFeePaymentInput) {
  return db.$transaction(async (tx) => {
    const factory = await tx.warehouse.findUnique({ where: { id: input.factoryId } })
    if (!factory || factory.type !== 'FACTORY') throw new Error('加工厂不存在')
    const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2)
    if (amount.lessThanOrEqualTo(0)) throw new Error('付款金额必须大于 0')
    const feeTotal =
      (
        await tx.processingFeeSettlement.aggregate({
          where: { warehouseId: input.factoryId },
          _sum: { feeTotal: true },
        })
      )._sum.feeTotal ?? new Prisma.Decimal(0)
    const paid =
      (
        await tx.processingFeePayment.aggregate({
          where: { factoryId: input.factoryId },
          _sum: { amount: true },
        })
      )._sum.amount ?? new Prisma.Decimal(0)
    const remaining = feeTotal.minus(paid).toDecimalPlaces(2)
    if (amount.greaterThan(remaining)) {
      throw new Error(`付款金额超过未结金额，当前未结 ${remaining}`)
    }
    return tx.processingFeePayment.create({
      data: {
        factoryId: input.factoryId,
        amount,
        date: input.date,
        method: input.method ?? null,
        handlerName: input.handlerName,
      },
      include: { factory: true },
    })
  })
}

export async function revertFactoryFeePayment(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    const p = await tx.processingFeePayment.findUnique({ where: { id } })
    if (!p) throw new Error('付款记录不存在')
    await tx.processingFeePayment.delete({ where: { id } })
    return p
  })
}

export interface FactoryFeePaymentRecord {
  id: string
  factoryId: string
  factoryName: string
  amount: Prisma.Decimal
  date: Date
  method: string | null
  handlerName: string
}

export async function getFactoryFeePayments(
  db: PrismaClient,
  filter: { factoryId?: string; from?: Date; to?: Date } = {},
): Promise<FactoryFeePaymentRecord[]> {
  const rows = await db.processingFeePayment.findMany({
    where: {
      ...(filter.factoryId ? { factoryId: filter.factoryId } : {}),
      ...(filter.from || filter.to
        ? {
            date: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    },
    include: { factory: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  })
  return rows.map((r) => ({
    id: r.id,
    factoryId: r.factoryId,
    factoryName: r.factory.name,
    amount: r.amount,
    date: r.date,
    method: r.method,
    handlerName: r.handlerName,
  }))
}

export interface FactoryStatementRow {
  date: Date
  type: '加工费' | '付款'
  yarnName: string
  spec: string
  color: string
  unit: string
  batchNo: string
  inputWeight: Prisma.Decimal | null
  outputWeight: Prisma.Decimal | null
  feePerKg: Prisma.Decimal | null
  amount: Prisma.Decimal
  balance: Prisma.Decimal
  detail: string
}

export async function getFactoryStatement(
  db: PrismaClient,
  factoryId: string,
): Promise<FactoryStatementRow[]> {
  const [settlements, payments] = await Promise.all([
    db.processingFeeSettlement.findMany({
      where: { warehouseId: factoryId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { variant: { include: { yarn: true } } },
    }),
    db.processingFeePayment.findMany({
      where: { factoryId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
  ])
  interface Event {
    date: Date
    seq: number
    type: '加工费' | '付款'
    amount: Prisma.Decimal
    row: Omit<FactoryStatementRow, 'date' | 'type' | 'amount' | 'balance' | 'detail'>
    detail: string
  }
  const events: Event[] = []
  let seq = 0
  for (const s of settlements) {
    events.push({
      date: s.createdAt,
      seq: seq++,
      type: '加工费',
      amount: s.feeTotal,
      row: {
        yarnName: s.variant.yarn.name,
        spec: s.variant.spec,
        color: s.variant.color,
        unit: s.variant.unit,
        batchNo: s.batchNo,
        inputWeight: s.inputWeight,
        outputWeight: s.outputWeight,
        feePerKg: s.feePerKg,
      },
      detail: `本次加工 ${s.inputWeight}kg → 加工后 ${s.outputWeight}kg，单价 ${s.feePerKg} 元/kg，经办 ${s.handlerName}`,
    })
  }
  for (const p of payments) {
    events.push({
      date: p.date,
      seq: seq++,
      type: '付款',
      amount: p.amount.negated(),
      row: {
        yarnName: '',
        spec: '',
        color: '',
        unit: '',
        batchNo: '',
        inputWeight: null,
        outputWeight: null,
        feePerKg: null,
      },
      detail: [p.method, p.handlerName].filter(Boolean).join(' / '),
    })
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.seq - b.seq)
  let balance = new Prisma.Decimal(0)
  return events.map((e) => {
    balance = balance.plus(e.amount).toDecimalPlaces(2)
    return { date: e.date, type: e.type, ...e.row, amount: e.amount, balance, detail: e.detail }
  })
}
