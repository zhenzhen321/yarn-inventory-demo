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

    const freightArr = allocateFreight(order.items, order.freight)
    const groups = new Map<
      string,
      {
        variantId: string
        batchId: string
        weight: Prisma.Decimal
        cost: Prisma.Decimal
        freight: Prisma.Decimal
        inventoryId?: string
      }
    >()
    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i]
      const key = `${item.variantId}|${item.batchId}`
      const group = groups.get(key) ?? {
        variantId: item.variantId,
        batchId: item.batchId,
        weight: new Prisma.Decimal(0),
        cost: new Prisma.Decimal(0),
        freight: new Prisma.Decimal(0),
      }
      group.weight = group.weight.plus(item.weight)
      group.cost = group.cost.plus(item.amount)
      group.freight = group.freight.plus(freightArr[i])
      groups.set(key, group)
    }

    for (const group of groups.values()) {
      const row = await tx.inventory.findFirst({
        where: {
          warehouseId: order.warehouseId,
          variantId: group.variantId,
          batchId: group.batchId,
          processingFeeSettled: false,
          archived: false,
        },
      })
      if (!row) throw new Error(`库存记录不存在：变体 ${group.variantId} 批次 ${group.batchId}`)
      if (row.weight.lessThan(group.weight)) throw new Error('该批货已被卖出/调走，无法撤回')
      group.inventoryId = row.id
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

    await tx.purchaseItem.deleteMany({ where: { orderId: order.id } })
    await tx.purchaseOrder.delete({ where: { id: order.id } })
    for (const group of groups.values()) {
      await tx.inventory.update({
        where: { id: group.inventoryId! },
        data: {
          weight: { decrement: group.weight },
          cost: { decrement: group.cost },
          freight: { decrement: group.freight },
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
      const source = await tx.inventory.findUnique({ where: { id: it.inventoryId } })
      if (!source) throw new Error(`原库存记录不存在：${it.inventoryId}`)
      let targetId = source.id
      if (source.archived) {
        const active = await tx.inventory.findFirst({
          where: {
            id: { not: source.id },
            warehouseId: source.warehouseId,
            variantId: source.variantId,
            batchId: source.batchId,
            processingFeeSettled: source.processingFeeSettled,
            archived: false,
          },
        })
        if (active) {
          targetId = active.id
        } else {
          await tx.inventory.update({
            where: { id: source.id },
            data: { archived: false },
          })
        }
      }
      await tx.inventory.update({
        where: { id: targetId },
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
