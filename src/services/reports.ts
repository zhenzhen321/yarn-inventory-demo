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
      where: { date: { gte: since } },
      include: { supplier: true, warehouse: true },
    }),
    db.saleOrder.findMany({
      where: { date: { gte: since } },
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
}

export async function getCustomerOrders(
  db: PrismaClient,
  customerId: string,
): Promise<OrderQueryRow[]> {
  const orders = await db.saleOrder.findMany({
    where: { customerId },
    orderBy: { date: 'desc' },
    include: { customer: true, warehouse: true },
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
  }))
}

export async function getSupplierOrders(
  db: PrismaClient,
  supplierId: string,
): Promise<OrderQueryRow[]> {
  const orders = await db.purchaseOrder.findMany({
    where: { supplierId },
    orderBy: { date: 'desc' },
    include: { supplier: true, warehouse: true },
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
  const [saleOrders, saleItems] = await Promise.all([
    db.saleOrder.findMany(),
    db.saleItem.findMany(),
  ])
  let saleGoodsTotal = new Prisma.Decimal(0)
  let saleFreightTotal = new Prisma.Decimal(0)
  let estimatedCost = new Prisma.Decimal(0)
  let estimatedFreight = new Prisma.Decimal(0)
  for (const o of saleOrders) {
    saleGoodsTotal = saleGoodsTotal.plus(o.totalAmount)
    saleFreightTotal = saleFreightTotal.plus(o.freight)
  }
  for (const it of saleItems) {
    estimatedCost = estimatedCost.plus(new Prisma.Decimal(it.weight).mul(it.unitCost))
    estimatedFreight = estimatedFreight.plus(new Prisma.Decimal(it.weight).mul(it.unitFreight))
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
