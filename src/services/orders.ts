import { Prisma, PrismaClient } from '@prisma/client'

export interface OrderRecordFilter {
  type?: 'ALL' | 'PURCHASE' | 'SALE'
  from?: string
  to?: string
  warehouseId?: string
  counterpartyId?: string
  q?: string
  yarnQ?: string
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
  const from = filter.from ? new Date(filter.from) : undefined
  const to = filter.to ? new Date(filter.to) : undefined
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
  return rows
}
