import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/auth'
import {
  createPurchase,
  createSale,
  createTransfer,
  createStocktake,
  settleProcessingFee,
  createProcessingReturn,
} from '../src/services/inventory'
import { createSettlement } from '../src/services/settlement'

const prisma = new PrismaClient()

const ADMIN_PASSWORD = 'demo123456'
const CLERK_PASSWORD = 'demo123456'

function day(iso: string): Date {
  return new Date(`${iso}T09:00:00+08:00`)
}

// 按外键依赖顺序清空业务数据，保证种子脚本可重复执行
async function clearAll() {
  await prisma.processingFeePayment.deleteMany()
  await prisma.processingFeeSettlement.deleteMany()
  await prisma.settlement.deleteMany()
  await prisma.processingReturnItem.deleteMany()
  await prisma.processingReturn.deleteMany()
  await prisma.stocktakeItem.deleteMany()
  await prisma.stocktake.deleteMany()
  await prisma.saleItem.deleteMany()
  await prisma.saleOrder.deleteMany()
  await prisma.transferItem.deleteMany()
  await prisma.transferOrder.deleteMany()
  await prisma.purchaseItem.deleteMany()
  await prisma.purchaseOrder.deleteMany()
  await prisma.inventory.deleteMany()
  await prisma.batch.deleteMany()
  await prisma.yarnVariant.deleteMany()
  await prisma.yarn.deleteMany()
  await prisma.warehouse.deleteMany()
  await prisma.counterparty.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany()
}

async function findInv(batchNo: string, warehouseId: string) {
  const row = await prisma.inventory.findFirst({
    where: { batch: { batchNo }, warehouseId, archived: false },
  })
  if (!row) throw new Error(`演示数据生成失败：找不到库存 ${batchNo} @ ${warehouseId}`)
  return row
}

async function log(userId: string | null, userName: string, action: string, target: string, detail?: string) {
  await prisma.auditLog.create({ data: { userId, userName, action, target, detail } })
}

