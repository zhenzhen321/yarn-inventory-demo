import { Prisma, PrismaClient } from '@prisma/client'

export type SettlementSide = 'PURCHASE' | 'SALE'
export type SettlementStatus = 'UNPAID' | 'PARTIAL' | 'PAID'

export interface SettlementInput {
  side: SettlementSide
  counterpartyId: string
  amount: number
  date: Date
  method?: string | null
  handlerName: string
}

export function settlementStatus(
  settled: Prisma.Decimal,
  total: Prisma.Decimal,
): SettlementStatus {
  if (total.lessThanOrEqualTo(0)) return 'PAID'
  if (settled.greaterThanOrEqualTo(total)) return 'PAID'
  if (settled.greaterThan(0)) return 'PARTIAL'
  return 'UNPAID'
}

export async function createSettlement(db: PrismaClient, input: SettlementInput) {
  return db.$transaction(async (tx) => {
    const cp = await tx.counterparty.findUnique({ where: { id: input.counterpartyId } })
    if (!cp) throw new Error('往来单位不存在')
    const total =
      input.side === 'PURCHASE'
        ? ((await tx.purchaseOrder.aggregate({
            where: { supplierId: input.counterpartyId, reversedAt: null },
            _sum: { totalAmount: true },
          }))._sum.totalAmount ?? new Prisma.Decimal(0))
        : ((await tx.saleOrder.aggregate({
            where: { customerId: input.counterpartyId, reversedAt: null },
            _sum: { totalAmount: true },
          }))._sum.totalAmount ?? new Prisma.Decimal(0))
    const agg = await tx.settlement.aggregate({
      where: { side: input.side, counterpartyId: input.counterpartyId },
      _sum: { amount: true },
    })
    const settled = agg._sum.amount ?? new Prisma.Decimal(0)
    const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2)
    const remaining = total.minus(settled).toDecimalPlaces(2)
    if (amount.greaterThan(remaining)) {
      throw new Error(`结算金额超过未结金额，当前未结 ${remaining}`)
    }
    return tx.settlement.create({
      data: {
        side: input.side,
        counterpartyId: input.counterpartyId,
        amount,
        date: input.date,
        method: input.method ?? null,
        handlerName: input.handlerName,
      },
      include: { counterparty: true },
    })
  })
}

export interface CounterpartySummary {
  id: string
  name: string
  totalAmount: Prisma.Decimal
  settledAmount: Prisma.Decimal
  remainingAmount: Prisma.Decimal
  status: SettlementStatus
}

async function buildSummary(db: PrismaClient, side: SettlementSide): Promise<CounterpartySummary[]> {
  const orders =
    side === 'PURCHASE'
      ? await db.purchaseOrder.findMany({ where: { reversedAt: null }, include: { supplier: true } })
      : await db.saleOrder.findMany({ where: { reversedAt: null }, include: { customer: true } })
  const settledRows = await db.settlement.findMany({
    where: { side },
    select: { counterpartyId: true, amount: true },
  })
  const settledMap = new Map<string, Prisma.Decimal>()
  for (const s of settledRows) {
    settledMap.set(
      s.counterpartyId,
      (settledMap.get(s.counterpartyId) ?? new Prisma.Decimal(0)).plus(s.amount),
    )
  }
  const map = new Map<string, CounterpartySummary>()
  for (const o of orders) {
    const cp =
      side === 'PURCHASE'
        ? (o as { supplier: { id: string; name: string } }).supplier
        : (o as { customer: { id: string; name: string } }).customer
    const cur =
      map.get(cp.id) ??
      ({
        id: cp.id,
        name: cp.name,
        totalAmount: new Prisma.Decimal(0),
        settledAmount: new Prisma.Decimal(0),
        remainingAmount: new Prisma.Decimal(0),
        status: 'UNPAID' as SettlementStatus,
      } as CounterpartySummary)
    cur.totalAmount = cur.totalAmount.plus(o.totalAmount)
    map.set(cp.id, cur)
  }
  const rows: CounterpartySummary[] = []
  for (const cur of map.values()) {
    cur.settledAmount = settledMap.get(cur.id) ?? new Prisma.Decimal(0)
    cur.remainingAmount = cur.totalAmount.minus(cur.settledAmount).toDecimalPlaces(2)
    cur.status = settlementStatus(cur.settledAmount, cur.totalAmount)
    rows.push(cur)
  }
  return rows.sort((a, b) => Number(b.remainingAmount) - Number(a.remainingAmount))
}

