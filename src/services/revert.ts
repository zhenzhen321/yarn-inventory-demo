import { Prisma, PrismaClient } from '@prisma/client'
import { allocateAmountByWeight } from '@/lib/money'
import { businessDateFromInput, businessDateToday } from '@/lib/business-date'
import {
  ensureInventoryLot,
  recordMovement,
  refreshLotStatus,
  subtractFromBalance,
} from './lots'

export async function revertSettlement(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    const settlement = await tx.settlement.findUnique({
      where: { id },
      include: { counterparty: true },
    })
    if (!settlement) throw new Error('结算记录不存在')
    await tx.settlement.delete({ where: { id } })
    return settlement
  })
}

export async function revertPurchase(db: PrismaClient, id: string, revertedBy = '未知') {
  return db.$transaction(async (tx) => {
    const reversalDate = businessDateFromInput(businessDateToday())
    const order = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true, supplier: true },
    })
    if (!order) throw new Error('买入单不存在')
    if (order.reversedAt) throw new Error('该买入单已经撤回')

    const activeTotal =
      (
        await tx.purchaseOrder.aggregate({
          where: { supplierId: order.supplierId, reversedAt: null },
          _sum: { totalAmount: true },
        })
      )._sum.totalAmount ?? new Prisma.Decimal(0)
    const paid =
      (
        await tx.settlement.aggregate({
          where: { side: 'PURCHASE', counterpartyId: order.supplierId },
          _sum: { amount: true },
        })
      )._sum.amount ?? new Prisma.Decimal(0)
    if (paid.greaterThan(activeTotal.minus(order.totalAmount))) {
      throw new Error('撤回后该供应商已付超过应付，无法撤回')
    }

    const freight = allocateAmountByWeight(
      order.items.map((item) => item.weight),
      order.freight,
    )
    const exactItems = order.items.filter((item) => item.lotId)
    for (let index = 0; index < exactItems.length; index++) {
      const item = exactItems[index]
      const originalIndex = order.items.findIndex((candidate) => candidate.id === item.id)
      const [row, laterMovements, receipt] = await Promise.all([
        tx.inventory.findFirst({
          where: { lotId: item.lotId!, warehouseId: order.warehouseId, archived: false },
        }),
        tx.stockMovement.count({
          where: {
            lotId: item.lotId!,
            NOT: {
              type: 'PURCHASE_RECEIPT',
              referenceId: order.id,
              referenceItemId: item.id,
            },
          },
        }),
        tx.stockMovement.findFirst({
          where: {
            lotId: item.lotId!,
            type: 'PURCHASE_RECEIPT',
            referenceId: order.id,
            referenceItemId: item.id,
          },
        }),
      ])
      if (
        !row ||
        laterMovements > 0 ||
        !row.weight.equals(item.weight) ||
        !row.cost.equals(item.amount)
      ) {
        throw new Error('该批货已被卖出、调拨、加工或盘点，无法撤回')
      }
      await subtractFromBalance(tx, row, item.weight, item.packages)
      await tx.inventory.update({ where: { id: row.id }, data: { archived: true } })
      await tx.inventoryLot.update({
        where: { id: item.lotId! },
        data: { status: 'ARCHIVED' },
      })
      await recordMovement(tx, {
        lotId: item.lotId!,
        type: 'REVERSAL',
        referenceType: 'PURCHASE_REVERSAL',
        referenceId: order.id,
        referenceItemId: item.id,
        fromWarehouseId: order.warehouseId,
        weight: item.weight,
        packages: item.packages,
        goodsCost: item.amount,
        freightCost: freight[originalIndex],
        reversalOfId: receipt?.id,
        occurredAt: reversalDate,
      })
    }

    const legacyItems = order.items.filter((item) => !item.lotId)
    const groups = new Map<
      string,
      {
        variantId: string
        batchId: string
        weight: Prisma.Decimal
        cost: Prisma.Decimal
        freight: Prisma.Decimal
        packages: number | null
      }
    >()
    for (const item of legacyItems) {
      const index = order.items.findIndex((candidate) => candidate.id === item.id)
      const key = `${item.variantId}|${item.batchId}`
      const group = groups.get(key) ?? {
        variantId: item.variantId,
        batchId: item.batchId,
        weight: new Prisma.Decimal(0),
        cost: new Prisma.Decimal(0),
        freight: new Prisma.Decimal(0),
        packages: 0,
      }
      group.weight = group.weight.plus(item.weight)
      group.cost = group.cost.plus(item.amount)
      group.freight = group.freight.plus(freight[index])
      group.packages =
        group.packages === null || item.packages === null
          ? null
          : group.packages + item.packages
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
      if (!row || row.weight.lessThan(group.weight)) {
        throw new Error('该历史汇总批次已被卖出或调走，无法撤回')
      }
      const lot = await ensureInventoryLot(tx, row)
      await subtractFromBalance(tx, row, group.weight, group.packages)
      await recordMovement(tx, {
        lotId: lot.id,
        type: 'REVERSAL',
        referenceType: 'PURCHASE_REVERSAL',
        referenceId: order.id,
        fromWarehouseId: order.warehouseId,
        weight: group.weight,
        packages: group.packages,
        goodsCost: group.cost,
        freightCost: group.freight,
        occurredAt: reversalDate,
      })
      await refreshLotStatus(tx, lot.id)
    }

    return tx.purchaseOrder.update({
      where: { id: order.id },
      data: { reversedAt: new Date(), reversedBy: revertedBy },
      include: { items: true, supplier: true },
    })
  })
}

