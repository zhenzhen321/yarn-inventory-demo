import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import {
  archiveZeroInventory,
  createPurchase,
  createProcessingReturn,
  createSale,
  createStocktake,
  createTransfer,
  getInventoryRows,
  settleProcessingFee,
  updatePurchaseFreight,
  type PurchaseInput,
} from '@/services/inventory'
import { revertPurchase } from '@/services/revert'

let db: PrismaClient

async function createBase() {
  const warehouseA = await db.warehouse.create({ data: { name: '仓A' } })
  const warehouseB = await db.warehouse.create({ data: { name: '仓B' } })
  const yarn = await db.yarn.create({ data: { name: '棉纱' } })
  const variant = await db.yarnVariant.create({
    data: { yarnId: yarn.id, spec: '32支', color: '白色', unit: 'kg' },
  })
  const supplier = await db.counterparty.create({ data: { name: '供应商甲', type: 'SUPPLIER' } })
  const customer = await db.counterparty.create({ data: { name: '客户乙', type: 'CUSTOMER' } })
  return {
    warehouseA: warehouseA.id,
    warehouseB: warehouseB.id,
    yarnId: yarn.id,
    variantId: variant.id,
    supplierId: supplier.id,
    customerId: customer.id,
  }
}

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

describe('买入入库', () => {
  it('买入后库存增加', async () => {
    const base = await createBase()
    const input: PurchaseInput = {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, weight: 1000, price: 20 }],
    }
    await createPurchase(db, input)
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(rows).toHaveLength(1)
    expect(rows[0].weight.toString()).toBe('1000')
  })

  it('同一供应商批次分次买入也保留独立内部批次和各自成本', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 500, price: 20 }],
    })
    await createPurchase(db, {
      date: new Date('2026-08-02'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 300, price: 21 }],
    })
    await createPurchase(db, {
      date: new Date('2026-08-03'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-002', weight: 200, price: 22 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(rows).toHaveLength(3)
    const g1 = rows.filter((r) => r.batch.batchNo === 'G-001')
    const g2 = rows.find((r) => r.batch.batchNo === 'G-002')
    expect(g1).toHaveLength(2)
    expect(g1.map((row) => row.weight.toString()).sort()).toEqual(['300', '500'])
    expect(g1.map((row) => row.cost.div(row.weight).toString()).sort()).toEqual(['20', '21'])
    expect(new Set(g1.map((row) => row.lotId)).size).toBe(2)
    expect(g2?.weight.toString()).toBe('200')
  })

  it('修改买入运费后按重量比例分摊到库存运费，合计精确等于运费', async () => {
    const base = await createBase()
    const created = await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [
        { variantId: base.variantId, batchNo: 'F1', weight: 300, price: 10 },
        { variantId: base.variantId, batchNo: 'F2', weight: 200, price: 10 },
      ],
    })
    await updatePurchaseFreight(db, created.id, 100)
    const updated = await db.purchaseOrder.findUnique({ where: { id: created.id } })
    expect(updated?.freight.toString()).toBe('100')
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const f1 = rows.find((r) => r.batch.batchNo === 'F1')
    const f2 = rows.find((r) => r.batch.batchNo === 'F2')
    expect(f1?.freight.toString()).toBe('60')
    expect(f2?.freight.toString()).toBe('40')
  })

  it('多明细（跨变体）买入单批量校验并二次修改运费，分摊仍精确', async () => {
    const base = await createBase()
    const variant2 = await db.yarnVariant.create({
      data: { yarnId: base.yarnId, spec: '40支', color: '黑色', unit: 'kg' },
    })
    const created = await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [
        { variantId: base.variantId, batchNo: 'M1', weight: 300, price: 10 },
        { variantId: variant2.id, batchNo: 'M2', weight: 200, price: 10 },
        { variantId: variant2.id, batchNo: 'M3', weight: 100, price: 10 },
      ],
    })
    await updatePurchaseFreight(db, created.id, 60)
    const rowsAfterFirst = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const byBatch = (no: string) => rowsAfterFirst.find((r) => r.batch.batchNo === no)!
    expect(byBatch('M1').freight.toString()).toBe('30')
    expect(byBatch('M2').freight.toString()).toBe('20')
    expect(byBatch('M3').freight.toString()).toBe('10')
    await updatePurchaseFreight(db, created.id, 120)
    const rowsAfterSecond = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const byBatch2 = (no: string) => rowsAfterSecond.find((r) => r.batch.batchNo === no)!
    expect(byBatch2('M1').freight.toString()).toBe('60')
    expect(byBatch2('M2').freight.toString()).toBe('40')
    expect(byBatch2('M3').freight.toString()).toBe('20')
    const updated = await db.purchaseOrder.findUniqueOrThrow({ where: { id: created.id } })
    expect(updated.freight.toString()).toBe('120')
  })

  it('买入保存时库存、内部批次和入库流水的运费合计精确等于订单运费', async () => {
    const base = await createBase()
    const created = await createPurchase(db, {
      date: new Date('2026-09-06'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      freight: 100,
      items: [
        { variantId: base.variantId, batchNo: 'F-SAVE-1', weight: 3000, price: 10 },
        { variantId: base.variantId, batchNo: 'F-SAVE-2', weight: 1, price: 10 },
      ],
    })

    const lotIds = created.items.map((item) => item.lotId!)
    const inventories = await db.inventory.findMany({ where: { lotId: { in: lotIds } } })
    const lots = await db.inventoryLot.findMany({ where: { id: { in: lotIds } } })
    const movements = await db.stockMovement.findMany({
      where: { referenceType: 'PURCHASE', referenceId: created.id },
    })

    expect(inventories.reduce((total, row) => total + Number(row.freight), 0)).toBe(100)
    expect(lots.reduce((total, row) => total + Number(row.freightCost), 0)).toBe(100)
    expect(movements.reduce((total, row) => total + Number(row.freightCost), 0)).toBe(100)
  })

  it('库存发生卖出后禁止修改原买入运费', async () => {
    const base = await createBase()
    const order = await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'F-MOVED', weight: 100, price: 10 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-02'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ inventoryId: rows[0].id, weight: 10, price: 12 }],
    })
    await expect(updatePurchaseFreight(db, order.id, 100)).rejects.toThrow(
      '已发生卖出、调拨、加工或盘点',
    )
    const unchanged = await db.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(unchanged.freight.toString()).toBe('0')
  })

  it('修改不存在的买入单报错', async () => {
    await expect(updatePurchaseFreight(db, 'not-exist-id', 100)).rejects.toThrow('买入单不存在')
  })

    it('自动生成批次号，单据总额正确', async () => {
      const base = await createBase()
      const order = await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [
        { variantId: base.variantId, weight: 100, price: 20 },
        { variantId: base.variantId, weight: 200, price: 21.5 },
      ],
    })
    expect(order.totalAmount.toString()).toBe('6300')
      expect(order.items[0].batch.batchNo).toBeTruthy()
      expect(order.orderNo).toMatch(/^PO-\d{8}-\d{4}$/)
    })

    it('撤回买入后新单号不与现存单据重复', async () => {
      const base = await createBase()
      const first = await createPurchase(db, {
        date: new Date('2026-08-01'),
        supplierId: base.supplierId,
        warehouseId: base.warehouseA,
        handlerName: '爸爸',
        items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
      })
      await createPurchase(db, {
        date: new Date('2026-08-01'),
        supplierId: base.supplierId,
        warehouseId: base.warehouseA,
        handlerName: '爸爸',
        items: [{ variantId: base.variantId, batchNo: 'G-002', weight: 100, price: 20 }],
      })
      await revertPurchase(db, first.id)
      const third = await createPurchase(db, {
        date: new Date('2026-08-01'),
        supplierId: base.supplierId,
        warehouseId: base.warehouseA,
        handlerName: '爸爸',
        items: [{ variantId: base.variantId, batchNo: 'G-003', weight: 100, price: 20 }],
      })
      const all = await db.purchaseOrder.findMany({
        select: { orderNo: true, reversedAt: true },
      })
      expect(all).toHaveLength(3)
      expect(all.map((o) => o.orderNo)).toContain(third.orderNo)
      expect(new Set(all.map((o) => o.orderNo)).size).toBe(3)
      expect(all.find((o) => o.orderNo === first.orderNo)?.reversedAt).toBeTruthy()
    })

  it('买入自动创建新颜色变体，重复买入复用同一变体', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [
        {
          yarnId: base.yarnId,
          spec: '32支',
          color: '新色',
          unit: 'kg',
          batchNo: 'G-009',
          weight: 100,
          price: 20,
        },
      ],
    })
    const v = await db.yarnVariant.findFirst({
      where: { yarnId: base.yarnId, spec: '32支', color: '新色', unit: 'kg' },
    })
    expect(v).toBeTruthy()
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(rows).toHaveLength(1)
    expect(rows[0].variant.color).toBe('新色')

    await createPurchase(db, {
      date: new Date('2026-08-02'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [
        {
          yarnId: base.yarnId,
          spec: '32支',
          color: '新色',
          unit: 'kg',
          batchNo: 'G-010',
          weight: 50,
          price: 20,
        },
      ],
    })
    const count = await db.yarnVariant.count({
      where: { yarnId: base.yarnId, color: '新色' },
    })
    expect(count).toBe(1)
  })
})

