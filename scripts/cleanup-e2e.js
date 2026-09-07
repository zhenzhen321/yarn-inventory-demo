// 只清理 E2E 前缀的测试数据，保留其他演示数据。
// 用法：node scripts/cleanup-e2e.js（在项目目录下执行）
const { PrismaClient } = require('@prisma/client')

async function cleanupE2EData(db) {
  return db.$transaction(async (p) => {
    const [warehouses, counterparties, yarns] = await Promise.all([
      p.warehouse.findMany({
        where: { name: { startsWith: 'E2E' } },
        select: { id: true },
      }),
      p.counterparty.findMany({
        where: { name: { startsWith: 'E2E' } },
        select: { id: true },
      }),
      p.yarn.findMany({
        where: { name: { startsWith: 'E2E' } },
        select: { id: true },
      }),
    ])
    const whIds = warehouses.map((row) => row.id)
    const cpIds = counterparties.map((row) => row.id)
    const yarnIds = yarns.map((row) => row.id)
    const variants = await p.yarnVariant.findMany({
      where: { yarnId: { in: yarnIds } },
      select: { id: true },
    })
    const variantIds = variants.map((row) => row.id)
    const batches = await p.batch.findMany({
      where: { variantId: { in: variantIds } },
      select: { id: true },
    })
    const batchIds = batches.map((row) => row.id)
    const lots = await p.inventoryLot.findMany({
      where: {
        OR: [
          { variantId: { in: variantIds } },
          { inventories: { some: { warehouseId: { in: whIds } } } },
        ],
      },
      select: { id: true },
    })
    const lotIds = lots.map((row) => row.id)
    const inventories = await p.inventory.findMany({
      where: {
        OR: [
          { variantId: { in: variantIds } },
          { warehouseId: { in: whIds } },
          { lotId: { in: lotIds } },
        ],
      },
      select: { id: true },
    })
    const inventoryIds = inventories.map((row) => row.id)
    const [purchases, sales, transfers, stocktakes, returns, jobs] = await Promise.all([
      p.purchaseOrder.findMany({
        where: { OR: [{ supplierId: { in: cpIds } }, { warehouseId: { in: whIds } }] },
        select: { id: true },
      }),
      p.saleOrder.findMany({
        where: { OR: [{ customerId: { in: cpIds } }, { warehouseId: { in: whIds } }] },
        select: { id: true },
      }),
      p.transferOrder.findMany({
        where: { OR: [{ fromWarehouseId: { in: whIds } }, { toWarehouseId: { in: whIds } }] },
        select: { id: true },
      }),
      p.stocktake.findMany({
        where: { warehouseId: { in: whIds } },
        select: { id: true },
      }),
      p.processingReturn.findMany({
        where: { OR: [{ factoryId: { in: whIds } }, { warehouseId: { in: whIds } }] },
        select: { id: true },
      }),
      p.processingJob.findMany({
        where: {
          OR: [
            { factoryId: { in: whIds } },
            { inputs: { some: { lotId: { in: lotIds } } } },
            { outputs: { some: { lotId: { in: lotIds } } } },
          ],
        },
        select: { id: true },
      }),
    ])
    const purchaseIds = purchases.map((row) => row.id)
    const saleIds = sales.map((row) => row.id)
    const transferIds = transfers.map((row) => row.id)
    const stocktakeIds = stocktakes.map((row) => row.id)
    const returnIds = returns.map((row) => row.id)
    const jobIds = jobs.map((row) => row.id)
    const referenceIds = [
      ...purchaseIds,
      ...saleIds,
      ...transferIds,
      ...stocktakeIds,
      ...returnIds,
      ...jobIds,
    ]

    await p.settlement.deleteMany({ where: { counterpartyId: { in: cpIds } } })
    await p.saleAllocation.deleteMany({
      where: {
        OR: [
          { saleItem: { orderId: { in: saleIds } } },
          { lotId: { in: lotIds } },
          { inventoryId: { in: inventoryIds } },
          { warehouseId: { in: whIds } },
        ],
      },
    })
    await p.stockMovement.deleteMany({
      where: {
        OR: [
          { lotId: { in: lotIds } },
          { referenceId: { in: referenceIds } },
          { fromWarehouseId: { in: whIds } },
          { toWarehouseId: { in: whIds } },
        ],
      },
    })
    await p.processingInput.deleteMany({
      where: {
        OR: [
          { jobId: { in: jobIds } },
          { lotId: { in: lotIds } },
          { inventoryId: { in: inventoryIds } },
        ],
      },
    })
    await p.processingOutput.deleteMany({
      where: { OR: [{ jobId: { in: jobIds } }, { lotId: { in: lotIds } }] },
    })
    await p.processingFeeSettlement.deleteMany({
      where: {
        OR: [
          { warehouseId: { in: whIds } },
          { variantId: { in: variantIds } },
          { processingJobId: { in: jobIds } },
        ],
      },
    })
    await p.processingFeePayment.deleteMany({ where: { factoryId: { in: whIds } } })
    await p.stocktakeItem.deleteMany({ where: { stocktakeId: { in: stocktakeIds } } })
    await p.transferItem.deleteMany({ where: { orderId: { in: transferIds } } })
    await p.saleItem.deleteMany({ where: { orderId: { in: saleIds } } })
    await p.purchaseItem.deleteMany({ where: { orderId: { in: purchaseIds } } })
    await p.processingReturnItem.deleteMany({ where: { orderId: { in: returnIds } } })
    await p.processingJob.deleteMany({ where: { id: { in: jobIds } } })
    await p.stocktake.deleteMany({ where: { id: { in: stocktakeIds } } })
    await p.transferOrder.deleteMany({ where: { id: { in: transferIds } } })
    await p.saleOrder.deleteMany({ where: { id: { in: saleIds } } })
    await p.purchaseOrder.deleteMany({ where: { id: { in: purchaseIds } } })
    await p.processingReturn.deleteMany({ where: { id: { in: returnIds } } })
    await p.inventory.deleteMany({ where: { id: { in: inventoryIds } } })
    await p.inventoryLot.deleteMany({ where: { id: { in: lotIds } } })
    await p.batch.deleteMany({ where: { id: { in: batchIds } } })
    await p.yarnVariant.deleteMany({ where: { id: { in: variantIds } } })
    await p.yarn.deleteMany({ where: { id: { in: yarnIds } } })
    await p.counterparty.deleteMany({ where: { id: { in: cpIds } } })
    await p.warehouse.deleteMany({ where: { id: { in: whIds } } })
    await p.auditLog.deleteMany({ where: { detail: { contains: 'E2E' } } })
    await p.idempotencyRequest.deleteMany({ where: { key: { startsWith: 'e2e-' } } })

    return {
      purchase: await p.purchaseOrder.count(),
      sale: await p.saleOrder.count(),
      warehouse: await p.warehouse.count(),
      counterparty: await p.counterparty.count(),
      yarn: await p.yarn.count(),
      inventory: await p.inventory.count(),
    }
  })
}

if (require.main === module) {
  const p = new PrismaClient()
  cleanupE2EData(p)
    .then((counts) => {
      console.log('E2E 测试数据已清理，剩余业务数据计数:', JSON.stringify(counts))
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(() => p.$disconnect())
}

module.exports = { cleanupE2EData }