export async function getPayableSummary(db: PrismaClient): Promise<CounterpartySummary[]> {
  return buildSummary(db, 'PURCHASE')
}

export async function getReceivableSummary(db: PrismaClient): Promise<CounterpartySummary[]> {
  return buildSummary(db, 'SALE')
}

export interface SettlementRecord {
  id: string
  side: SettlementSide
  counterpartyId: string
  counterpartyName: string
  amount: Prisma.Decimal
  date: Date
  method: string | null
  handlerName: string
}

export interface SettlementRecordFilter {
  side?: SettlementSide
  counterpartyId?: string
  from?: Date
  to?: Date
  /** null 表示导出全部；页面查询默认最多 500 条 */
  limit?: number | null
}

export async function getSettlementRecords(
  db: PrismaClient,
  filter: SettlementRecordFilter = {},
): Promise<SettlementRecord[]> {
  const rows = await db.settlement.findMany({
    where: {
      ...(filter.side ? { side: filter.side } : {}),
      ...(filter.counterpartyId ? { counterpartyId: filter.counterpartyId } : {}),
      ...(filter.from || filter.to
        ? {
            date: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    },
    include: { counterparty: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    ...(filter.limit === null ? {} : { take: filter.limit ?? 500 }),
  })
  return rows.map((r) => ({
    id: r.id,
    side: r.side as SettlementSide,
    counterpartyId: r.counterpartyId,
    counterpartyName: r.counterparty.name,
    amount: r.amount,
    date: r.date,
    method: r.method,
    handlerName: r.handlerName,
  }))
}

export const STATUS_LABEL: Record<SettlementStatus, string> = {
  UNPAID: '未结',
  PARTIAL: '部分结算',
  PAID: '已结',
}

export interface DiscountRecord {
  id: string
  date: Date
  amount: Prisma.Decimal
  handlerName: string
}

export interface DiscountSummary {
  counterpartyId: string
  total: Prisma.Decimal
  records: DiscountRecord[]
}

/** 按往来单位聚合 SALE 方向、方式为“折让”的结算记录（总额 + 按日期倒序明细）。 */
export async function getDiscountByCounterparty(
  db: PrismaClient,
): Promise<Map<string, DiscountSummary>> {
  const rows = await db.settlement.findMany({
    where: { side: 'SALE', method: '折让' },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })
  const map = new Map<string, DiscountSummary>()
  for (const s of rows) {
    const cur = map.get(s.counterpartyId) ?? {
      counterpartyId: s.counterpartyId,
      total: new Prisma.Decimal(0),
      records: [],
    }
    cur.total = cur.total.plus(s.amount)
    cur.records.push({
      id: s.id,
      date: s.date,
      amount: s.amount,
      handlerName: s.handlerName,
    })
    map.set(s.counterpartyId, cur)
  }
  return map
}

export interface StatementRow {
  date: Date
  type: '买入' | '卖出' | '付款' | '收款'
  orderNo: string
  side: SettlementSide
  yarnName: string
  spec: string
  color: string
  unit: string
  batchNo: string
  lots: { id: string; lotNo: string }[]
  weight: Prisma.Decimal | null
  price: Prisma.Decimal | null
  amount: Prisma.Decimal
  payableBalance: Prisma.Decimal
  receivableBalance: Prisma.Decimal
  detail: string
}

export async function getCounterpartyStatement(
  db: PrismaClient,
  counterpartyId: string,
): Promise<StatementRow[]> {
  const [purchases, sales, settlements] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { supplierId: counterpartyId, reversedAt: null },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: {
        items: {
          include: {
            variant: { include: { yarn: true } },
            batch: true,
            lot: { select: { id: true, lotNo: true } },
          },
        },
      },
    }),
    db.saleOrder.findMany({
      where: { customerId: counterpartyId, reversedAt: null },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: {
        items: {
          include: {
            inventory: {
              include: {
                variant: { include: { yarn: true } },
                batch: true,
                lot: { select: { id: true, lotNo: true } },
              },
            },
            allocations: { include: { lot: { select: { id: true, lotNo: true } } } },
          },
        },
      },
    }),
    db.settlement.findMany({
      where: { counterpartyId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    }),
  ])

  interface ItemLike {
    yarnName: string
    spec: string
    color: string
    unit: string
    batchNo: string
    lots: { id: string; lotNo: string }[]
    weight: Prisma.Decimal | null
    price: Prisma.Decimal | null
    amount: Prisma.Decimal
  }
  interface Event {
    date: Date
    seq: number
    type: StatementRow['type']
    orderNo: string
    side: SettlementSide
    amountDelta: Prisma.Decimal
    items: ItemLike[]
    detail: string
  }
  const events: Event[] = []
  let seq = 0
  for (const o of purchases) {
    const items = o.items.map((it) => ({
      yarnName: it.variant.yarn.name,
      spec: it.variant.spec,
      color: it.variant.color,
      unit: it.variant.unit,
      batchNo: it.batch.batchNo,
      lots: it.lot ? [{ id: it.lot.id, lotNo: it.lot.lotNo }] : [],
      weight: it.weight,
      price: it.price,
      amount: it.amount,
    }))
    events.push({
      date: o.date,
      seq: seq++,
      type: '买入',
      orderNo: o.orderNo,
      side: 'PURCHASE',
      amountDelta: o.totalAmount,
      items,
      detail: o.note ?? '',
    })
  }
  for (const o of sales) {
    const items = o.items.map((it) => {
      const candidates = [
        ...it.allocations.map((allocation) => allocation.lot),
        ...(it.inventory.lot ? [it.inventory.lot] : []),
      ]
      const lots = [...new Map(candidates.map((lot) => [lot.id, lot])).values()]
      return {
        yarnName: it.inventory.variant.yarn.name,
        spec: it.inventory.variant.spec,
        color: it.inventory.variant.color,
        unit: it.inventory.variant.unit,
        batchNo: it.inventory.batch.batchNo,
        lots,
        weight: it.weight,
        price: it.price,
        amount: it.amount,
      }
    })
    events.push({
      date: o.date,
      seq: seq++,
      type: '卖出',
      orderNo: o.orderNo,
      side: 'SALE',
      amountDelta: o.totalAmount,
      items,
      detail: o.note ?? '',
    })
  }
  for (const s of settlements) {
    events.push({
      date: s.date,
      seq: seq++,
      type: s.side === 'PURCHASE' ? '付款' : '收款',
      orderNo: '-',
      side: s.side as SettlementSide,
      amountDelta: s.amount.negated(),
      items: [],
      detail: [s.method, s.handlerName].filter(Boolean).join(' / '),
    })
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.seq - b.seq)

  let payable = new Prisma.Decimal(0)
  let receivable = new Prisma.Decimal(0)
  const rows: StatementRow[] = []
  for (const e of events) {
    const items =
      e.items.length > 0
        ? e.items
        : [
            {
              yarnName: '',
              spec: '',
              color: '',
              unit: '',
              batchNo: '',
              lots: [],
              weight: null,
              price: null,
              amount: e.amountDelta,
            } as ItemLike,
          ]
    for (const it of items) {
      if (e.side === 'PURCHASE') payable = payable.plus(it.amount).toDecimalPlaces(2)
      else receivable = receivable.plus(it.amount).toDecimalPlaces(2)
      rows.push({
        date: e.date,
        type: e.type,
        orderNo: e.orderNo,
        side: e.side,
        yarnName: it.yarnName,
        spec: it.spec,
        color: it.color,
        unit: it.unit,
        batchNo: it.batchNo,
        lots: it.lots,
        weight: it.weight,
        price: it.price,
        amount: it.amount,
        payableBalance: payable,
        receivableBalance: receivable,
        detail: e.detail,
      })
    }
  }
  return rows
}