describe('卖出出库', () => {
  it('同一库存重复出现在明细中时整单拒绝且库存不变', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'DUP-1', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await expect(
      createSale(db, {
        date: new Date('2026-08-05'),
        customerId: base.customerId,
        warehouseId: base.warehouseA,
        handlerName: '刚',
        items: [
          { inventoryId: rows[0].id, weight: 60, price: 22 },
          { inventoryId: rows[0].id, weight: 60, price: 22 },
        ],
      }),
    ).rejects.toThrow('同一库存不能重复选择')
    const after = await db.inventory.findUniqueOrThrow({ where: { id: rows[0].id } })
    expect(after.weight.toString()).toBe('100')
    expect(await db.saleOrder.count()).toBe(0)
  })

  it('出库后库存减少', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-05'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ inventoryId: rows[0].id, weight: 400, price: 22 }],
    })
    const after = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(after[0].weight.toString()).toBe('600')
  })

  it('库存不足时拒绝出库', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await expect(
      createSale(db, {
        date: new Date('2026-08-05'),
        customerId: base.customerId,
        warehouseId: base.warehouseA,
        handlerName: '爸爸',
        items: [{ inventoryId: rows[0].id, weight: 500, price: 22 }],
      }),
    ).rejects.toThrow('库存不足')
  })

  it('不能卖出其他仓库的库存', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await expect(
      createSale(db, {
        date: new Date('2026-08-05'),
        customerId: base.customerId,
        warehouseId: base.warehouseB,
        handlerName: '爸爸',
        items: [{ inventoryId: rows[0].id, weight: 10, price: 22 }],
      }),
    ).rejects.toThrow('不在所选仓库')
  })
})

