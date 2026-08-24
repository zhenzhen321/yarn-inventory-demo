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
  weight: Prisma.Decimal
  amount: Prisma.Decimal
  packages: number | null
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
            items: { include: { variant: { include: { yarn: true } }, batch: true } },
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
                inventory: { include: { variant: { include: { yarn: true } }, batch: true } },
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
      items: o.items.map((it) => ({
        yarnName: it.variant.yarn.name,
        spec: it.variant.spec,
        color: it.variant.color,
        unit: it.variant.unit,
        weight: it.weight,
        amount: it.amount,
        packages: it.packages,
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
      items: o.items.map((it) => ({
        yarnName: it.inventory.variant.yarn.name,
        spec: it.inventory.variant.spec,
        color: it.inventory.variant.color,
        unit: it.inventory.variant.unit,
        weight: it.weight,
        amount: it.amount,
        packages: it.packages,
      })),
    })
  }
  rows.sort((a, b) => b.date.getTime() - a.date.getTime())
  return rows
}
