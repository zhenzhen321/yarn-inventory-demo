import { Prisma, PrismaClient } from '@prisma/client'
import { businessDateFromInput } from '@/lib/business-date'

export interface OrderRecordFilter {
  type?: 'ALL' | 'PURCHASE' | 'SALE'
  from?: string
  to?: string
  warehouseId?: string
  counterpartyId?: string
  q?: string
  yarnQ?: string
  /** 最多返回的订单数；null 表示不限（导出用）。默认 200。 */
  limit?: number | null
}

export interface OrderItemRecord {
  yarnName: string
  spec: string
  color: string
  unit: string
  batchNo: string
  weight: Prisma.Decimal
  price: Prisma.Decimal
  amount: Prisma.Decimal
  packages: number | null
  lotId: string | null
  lotNo: string | null
  scanCode: string | null
}

export interface OrderRecord {
  id: string
  orderType: 'PURCHASE' | 'SALE'
  orderNo: string
  date: Date
  counterpartyName: string
  warehouseName: string
  handlerName: string
  totalAmount: Prisma.Decimal
  freight: Prisma.Decimal
  note: string | null
  reversedAt: Date | null
  reversedBy: string | null
  items: OrderItemRecord[]
}

function yarnMatch(q: string) {
  return {
    OR: [
      { yarn: { name: { contains: q } } },
      { spec: { contains: q } },
      { color: { contains: q } },
    ],
  }
}

export async function getOrderRecords(
  db: PrismaClient,
  filter: OrderRecordFilter,
): Promise<OrderRecord[]> {
  const limit = filter.limit === null ? null : (filter.limit ?? 200)
  const take = limit === null ? undefined : limit
  const from = filter.from ? businessDateFromInput(filter.from) : undefined
  const to = filter.to ? businessDateFromInput(filter.to) : undefined
  const dateFilter =
    from || to
      ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}
  const common = {
    ...dateFilter,
    ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
    ...(filter.q ? { orderNo: { contains: filter.q } } : {}),
  }

  const [purchases, sales] = await Promise.all([
    filter.type === 'SALE'
      ? Promise.resolve([])
      : db.purchaseOrder.findMany({
          where: {
            ...common,
            ...(filter.counterpartyId ? { supplierId: filter.counterpartyId } : {}),
            ...(filter.yarnQ
              ? { items: { some: { variant: yarnMatch(filter.yarnQ) } } }
              : {}),
          },
          include: {
            supplier: true,
            warehouse: true,
            items: { include: { variant: { include: { yarn: true } }, batch: true, lot: true } },
          },
          orderBy: { date: 'desc' },
          take,
        }),
    filter.type === 'PURCHASE'
      ? Promise.resolve([])
      : db.saleOrder.findMany({
          where: {
            ...common,
            ...(filter.counterpartyId ? { customerId: filter.counterpartyId } : {}),
            ...(filter.yarnQ
              ? { items: { some: { inventory: { variant: yarnMatch(filter.yarnQ) } } } }
              : {}),
          },
          include: {
            customer: true,
            warehouse: true,
            items: {
              include: {
                inventory: {
                  include: { variant: { include: { yarn: true } }, batch: true, lot: true },
                },
                allocations: { include: { lot: true } },
              },
            },
          },
          orderBy: { date: 'desc' },
          take,
        }),
  ])
  const rows: OrderRecord[] = []
  for (const o of purchases) {
    rows.push({
      id: o.id,
      orderType: 'PURCHASE',
      orderNo: o.orderNo,
      date: o.date,
      counterpartyName: o.supplier.name,
      warehouseName: o.warehouse.name,
      handlerName: o.handlerName,
      totalAmount: o.totalAmount,
      freight: o.freight,
      note: o.note,
      reversedAt: o.reversedAt,
      reversedBy: o.reversedBy,
      items: o.items.map((it) => ({
        yarnName: it.variant.yarn.name,
        spec: it.variant.spec,
        color: it.variant.color,
        unit: it.variant.unit,
        batchNo: it.batch.batchNo,
        weight: it.weight,
        price: it.price,
        amount: it.amount,
        packages: it.packages,
        lotId: it.lot?.id ?? null,
        lotNo: it.lot?.lotNo ?? null,
        scanCode: it.lot?.scanCode ?? null,
      })),
    })
  }
  for (const o of sales) {
    rows.push({
      id: o.id,
      orderType: 'SALE',
      orderNo: o.orderNo,
      date: o.date,
      counterpartyName: o.customer.name,
      warehouseName: o.warehouse.name,
      handlerName: o.handlerName,
      totalAmount: o.totalAmount,
      freight: o.freight,
      note: o.note,
      reversedAt: o.reversedAt,
      reversedBy: o.reversedBy,
      items: o.items.map((it) => {
        const lot = it.allocations[0]?.lot ?? it.inventory.lot
        return {
          yarnName: it.inventory.variant.yarn.name,
          spec: it.inventory.variant.spec,
          color: it.inventory.variant.color,
          unit: it.inventory.variant.unit,
          batchNo: it.inventory.batch.batchNo,
          weight: it.weight,
          price: it.price,
          amount: it.amount,
          packages: it.packages,
          lotId: lot?.id ?? null,
          lotNo: lot?.lotNo ?? null,
          scanCode: lot?.scanCode ?? null,
        }
      }),
    })
  }
  rows.sort((a, b) => b.date.getTime() - a.date.getTime())
  return limit === null ? rows : rows.slice(0, limit)
}

/** 统计符合筛选的订单总数，供列表页显示"共 X 张单"。 */
export async function getOrderRecordCount(
  db: PrismaClient,
  filter: OrderRecordFilter,
): Promise<number> {
  const from = filter.from ? businessDateFromInput(filter.from) : undefined
  const to = filter.to ? businessDateFromInput(filter.to) : undefined
  const common = {
    ...(from || to
      ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
    ...(filter.q ? { orderNo: { contains: filter.q } } : {}),
  }
  const [purchases, sales] = await Promise.all([
    filter.type === 'SALE'
      ? Promise.resolve(0)
      : db.purchaseOrder.count({
          where: {
            ...common,
            ...(filter.counterpartyId ? { supplierId: filter.counterpartyId } : {}),
            ...(filter.yarnQ ? { items: { some: { variant: yarnMatch(filter.yarnQ) } } } : {}),
          },
        }),
    filter.type === 'PURCHASE'
      ? Promise.resolve(0)
      : db.saleOrder.count({
          where: {
            ...common,
            ...(filter.counterpartyId ? { customerId: filter.counterpartyId } : {}),
            ...(filter.yarnQ
              ? { items: { some: { inventory: { variant: yarnMatch(filter.yarnQ) } } } }
              : {}),
          },
        }),
  ])
  return purchases + sales
}