describe('仓库调拨', () => {
  it('调拨后来源仓库减少，目标仓库增加', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createTransfer(db, {
      date: new Date('2026-08-06'),
      fromWarehouseId: base.warehouseA,
      toWarehouseId: base.warehouseB,
      handlerName: '爸爸',
      items: [{ inventoryId: rows[0].id, weight: 300 }],
    })
    const fromRows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const toRows = await getInventoryRows(db, { warehouseId: base.warehouseB })
    expect(fromRows[0].weight.toString()).toBe('700')
    expect(toRows).toHaveLength(1)
    expect(toRows[0].weight.toString()).toBe('300')
    expect(toRows[0].batch.batchNo).toBe('G-001')
  })
})

describe('盘库', () => {
  it('盘点后库存等于实盘数，差异有记录', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createStocktake(db, {
      date: new Date('2026-08-10'),
      warehouseId: base.warehouseA,
      handlerName: '妈妈',
      items: [{ inventoryId: rows[0].id, actualWeight: 960 }],
    })
    const after = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(after[0].weight.toString()).toBe('960')
    const st = await db.stocktake.findFirst({ include: { items: true } })
    expect(st?.items[0].bookWeight.toString()).toBe('1000')
    expect(st?.items[0].actualWeight.toString()).toBe('960')
    expect(st?.items[0].diff.toString()).toBe('-40')
  })
})

