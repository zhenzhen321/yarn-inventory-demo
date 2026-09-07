import { Prisma, PrismaClient } from '@prisma/client'
export interface WarehouseValuation {
  name: string
  weight: number
  value: Prisma.Decimal
}

export async function getInventoryValuation(
  db: PrismaClient,
): Promise<WarehouseValuation[]> {
  const inventory = await db.inventory.findMany({
    where: { archived: false },
    include: { warehouse: true },
  })
  const map = new Map<string, WarehouseValuation>()
  for (const r of inventory) {
    const cur =
      map.get(r.warehouseId) ??
      ({ name: r.warehouse.name, weight: 0, value: new Prisma.Decimal(0) } as WarehouseValuation)
    cur.weight += Number(r.weight)
    cur.value = cur.value.plus(r.cost)
    map.set(r.warehouseId, cur)
  }
  return [...map.values()].map((w) => ({
    ...w,
    value: w.value.toDecimalPlaces(2),
  }))
}

export interface FlowRow {
  type: 'PURCHASE' | 'SALE'
  orderNo: string
  date: Date
  counterpartyName: string
  warehouseName: string
  amount: Prisma.Decimal
}

export async function getRecentFlow(db: PrismaClient, days = 30): Promise<FlowRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const [purchases, sales] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { date: { gte: since }, reversedAt: null },
      include: { supplier: true, warehouse: true },
    }),
    db.saleOrder.findMany({
      where: { date: { gte: since }, reversedAt: null },
      include: { customer: true, warehouse: true },
    }),
  ])
  const rows: FlowRow[] = [
    ...purchases.map((o) => ({
      type: 'PURCHASE' as const,
      orderNo: o.orderNo,
      date: o.date,
      counterpartyName: o.supplier.name,
      warehouseName: o.warehouse.name,
      amount: o.totalAmount,
    })),
    ...sales.map((o) => ({
      type: 'SALE' as const,
      orderNo: o.orderNo,
      date: o.date,
      counterpartyName: o.customer.name,
      warehouseName: o.warehouse.name,
      amount: o.totalAmount,
    })),
  ]
  rows.sort((a, b) => b.date.getTime() - a.date.getTime())
  return rows
}

export interface OrderQueryRow {
  id: string
  orderNo: string
  date: Date
  warehouseName: string
  handlerName: string
  counterpartyName: string
  totalAmount: Prisma.Decimal
  freight: Prisma.Decimal
  note: string | null
  items: OrderQueryItemRow[]
}

export interface OrderQueryItemRow {
  yarnName: string
  spec: string
  color: string
  unit: string
  batchNo: string
  weight: Prisma.Decimal
  price: Prisma.Decimal
  amount: Prisma.Decimal
  packages: number | null
}

export async function getCustomerOrders(
  db: PrismaClient,
  customerId: string,
): Promise<OrderQueryRow[]> {
  const orders = await db.saleOrder.findMany({
    where: { customerId, reversedAt: null },
    orderBy: { date: 'desc' },
    include: {
      customer: true,
      warehouse: true,
      items: {
        include: {
          inventory: {
            include: { variant: { include: { yarn: true } }, batch: true },
          },
        },
      },
    },
  })
  return orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    date: o.date,
    warehouseName: o.warehouse.name,
    handlerName: o.handlerName,
    counterpartyName: o.customer.name,
    totalAmount: o.totalAmount,
    freight: o.freight,
    note: o.note,
    items: o.items.map((item) => ({
      yarnName: item.inventory.variant.yarn.name,
      spec: item.inventory.variant.spec,
      color: item.inventory.variant.color,
      unit: item.inventory.variant.unit,
      batchNo: item.inventory.batch.batchNo,
      weight: item.weight,
      price: item.price,
      amount: item.amount,
      packages: item.packages,
    })),
  }))
}

export async function getSupplierOrders(
  db: PrismaClient,
  supplierId: string,
): Promise<OrderQueryRow[]> {
  const orders = await db.purchaseOrder.findMany({
    where: { supplierId, reversedAt: null },
    orderBy: { date: 'desc' },
    include: {
      supplier: true,
      warehouse: true,
      items: { include: { variant: { include: { yarn: true } }, batch: true } },
    },
  })
  return orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    date: o.date,
    warehouseName: o.warehouse.name,
    handlerName: o.handlerName,
    counterpartyName: o.supplier.name,
    totalAmount: o.totalAmount,
    freight: o.freight,
    note: o.note,
    items: o.items.map((item) => ({
      yarnName: item.variant.yarn.name,
      spec: item.variant.spec,
      color: item.variant.color,
      unit: item.variant.unit,
      batchNo: item.batch.batchNo,
      weight: item.weight,
      price: item.price,
      amount: item.amount,
      packages: item.packages,
    })),
  }))
}

export interface ProfitEstimate {
  saleGoodsTotal: Prisma.Decimal
  saleFreightTotal: Prisma.Decimal
  estimatedCost: Prisma.Decimal
  estimatedFreight: Prisma.Decimal
  estimatedProfit: Prisma.Decimal
}

export async function getProfitEstimate(db: PrismaClient): Promise<ProfitEstimate> {
  const saleOrders = await db.saleOrder.findMany({ where: { reversedAt: null } })
  const orderIds = saleOrders.map((order) => order.id)
  const [saleItems, saleMovements] = await Promise.all([
    db.saleItem.findMany({ where: { orderId: { in: orderIds } } }),
    db.stockMovement.findMany({
      where: { type: 'SALE', referenceType: 'SALE', referenceId: { in: orderIds } },
    }),
  ])
  const movementByItem = new Map<string, (typeof saleMovements)[number][]>()
  for (const movement of saleMovements) {
    if (!movement.referenceItemId) continue
    const rows = movementByItem.get(movement.referenceItemId) ?? []
    rows.push(movement)
    movementByItem.set(movement.referenceItemId, rows)
  }
  let saleGoodsTotal = new Prisma.Decimal(0)
  let saleFreightTotal = new Prisma.Decimal(0)
  let estimatedCost = new Prisma.Decimal(0)
  let estimatedFreight = new Prisma.Decimal(0)
  for (const o of saleOrders) {
    saleGoodsTotal = saleGoodsTotal.plus(o.totalAmount)
    saleFreightTotal = saleFreightTotal.plus(o.freight)
  }
  for (const it of saleItems) {
    const movements = movementByItem.get(it.id)
    if (movements?.length) {
      for (const movement of movements) {
        estimatedCost = estimatedCost.plus(movement.goodsCost)
        estimatedFreight = estimatedFreight.plus(movement.freightCost)
      }
    } else {
      estimatedCost = estimatedCost.plus(new Prisma.Decimal(it.weight).mul(it.unitCost))
      estimatedFreight = estimatedFreight.plus(new Prisma.Decimal(it.weight).mul(it.unitFreight))
    }
  }
  const estimatedProfit = saleGoodsTotal
    .minus(estimatedCost)
    .minus(estimatedFreight)
    .minus(saleFreightTotal)
    .toDecimalPlaces(2)
  return {
    saleGoodsTotal,
    saleFreightTotal,
    estimatedCost: estimatedCost.toDecimalPlaces(2),
    estimatedFreight: estimatedFreight.toDecimalPlaces(2),
    estimatedProfit,
  }
}
