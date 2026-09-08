import { Prisma, PrismaClient } from '@prisma/client'
export interface WarehouseValuation {
  name: string
  weight: number
  value: Prisma.Decimal
}

export async function getInventoryValuation(
  db: PrismaClient,
): Promise<WarehouseValuation[]> {
  const [grouped, warehouses] = await Promise.all([
    db.inventory.groupBy({
      by: ['warehouseId'],
      where: { archived: false },
      _sum: { weight: true, cost: true },
    }),
    db.warehouse.findMany({ select: { id: true, name: true } }),
  ])
  const nameById = new Map(warehouses.map((w) => [w.id, w.name]))
  return grouped
    .filter((row) => nameById.has(row.warehouseId))
    .map((row) => ({
      name: nameById.get(row.warehouseId)!,
      weight: Number(row._sum.weight ?? 0),
      value: (row._sum.cost ?? new Prisma.Decimal(0)).toDecimalPlaces(2),
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

export interface OrderQueryOptions {
  /** 分页偏移；不传时返回全部（导出用） */
  skip?: number
  /** 每页条数；不传时返回全部（导出用） */
  take?: number
}

export async function getCustomerOrders(
  db: PrismaClient,
  customerId: string,
  options: OrderQueryOptions = {},
): Promise<OrderQueryRow[]> {
  const orders = await db.saleOrder.findMany({
    where: { customerId, reversedAt: null },
    orderBy: { date: 'desc' },
    ...(options.skip !== undefined || options.take !== undefined
      ? {
          skip: options.skip,
          take: options.take,
        }
      : {}),
    select: {
      id: true,
      orderNo: true,
      date: true,
      warehouse: { select: { name: true } },
      handlerName: true,
      customer: { select: { name: true } },
      totalAmount: true,
      freight: true,
      note: true,
      items: {
        select: {
          weight: true,
          price: true,
          amount: true,
          packages: true,
          inventory: {
            select: {
              variant: {
                select: {
                  spec: true,
                  color: true,
                  unit: true,
                  yarn: { select: { name: true } },
                },
              },
              batch: { select: { batchNo: true } },
            },
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
  options: OrderQueryOptions = {},
): Promise<OrderQueryRow[]> {
  const orders = await db.purchaseOrder.findMany({
    where: { supplierId, reversedAt: null },
    orderBy: { date: 'desc' },
    ...(options.skip !== undefined || options.take !== undefined
      ? {
          skip: options.skip,
          take: options.take,
        }
      : {}),
    select: {
      id: true,
      orderNo: true,
      date: true,
      warehouse: { select: { name: true } },
      handlerName: true,
      supplier: { select: { name: true } },
      totalAmount: true,
      freight: true,
      note: true,
      items: {
        select: {
          weight: true,
          price: true,
          amount: true,
          packages: true,
          variant: {
            select: {
              spec: true,
              color: true,
              unit: true,
              yarn: { select: { name: true } },
            },
          },
          batch: { select: { batchNo: true } },
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
  const [orderTotals, saleOrders, saleItems, saleMovements] = await Promise.all([
    db.saleOrder.aggregate({
      where: { reversedAt: null },
      _sum: { totalAmount: true, freight: true },
    }),
    db.saleOrder.findMany({ where: { reversedAt: null }, select: { id: true } }),
    db.saleItem.findMany({
      where: { order: { reversedAt: null } },
      select: { id: true, weight: true, unitCost: true, unitFreight: true },
    }),
    db.stockMovement.findMany({
      where: { type: 'SALE', referenceType: 'SALE' },
      select: { referenceId: true, referenceItemId: true, goodsCost: true, freightCost: true },
    }),
  ])
  const orderIds = new Set(saleOrders.map((order) => order.id))
  const movementByItem = new Map<string, { goodsCost: Prisma.Decimal; freightCost: Prisma.Decimal }[]>()
  for (const movement of saleMovements) {
    if (!movement.referenceItemId || !orderIds.has(movement.referenceId)) continue
    const rows = movementByItem.get(movement.referenceItemId) ?? []
    rows.push(movement)
    movementByItem.set(movement.referenceItemId, rows)
  }
  let saleGoodsTotal = orderTotals._sum.totalAmount ?? new Prisma.Decimal(0)
  let saleFreightTotal = orderTotals._sum.freight ?? new Prisma.Decimal(0)
  let estimatedCost = new Prisma.Decimal(0)
  let estimatedFreight = new Prisma.Decimal(0)
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