export async function revertSale(db: PrismaClient, id: string, revertedBy = '未知') {
  return db.$transaction(async (tx) => {
    const reversalDate = businessDateFromInput(businessDateToday())
    const order = await tx.saleOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        items: { include: { allocations: true } },
      },
    })
    if (!order) throw new Error('卖出单不存在')
    if (order.reversedAt) throw new Error('该卖出单已经撤回')

    const activeTotal =
      (
        await tx.saleOrder.aggregate({
          where: { customerId: order.customerId, reversedAt: null },
          _sum: { totalAmount: true },
        })
      )._sum.totalAmount ?? new Prisma.Decimal(0)
    const received =
      (
        await tx.settlement.aggregate({
          where: { side: 'SALE', counterpartyId: order.customerId },
          _sum: { amount: true },
        })
      )._sum.amount ?? new Prisma.Decimal(0)
    if (received.greaterThan(activeTotal.minus(order.totalAmount))) {
      throw new Error('撤回后该客户已收超过应收，无法撤回')
    }

    for (const item of order.items) {
      if (item.allocations.length > 0) {
        for (const allocation of item.allocations) {
          const source = allocation.inventoryId
            ? await tx.inventory.findUnique({ where: { id: allocation.inventoryId } })
            : null
          if (!source) throw new Error(`原库存记录不存在：${allocation.inventoryId ?? '-'}`)
          const target =
            (await tx.inventory.findFirst({
              where: {
                lotId: allocation.lotId,
                warehouseId: allocation.warehouseId,
                processingFeeSettled: source.processingFeeSettled,
                archived: false,
              },
            })) ?? source
          const originalMovement = await tx.stockMovement.findFirst({
            where: {
              lotId: allocation.lotId,
              type: 'SALE',
              referenceId: order.id,
              referenceItemId: item.id,
            },
          })
          const restoredCost =
            originalMovement?.goodsCost ??
            allocation.weight.mul(allocation.unitCost).toDecimalPlaces(2)
          const restoredFreight =
            originalMovement?.freightCost ??
            allocation.weight.mul(allocation.unitFreight).toDecimalPlaces(2)
          await tx.inventory.update({
            where: { id: target.id },
            data: {
              archived: false,
              weight: target.weight.plus(allocation.weight).toDecimalPlaces(2),
              packages:
                allocation.packages === null
                  ? target.packages
                  : (target.packages ?? 0) + allocation.packages,
              cost: target.cost.plus(restoredCost).toDecimalPlaces(2),
              freight: target.freight.plus(restoredFreight).toDecimalPlaces(2),
              version: { increment: 1 },
            },
          })
          await tx.inventoryLot.update({
            where: { id: allocation.lotId },
            data: { status: 'AVAILABLE' },
          })
          await recordMovement(tx, {
            lotId: allocation.lotId,
            type: 'REVERSAL',
            referenceType: 'SALE_REVERSAL',
            referenceId: order.id,
            referenceItemId: item.id,
            toWarehouseId: allocation.warehouseId,
            weight: allocation.weight,
            packages: allocation.packages,
            goodsCost: restoredCost,
            freightCost: restoredFreight,
            reversalOfId: originalMovement?.id,
            occurredAt: reversalDate,
          })
        }
        continue
      }

      const source = await tx.inventory.findUnique({ where: { id: item.inventoryId } })
      if (!source) throw new Error(`原库存记录不存在：${item.inventoryId}`)
      const lot = await ensureInventoryLot(tx, source)
      const target =
        (await tx.inventory.findFirst({
          where: {
            lotId: lot.id,
            warehouseId: source.warehouseId,
            processingFeeSettled: source.processingFeeSettled,
            archived: false,
          },
        })) ?? source
      const restoredCost = item.weight.mul(item.unitCost).toDecimalPlaces(2)
      const restoredFreight = item.weight.mul(item.unitFreight).toDecimalPlaces(2)
      await tx.inventory.update({
        where: { id: target.id },
        data: {
          archived: false,
          weight: target.weight.plus(item.weight).toDecimalPlaces(2),
          packages:
            item.packages === null ? target.packages : (target.packages ?? 0) + item.packages,
          cost: target.cost.plus(restoredCost).toDecimalPlaces(2),
          freight: target.freight.plus(restoredFreight).toDecimalPlaces(2),
          version: { increment: 1 },
        },
      })
      await tx.inventoryLot.update({ where: { id: lot.id }, data: { status: 'AVAILABLE' } })
      await recordMovement(tx, {
        lotId: lot.id,
        type: 'REVERSAL',
        referenceType: 'SALE_REVERSAL',
        referenceId: order.id,
        referenceItemId: item.id,
        toWarehouseId: source.warehouseId,
        weight: item.weight,
        packages: item.packages,
        goodsCost: restoredCost,
        freightCost: restoredFreight,
        occurredAt: reversalDate,
      })
    }

    return tx.saleOrder.update({
      where: { id: order.id },
      data: { reversedAt: new Date(), reversedBy: revertedBy },
      include: { items: true, customer: true },
    })
  })
}
