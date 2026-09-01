import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import {
  createPurchase,
  createProcessingReturn,
  createSale,
  createTransfer,
  getInventoryRows,
  settleProcessingFee,
} from '@/services/inventory'
import { getInventoryValuation, getProfitEstimate, getRecentFlow } from '@/services/reports'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

describe('库存金额', () => {
  it('按库存行成本估算库存金额', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    await createPurchase(db, {
      date: new Date('2026-08-02'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-002', weight: 300, price: 30 }],
    })
    const valuation = await getInventoryValuation(db)
    expect(valuation).toHaveLength(1)
    expect(valuation[0].weight).toBe(400)
    expect(valuation[0].value.toString()).toBe('11000')
  })
})

describe('进出流水', () => {
  it('合并买入与卖出并按日期倒序', async () => {
    const base = await createBase(db)
    const saleDate = new Date()
    const purchaseDate = new Date(saleDate.getTime() - 24 * 60 * 60 * 1000)
    await createPurchase(db, {
      date: purchaseDate,
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: saleDate,
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    const flow = await getRecentFlow(db, 30)
    expect(flow).toHaveLength(2)
    expect(flow[0].type).toBe('SALE')
    expect(flow[1].type).toBe('PURCHASE')
  })
})

describe('毛利估算（含运费）', () => {
  it('卖出货款 - 行单位成本 - 行单位运费 - 卖货运费', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 300,
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-05'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 50,
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    const profit = await getProfitEstimate(db)
    expect(profit.saleGoodsTotal.toString()).toBe('2200')
    expect(profit.saleFreightTotal.toString()).toBe('50')
    expect(profit.estimatedCost.toString()).toBe('2000')
    expect(profit.estimatedFreight.toString()).toBe('30')
    expect(profit.estimatedProfit.toString()).toBe('120')
  })
})

describe('加工收回后的库存金额', () => {
  it('库存金额包含加工费', async () => {
    const base = await createBase(db)
    const factory = await db.warehouse.create({ data: { name: '染厂一', type: 'FACTORY' } })
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createTransfer(db, {
      date: new Date('2026-08-02'),
      fromWarehouseId: base.warehouseA,
      toWarehouseId: factory.id,
      handlerName: '爸爸',
      items: [{ inventoryId: rows[0].id, weight: 100 }],
    })
    const factoryRows = await getInventoryRows(db, { warehouseId: factory.id })
    await settleProcessingFee(db, factoryRows[0].id, { feePerKg: 2 })
    const settledRows = await getInventoryRows(db, { warehouseId: factory.id })
    const settledRow = settledRows.find((r) => r.processingFeeSettled)!
    await createProcessingReturn(db, {
      date: new Date('2026-08-03'),
      factoryId: factory.id,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [
        {
          inventoryId: settledRow.id,
          weight: 100,
          spec: '20支',
          color: '紫色',
          unit: 'kg',
          batchNo: 'P-001',
          outputWeight: 800,
        },
      ],
    })
    const valuation = await getInventoryValuation(db)
    expect(valuation[0].value.toString()).toBe('2200')
  })
})

describe('卖光加工收回批次后的毛利', () => {
  it('按卖出明细快照的单位成本/运费计算最终利润', async () => {
    const base = await createBase(db)
    const factory = await db.warehouse.create({ data: { name: '染厂一', type: 'FACTORY' } })
    // 买 1000kg @20，运费 500
    await createPurchase(db, {
      date: new Date('2026-08-14'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 500,
      items: [{ variantId: base.variantId, batchNo: 'B-001', weight: 1000, price: 20 }],
    })
    // 送 500kg 去染厂，运费 200
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createTransfer(db, {
      date: new Date('2026-08-14'),
      fromWarehouseId: base.warehouseA,
      toWarehouseId: factory.id,
      handlerName: '爸爸',
      freight: 200,
      items: [{ inventoryId: rows[0].id, weight: 500 }],
    })
    // 收回 400kg 紫色，运费 150（染色费先在库存页按 5 元/kg 结算）
    const factoryRows = await getInventoryRows(db, { warehouseId: factory.id })
    await settleProcessingFee(db, factoryRows[0].id, { feePerKg: 5 })
    const settledRows = await getInventoryRows(db, { warehouseId: factory.id })
    const settledRow = settledRows.find((r) => r.processingFeeSettled)!
    await createProcessingReturn(db, {
      date: new Date('2026-08-14'),
      factoryId: factory.id,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 150,
      items: [
        {
          inventoryId: settledRow.id,
          weight: 500,
          spec: '20支',
          color: '紫色',
          unit: 'kg',
          batchNo: 'P-001',
          outputWeight: 400,
        },
      ],
    })
    // 卖光 400kg @40，运费 200
    const wRows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const purple = wRows.find((r) => r.variant.color === '紫色')!
    await createSale(db, {
      date: new Date('2026-08-14'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 200,
      items: [{ inventoryId: purple.id, weight: 400, price: 40 }],
    })
    const profit = await getProfitEstimate(db)
    // 已结算加工费后成本 12500（10000 + 5×500）；新单位成本 31.25 × 400 = 12500；新单位运费 1.51 × 400 = 604；卖单运费 200
    // 毛利 = 16000 − 12500 − 604 − 200 = 2696
    expect(profit.estimatedCost.toString()).toBe('12500')
    expect(profit.estimatedFreight.toString()).toBe('604')
    expect(profit.estimatedProfit.toString()).toBe('2696')
  })
})
