import { PrismaClient } from '@prisma/client'

export async function deleteWarehouseSafe(db: PrismaClient, id: string) {
  const [
    purchases,
    sales,
    transfersFrom,
    transfersTo,
    stocktakes,
    inventories,
    feeSettlements,
    feePayments,
  ] = await Promise.all([
    db.purchaseOrder.count({ where: { warehouseId: id } }),
    db.saleOrder.count({ where: { warehouseId: id } }),
    db.transferOrder.count({ where: { fromWarehouseId: id } }),
    db.transferOrder.count({ where: { toWarehouseId: id } }),
    db.stocktake.count({ where: { warehouseId: id } }),
    db.inventory.count({ where: { warehouseId: id } }),
    db.processingFeeSettlement.count({ where: { warehouseId: id } }),
    db.processingFeePayment.count({ where: { factoryId: id } }),
  ])
  const total =
    purchases +
    sales +
    transfersFrom +
    transfersTo +
    stocktakes +
    inventories +
    feeSettlements +
    feePayments
  if (total > 0) {
    throw new Error(
      `该仓库已被使用（买入单 ${purchases}、卖出单 ${sales}、调拨 ${transfersFrom + transfersTo}、盘库 ${stocktakes}、库存 ${inventories}、加工费结算 ${feeSettlements}、加工费付款 ${feePayments}），不能删除`,
    )
  }
  return db.warehouse.delete({ where: { id } })
}

export async function deleteCounterpartySafe(db: PrismaClient, id: string) {
  const [purchases, sales] = await Promise.all([
    db.purchaseOrder.count({ where: { supplierId: id } }),
    db.saleOrder.count({ where: { customerId: id } }),
  ])
  if (purchases + sales > 0) {
    throw new Error(`该往来单位已被使用（买入单 ${purchases}、卖出单 ${sales}），不能删除`)
  }
  return db.counterparty.delete({ where: { id } })
}

export async function yarnVariantUsage(db: PrismaClient, id: string): Promise<number> {
  const [purchaseItems, inventories, processingReturns, feeSettlements] = await Promise.all([
    db.purchaseItem.count({ where: { variantId: id } }),
    db.inventory.count({ where: { variantId: id } }),
    db.processingReturnItem.count({ where: { variantId: id } }),
    db.processingFeeSettlement.count({ where: { variantId: id } }),
  ])
  return purchaseItems + inventories + processingReturns + feeSettlements
}

export async function deleteYarnVariantSafe(db: PrismaClient, id: string) {
  const usage = await yarnVariantUsage(db, id)
  if (usage > 0) throw new Error(`该纱线变体已被使用（${usage} 处），不能删除`)
  await db.batch.deleteMany({ where: { variantId: id } })
  return db.yarnVariant.delete({ where: { id } })
}

export async function deleteYarnSafe(db: PrismaClient, id: string) {
  const yarn = await db.yarn.findUnique({ where: { id }, include: { variants: true } })
  if (!yarn) throw new Error('记录不存在')
  for (const v of yarn.variants) {
    const usage = await yarnVariantUsage(db, v.id)
    if (usage > 0) {
      throw new Error(
        `纱线“${yarn.name}”的变体（${v.spec} ${v.color}）已被业务使用（${usage} 处），不能删除`,
      )
    }
  }
  await db.batch.deleteMany({ where: { variant: { yarnId: id } } })
  await db.yarnVariant.deleteMany({ where: { yarnId: id } })
  return db.yarn.delete({ where: { id } })
}
