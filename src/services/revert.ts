import { Prisma, PrismaClient } from '@prisma/client'

// 按重量比例分摊运费（末条补差，与 updatePurchaseFreight 同算法）
function allocateFreight(
  items: { weight: Prisma.Decimal }[],
  freight: Prisma.Decimal,
): Prisma.Decimal[] {
  const totalWeight = items.reduce((s, it) => s.plus(it.weight), new Prisma.Decimal(0))
  if (totalWeight.lessThanOrEqualTo(0)) throw new Error('买入单没有有效重量')
  const arr = items.map((it) => freight.mul(it.weight).div(totalWeight).toDecimalPlaces(2))
  const sum = arr.reduce((s, v) => s.plus(v), new Prisma.Decimal(0))
  arr[arr.length - 1] = arr[arr.length - 1].plus(freight.minus(sum))
  return arr
}

export async function revertSettlement(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    const s = await tx.settlement.findUnique({ where: { id }, include: { counterparty: true } })
    if (!s) throw new Error('结算记录不存在')
    await tx.settlement.delete({ where: { id } })
    return s
  })
}

export async function revertPurchase(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true, supplier: true },
    })
    if (!order) throw new Error('买入单不存在')
    for (const it of order.items) {
      const row = await tx.inventory.findFirst({
        where: {
          warehouseId: order.warehouseId,
          variantId: it.variantId,
          batchId: it.batchId,
          processingFeeSettled: false,
          archived: false,
        },
      })
      if (!row) throw new Error(`库存记录不存在：变体 ${it.variantId} 批次 ${it.batchId}`)
      if (row.weight.lessThan(it.weight)) throw new Error('该批货已被卖出/调走，无法撤回')
    }
    const newTotal =
      (
        await tx.purchaseOrder.aggregate({
          where: { supplierId: order.supplierId },
          _sum: { totalAmount: true },
        })
      )._sum.totalAmount ?? new Prisma.Decimal(0)
    const settled =
      (
        await tx.settlement.aggregate({
          where: { side: 'PURCHASE', counterpartyId: order.supplierId },
          _sum: { amount: true },
        })
      )._sum.amount ?? new Prisma.Decimal(0)
    if (settled.greaterThan(newTotal.minus(order.totalAmount))) {
      throw new Error('撤回后该供应商已付超过应付，无法撤回')
    }
    const freightArr = allocateFreight(order.items, order.freight)
    await tx.purchaseItem.deleteMany({ where: { orderId: order.id } })
    await tx.purchaseOrder.delete({ where: { id: order.id } })
    for (let i = 0; i < order.items.length; i++) {
      const it = order.items[i]
      await tx.inventory.updateMany({
        where: {
          warehouseId: order.warehouseId,
          variantId: it.variantId,
          batchId: it.batchId,
          processingFeeSettled: false,
        },
        data: {
          weight: { decrement: it.weight },
          cost: { decrement: it.amount },
          freight: { decrement: freightArr[i] },
        },
      })
    }
    return order
  })
}

export async function revertSale(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUnique({
      where: { id },
      include: { items: true, customer: true },
    })
    if (!order) throw new Error('卖出单不存在')
    const newTotal =
      (
        await tx.saleOrder.aggregate({
          where: { customerId: order.customerId },
          _sum: { totalAmount: true },
        })
      )._sum.totalAmount ?? new Prisma.Decimal(0)
    const settled =
      (
        await tx.settlement.aggregate({
          where: { side: 'SALE', counterpartyId: order.customerId },
          _sum: { amount: true },
        })
      )._sum.amount ?? new Prisma.Decimal(0)
    if (settled.greaterThan(newTotal.minus(order.totalAmount))) {
      throw new Error('撤回后该客户已收超过应收，无法撤回')
    }
    await tx.saleItem.deleteMany({ where: { orderId: order.id } })
    await tx.saleOrder.delete({ where: { id: order.id } })
    for (const it of order.items) {
      await tx.inventory.update({
        where: { id: it.inventoryId },
        data: {
          weight: { increment: it.weight },
          cost: { increment: new Prisma.Decimal(it.weight).mul(it.unitCost).toDecimalPlaces(2) },
          freight: {
            increment: new Prisma.Decimal(it.weight).mul(it.unitFreight).toDecimalPlaces(2),
          },
        },
      })
    }
    return order
  })
}