async function main() {
  await clearAll()

  // ---------- 账号 ----------
  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      name: 'admin',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      role: 'OWNER',
    },
  })
  const clerk = await prisma.user.create({
    data: {
      username: 'clerk',
      name: 'clerk',
      passwordHash: await hashPassword(CLERK_PASSWORD),
      role: 'OWNER',
    },
  })

  // ---------- 基础档案 ----------
  const whMain = await prisma.warehouse.create({
    data: { name: '华东仓', type: 'WAREHOUSE', manager: '张伟', stocktakeIntervalDays: 30 },
  })
  const whWest = await prisma.warehouse.create({
    data: { name: '城西仓', type: 'WAREHOUSE', manager: '李娜', stocktakeIntervalDays: 30 },
  })
  const factory = await prisma.warehouse.create({
    data: { name: '城南加工厂', type: 'FACTORY', manager: '王强', stocktakeIntervalDays: 30 },
  })

  const supplier = await prisma.counterparty.create({
    data: { name: '江南纺织原料有限公司', type: 'SUPPLIER', contact: '陈经理', phone: '13800000001' },
  })
  const customer = await prisma.counterparty.create({
    data: { name: '沪上织造有限公司', type: 'CUSTOMER', contact: '刘总', phone: '13800000002' },
  })
  const both = await prisma.counterparty.create({
    data: { name: '义乌针织经销部', type: 'BOTH', contact: '赵经理', phone: '13800000003' },
  })

  const cotton = await prisma.yarn.create({ data: { name: '纯棉纱', note: '32支/40支现货' } })
  const poly = await prisma.yarn.create({ data: { name: '涤棉纱', note: 'T/C 65/35' } })
  const acrylic = await prisma.yarn.create({ data: { name: '腈纶纱', note: '秋冬备货' } })

  const vCottonWhite = await prisma.yarnVariant.create({
    data: { yarnId: cotton.id, spec: '32支', color: '本白', unit: 'kg' },
  })
  const vCottonBleach = await prisma.yarnVariant.create({
    data: { yarnId: cotton.id, spec: '32支', color: '漂白', unit: 'kg' },
  })
  const vCotton40 = await prisma.yarnVariant.create({
    data: { yarnId: cotton.id, spec: '40支', color: '本白', unit: 'kg' },
  })
  const vPoly = await prisma.yarnVariant.create({
    data: { yarnId: poly.id, spec: '32支', color: '浅灰', unit: 'kg' },
  })
  const vAcrylic = await prisma.yarnVariant.create({
    data: { yarnId: acrylic.id, spec: '28支', color: '米白', unit: 'kg' },
  })

  // ---------- 买入 ----------
  const po1 = await createPurchase(prisma, {
    date: day('2026-08-03'),
    supplierId: supplier.id,
    warehouseId: whMain.id,
    handlerName: 'admin',
    note: '夏季补货',
    freight: 300,
    items: [{ variantId: vCottonWhite.id, batchNo: 'C20260801', weight: 1000, price: 21.5, packages: 40 }],
  })
  await log(admin.id, 'admin', '买入入库', po1.orderNo, '纯棉纱 32支/本白 1000kg @21.5 运费300')

  const po2 = await createPurchase(prisma, {
    date: day('2026-08-05'),
    supplierId: supplier.id,
    warehouseId: whMain.id,
    handlerName: 'admin',
    note: 'T/C 订单备货',
    freight: 200,
    items: [{ variantId: vPoly.id, batchNo: 'TC20260805', weight: 800, price: 18.8, packages: 32 }],
  })
  await log(admin.id, 'admin', '买入入库', po2.orderNo, '涤棉纱 32支/浅灰 800kg @18.8 运费200')

  const po3 = await createPurchase(prisma, {
    date: day('2026-08-06'),
    supplierId: both.id,
    warehouseId: whWest.id,
    handlerName: 'clerk',
    note: '秋冬备货',
    freight: 100,
    items: [{ variantId: vAcrylic.id, batchNo: 'J20260806', weight: 500, price: 15.2, packages: 20 }],
  })
  await log(clerk.id, 'clerk', '买入入库', po3.orderNo, '腈纶纱 28支/米白 500kg @15.2 运费100')

  // ---------- 卖出 ----------
  const invCottonMain = await findInv('C20260801', whMain.id)
  const so1 = await createSale(prisma, {
    date: day('2026-08-08'),
    customerId: customer.id,
    warehouseId: whMain.id,
    handlerName: 'admin',
    note: '现结一半，余款月底结',
    freight: 60,
    items: [{ inventoryId: invCottonMain.id, weight: 200, price: 24.5, packages: 8 }],
  })
  await log(admin.id, 'admin', '卖出出库', so1.orderNo, '纯棉纱 32支/本白 200kg @24.5 运费60')

  const invPolyMain = await findInv('TC20260805', whMain.id)
  const so2 = await createSale(prisma, {
    date: day('2026-08-09'),
    customerId: both.id,
    warehouseId: whMain.id,
    handlerName: 'clerk',
    items: [{ inventoryId: invPolyMain.id, weight: 100, price: 21, packages: 4 }],
  })
  await log(clerk.id, 'clerk', '卖出出库', so2.orderNo, '涤棉纱 32支/浅灰 100kg @21')

  // ---------- 调拨 ----------
  const invCottonMain2 = await findInv('C20260801', whMain.id)
  const to1 = await createTransfer(prisma, {
    date: day('2026-08-10'),
    fromWarehouseId: whMain.id,
    toWarehouseId: whWest.id,
    handlerName: 'admin',
    note: '调拨至城西仓周转',
    items: [{ inventoryId: invCottonMain2.id, weight: 300 }],
  })
  await log(admin.id, 'admin', '仓库调拨', to1.orderNo, '纯棉纱 32支/本白 300kg 华东仓→城西仓')

  // ---------- 送加工 + 加工费结算 ----------
  const invPolyMain2 = await findInv('TC20260805', whMain.id)
  const to2 = await createTransfer(prisma, {
    date: day('2026-08-11'),
    fromWarehouseId: whMain.id,
    toWarehouseId: factory.id,
    handlerName: 'admin',
    note: '送染厂改色',
    freight: 50,
    items: [{ inventoryId: invPolyMain2.id, weight: 150 }],
  })
  await log(admin.id, 'admin', '送加工', to2.orderNo, '涤棉纱 32支/浅灰 150kg → 城南加工厂')

  const invPolyFactory = await findInv('TC20260805', factory.id)
  await settleProcessingFee(prisma, invPolyFactory.id, {
    feePerKg: 2,
    inputWeight: 150,
    spec: '28支',
    color: '宝蓝',
    unit: 'kg',
    batchNo: 'PR20260812',
    outputWeight: 140,
    handlerName: 'admin',
  })
  await log(admin.id, 'admin', '加工费结算', 'PR20260812', '涤棉纱 150kg→28支/宝蓝 140kg 加工费2元/kg')

  const invPolyProcessed = await findInv('PR20260812', factory.id)
  const pr1 = await createProcessingReturn(prisma, {
    date: day('2026-08-13'),
    factoryId: factory.id,
    warehouseId: whMain.id,
    handlerName: 'admin',
    note: '加工完成退回',
    processingFeePerKg: 0,
    freight: 40,
    expectedSellPricePerKg: 26,
    items: [
      {
        inventoryId: invPolyProcessed.id,
        weight: 100,
        spec: '28支',
        color: '宝蓝',
        unit: 'kg',
        batchNo: 'PR20260812',
        outputWeight: 100,
        packages: 4,
      },
    ],
  })
  await log(admin.id, 'admin', '加工收回', pr1.orderNo, '28支/宝蓝 100kg 退回华东仓')

  // ---------- 盘库 ----------
  const invAcrylicWest = await findInv('J20260806', whWest.id)
  const st1 = await createStocktake(prisma, {
    date: day('2026-08-14'),
    warehouseId: whWest.id,
    handlerName: 'clerk',
    note: '月度盘点',
    items: [{ inventoryId: invAcrylicWest.id, actualWeight: 505 }],
  })
  await log(clerk.id, 'clerk', '盘库', st1.orderNo, '腈纶纱 28支/米白 账面500 实盘505 盘盈5')

  // ---------- 资金结算 ----------
  const s1 = await createSettlement(prisma, {
    side: 'PURCHASE',
    counterpartyId: supplier.id,
    amount: 15000,
    date: day('2026-08-07'),
    method: '银行转账',
    handlerName: 'admin',
  })
  await log(admin.id, 'admin', '结算登记', 'PURCHASE', '江南纺织原料 付款15000')

  await createSettlement(prisma, {
    side: 'PURCHASE',
    counterpartyId: both.id,
    amount: 7600,
    date: day('2026-08-07'),
    method: '现金',
    handlerName: 'clerk',
  })
  const s3 = await createSettlement(prisma, {
    side: 'SALE',
    counterpartyId: both.id,
    amount: 1000,
    date: day('2026-08-10'),
    method: '银行转账',
    handlerName: 'clerk',
  })
  await log(clerk.id, 'clerk', '收款登记', s3.id, '义乌针织经销部 收款1000')

  // ---------- 加工费付款（欠180） ----------
  const fp1 = await prisma.processingFeePayment.create({
    data: { factoryId: factory.id, amount: 100, date: day('2026-08-15'), method: '微信转账', handlerName: 'admin' },
  })
  await log(admin.id, 'admin', '加工费付款', fp1.id, '城南加工厂 付款100')

  const summary = {
    users: await prisma.user.count(),
    warehouses: await prisma.warehouse.count(),
    counterparties: await prisma.counterparty.count(),
    yarns: await prisma.yarn.count(),
    variants: await prisma.yarnVariant.count(),
    purchases: await prisma.purchaseOrder.count(),
    sales: await prisma.saleOrder.count(),
    transfers: await prisma.transferOrder.count(),
    returns: await prisma.processingReturn.count(),
    stocktakes: await prisma.stocktake.count(),
    settlements: await prisma.settlement.count(),
    auditLogs: await prisma.auditLog.count(),
  }
  console.log('演示数据生成完成：')
  console.log(JSON.stringify(summary, null, 2))
  console.log('演示账号：admin / demo123456，clerk / demo123456')
  void s1
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())