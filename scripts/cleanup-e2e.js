// 只清理 E2E 前缀的测试数据，不触碰演示数据
// 用法：node scripts/cleanup-e2e.js（在项目根目录下执行）
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

;(async () => {
  const warehouses = await p.warehouse.findMany({
    where: { name: { startsWith: 'E2E' } },
    select: { id: true },
  })
  const counterparties = await p.counterparty.findMany({
    where: { name: { startsWith: 'E2E' } },
    select: { id: true },
  })
  const yarns = await p.yarn.findMany({
    where: { name: { startsWith: 'E2E' } },
    select: { id: true },
  })
  const whIds = warehouses.map((x) => x.id)
  const cpIds = counterparties.map((x) => x.id)
  const yarnIds = yarns.map((x) => x.id)
  const variants = await p.yarnVariant.findMany({
    where: { yarnId: { in: yarnIds } },
    select: { id: true },
  })
  const variantIds = variants.map((x) => x.id)
  const batches = await p.batch.findMany({
    where: { variantId: { in: variantIds } },
    select: { id: true },
  })
  const batchIds = batches.map((x) => x.id)
  const purchases = await p.purchaseOrder.findMany({
    where: { OR: [{ supplierId: { in: cpIds } }, { warehouseId: { in: whIds } }] },
    select: { id: true },
  })
  const sales = await p.saleOrder.findMany({
    where: { OR: [{ customerId: { in: cpIds } }, { warehouseId: { in: whIds } }] },
    select: { id: true },
  })
  const transfers = await p.transferOrder.findMany({
    where: { OR: [{ fromWarehouseId: { in: whIds } }, { toWarehouseId: { in: whIds } }] },
    select: { id: true },
  })
  const stocktakes = await p.stocktake.findMany({
    where: { warehouseId: { in: whIds } },
    select: { id: true },
  })
  const returns = await p.processingReturn.findMany({
    where: { OR: [{ factoryId: { in: whIds } }, { warehouseId: { in: whIds } }] },
    select: { id: true },
  })
  const purchaseIds = purchases.map((x) => x.id)
  const saleIds = sales.map((x) => x.id)
  const transferIds = transfers.map((x) => x.id)
  const stocktakeIds = stocktakes.map((x) => x.id)
  const returnIds = returns.map((x) => x.id)

  await p.settlement.deleteMany({ where: { counterpartyId: { in: cpIds } } })
  await p.stocktakeItem.deleteMany({ where: { stocktakeId: { in: stocktakeIds } } })
  await p.transferItem.deleteMany({ where: { orderId: { in: transferIds } } })
  await p.saleItem.deleteMany({ where: { orderId: { in: saleIds } } })
  await p.purchaseItem.deleteMany({ where: { orderId: { in: purchaseIds } } })
  await p.processingReturnItem.deleteMany({ where: { orderId: { in: returnIds } } })
  await p.stocktake.deleteMany({ where: { id: { in: stocktakeIds } } })
  await p.transferOrder.deleteMany({ where: { id: { in: transferIds } } })
  await p.saleOrder.deleteMany({ where: { id: { in: saleIds } } })
  await p.purchaseOrder.deleteMany({ where: { id: { in: purchaseIds } } })
  await p.processingReturn.deleteMany({ where: { id: { in: returnIds } } })
  await p.processingFeePayment.deleteMany({ where: { factoryId: { in: whIds } } })
  await p.processingFeeSettlement.deleteMany({
    where: { OR: [{ warehouseId: { in: whIds } }, { variantId: { in: variantIds } }] },
  })
  await p.inventory.deleteMany({
    where: { OR: [{ variantId: { in: variantIds } }, { warehouseId: { in: whIds } }] },
  })
  await p.batch.deleteMany({ where: { id: { in: batchIds } } })
  await p.yarnVariant.deleteMany({ where: { id: { in: variantIds } } })
  await p.yarn.deleteMany({ where: { id: { in: yarnIds } } })
  await p.counterparty.deleteMany({ where: { id: { in: cpIds } } })
  await p.warehouse.deleteMany({ where: { id: { in: whIds } } })
  await p.auditLog.deleteMany({ where: { detail: { contains: 'E2E' } } })

  const counts = {
    purchase: await p.purchaseOrder.count(),
    sale: await p.saleOrder.count(),
    warehouse: await p.warehouse.count(),
    counterparty: await p.counterparty.count(),
    yarn: await p.yarn.count(),
    inventory: await p.inventory.count(),
  }
  console.log('E2E 测试数据已清理，剩余业务数据计数:', JSON.stringify(counts))
})().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => p.$disconnect())