describe('运费与加工费', () => {
  it('买入运费不计入总额，但被保存', async () => {
    const base = await createBase()
    const order = await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 300,
      items: [{ variantId: base.variantId, weight: 100, price: 20 }],
    })
    expect(order.totalAmount.toString()).toBe('2000')
    expect(order.freight.toString()).toBe('300')
  })

  it('卖出运费不计入总额，但被保存', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const sale = await createSale(db, {
      date: new Date('2026-08-05'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 50,
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    expect(sale.totalAmount.toString()).toBe('2200')
    expect(sale.freight.toString()).toBe('50')
  })

  it('调拨到加工厂记录加工费与运费', async () => {
    const base = await createBase()
    const factory = await db.warehouse.create({ data: { name: '染厂一', type: 'FACTORY' } })
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const transfer = await createTransfer(db, {
      date: new Date('2026-08-06'),
      fromWarehouseId: base.warehouseA,
      toWarehouseId: factory.id,
      handlerName: '爸爸',
      processingFeePerKg: 2,
      freight: 80,
      items: [{ inventoryId: rows[0].id, weight: 100 }],
    })
    expect(transfer.processingFeePerKg?.toString()).toBe('2')
    expect(transfer.freight.toString()).toBe('80')
  })
})

describe('库存成本与运费跟踪', () => {
  it('买货运费按单位运费(2位小数)×重量分摊到库存行，成本=货款', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 100,
      items: [
        { variantId: base.variantId, batchNo: 'A', weight: 30, price: 10 },
        { variantId: base.variantId, batchNo: 'B', weight: 70, price: 10 },
      ],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const a = rows.find((r) => r.batch.batchNo === 'A')
    const b = rows.find((r) => r.batch.batchNo === 'B')
    expect(a?.cost.toString()).toBe('300')
    expect(a?.freight.toString()).toBe('30')
    expect(b?.cost.toString()).toBe('700')
    expect(b?.freight.toString()).toBe('70')
  })

  it('调拨按比例结转成本与运费，目标行另加本次运费', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 300,
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createTransfer(db, {
      date: new Date('2026-08-06'),
      fromWarehouseId: base.warehouseA,
      toWarehouseId: base.warehouseB,
      handlerName: '爸爸',
      freight: 40,
      items: [{ inventoryId: rows[0].id, weight: 40 }],
    })
    const fromRows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const toRows = await getInventoryRows(db, { warehouseId: base.warehouseB })
    expect(fromRows[0].weight.toString()).toBe('60')
    expect(fromRows[0].cost.toString()).toBe('1200')
    expect(fromRows[0].freight.toString()).toBe('180')
    expect(toRows[0].weight.toString()).toBe('40')
    expect(toRows[0].cost.toString()).toBe('800')
    expect(toRows[0].freight.toString()).toBe('160') // 结转 120 + 本次运费 40（40kg × 1.00 元/kg）
  })

  it('卖出按比例结转成本与运费，单位值不变', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 300,
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-05'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ inventoryId: rows[0].id, weight: 40, price: 22 }],
    })
    const after = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(after[0].weight.toString()).toBe('60')
    expect(after[0].cost.toString()).toBe('1200')
    expect(after[0].freight.toString()).toBe('180')
  })

  it('盘库按实盘重量等比调整成本与运费', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 300,
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createStocktake(db, {
      date: new Date('2026-08-10'),
      warehouseId: base.warehouseA,
      handlerName: '妈妈',
      items: [{ inventoryId: rows[0].id, actualWeight: 80 }],
    })
    const after = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(after[0].weight.toString()).toBe('80')
    expect(after[0].cost.toString()).toBe('1600')
    expect(after[0].freight.toString()).toBe('240')
  })
})

describe('加工收回', () => {
  it('收回后按公式计算新成本/新运费并生成新变体库存', async () => {
    const base = await createBase()
    const factory = await db.warehouse.create({ data: { name: '染厂一', type: 'FACTORY' } })
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 300,
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createTransfer(db, {
      date: new Date('2026-08-02'),
      fromWarehouseId: base.warehouseA,
      toWarehouseId: factory.id,
      handlerName: '爸爸',
      freight: 80,
      items: [{ inventoryId: rows[0].id, weight: 100 }],
    })
    const factoryRows = await getInventoryRows(db, { warehouseId: factory.id })
    // 完工时实际称重 80kg，并在此时建立紫色成品批次和确认加工应付。
    await settleProcessingFee(db, factoryRows[0].id, {
      feePerKg: 2,
      spec: '20支',
      color: '紫色',
      unit: 'kg',
      batchNo: 'P-001',
      outputWeight: 80,
    })
    const settledRows = await getInventoryRows(db, { warehouseId: factory.id })
    const settledRow = settledRows.find((r) => r.processingFeeSettled)!
    const ret = await createProcessingReturn(db, {
      date: new Date('2026-08-03'),
      factoryId: factory.id,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 50,
      expectedSellPricePerKg: 5,
      items: [
        {
          inventoryId: settledRow.id,
          weight: 80,
          spec: '20支',
          color: '紫色',
          unit: 'kg',
          batchNo: 'P-001',
          outputWeight: 80,
        },
      ],
    })
    // 成本 2000 + 2×80 = 2160；既有运费 380，加回程运费 50 后为 430。
    expect(ret.items[0].newCost.toString()).toBe('2160')
    expect(ret.items[0].newFreight.toString()).toBe('430')
    expect(ret.items[0].outputWeight.toString()).toBe('80')
    expect(ret.items[0].outputLotId).toBe(settledRow.lotId)
    expect(ret.items[0].destinationInventoryId).toBeTruthy()
    const out = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const purple = out.find((r) => r.variant.color === '紫色')
    expect(purple?.variant.spec).toBe('20支')
    expect(purple?.weight.toString()).toBe('80')
    expect(purple?.cost.toString()).toBe('2160')
    expect(purple?.freight.toString()).toBe('430')
    const factoryAfter = await getInventoryRows(db, {
      warehouseId: factory.id,
      includeZero: true,
    })
    expect(factoryAfter[0].weight.toString()).toBe('0')
  })

  it('来源不是加工厂时拒绝', async () => {
    const base = await createBase()
    await expect(
      createProcessingReturn(db, {
        date: new Date('2026-08-03'),
        factoryId: base.warehouseA,
        warehouseId: base.warehouseB,
        handlerName: '爸爸',
        items: [
          {
            inventoryId: 'x',
            weight: 10,
            spec: '20支',
            color: '紫',
            unit: 'kg',
            batchNo: 'P',
            outputWeight: 50,
          },
        ],
      }),
    ).rejects.toThrow('必须是加工厂')
  })
})

describe('0kg 库存过滤', () => {
  it('默认隐藏 0 重量行，includeZero 时显示', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-05'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    const defaultRows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const withZero = await getInventoryRows(db, {
      warehouseId: base.warehouseA,
      includeZero: true,
    })
    expect(defaultRows).toHaveLength(0)
    expect(withZero).toHaveLength(1)
    expect(withZero[0].weight.toString()).toBe('0')
  })
})

describe('盘掉 0kg 库存', () => {
  it('卖完的 0kg 行被归档，任何列表（含 includeZero）不再显示', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-05'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    const zeroRows = await getInventoryRows(db, {
      warehouseId: base.warehouseA,
      includeZero: true,
    })
    expect(zeroRows).toHaveLength(1)
    expect(zeroRows[0].weight.toString()).toBe('0')

    const result = await archiveZeroInventory(db, base.warehouseA)
    expect(result.count).toBe(1)

    const after = await getInventoryRows(db, {
      warehouseId: base.warehouseA,
      includeZero: true,
    })
    expect(after).toHaveLength(0)
    const archived = await db.inventory.findFirst({
      where: { warehouseId: base.warehouseA },
    })
    expect(archived?.archived).toBe(true)
  })

  it('只归档 0kg 行，有货的行不受影响', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    const result = await archiveZeroInventory(db, base.warehouseA)
    expect(result.count).toBe(0)
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(rows).toHaveLength(1)
    expect(rows[0].weight.toString()).toBe('100')
    expect(rows[0].archived).toBe(false)
  })

  it('归档后买入同一变体/批次不会合并进归档行', async () => {
    const base = await createBase()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-05'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    await archiveZeroInventory(db, base.warehouseA)
    await createPurchase(db, {
      date: new Date('2026-08-06'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 50, price: 20 }],
    })
    const after = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(after).toHaveLength(1)
    expect(after[0].weight.toString()).toBe('50')
    expect(after[0].archived).toBe(false)
    const all = await db.inventory.findMany({ where: { warehouseId: base.warehouseA } })
    expect(all).toHaveLength(2)
  })

  it('仓库不存在时抛错', async () => {
    await expect(archiveZeroInventory(db, 'no-such-warehouse')).rejects.toThrow('仓库不存在')
  })
})
