import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import { createPurchase, createSale, getInventoryRows } from '@/services/inventory'
import { createSettlement, getPayableSummary, getReceivableSummary } from '@/services/settlement'
import { revertPurchase, revertSale, revertSettlement } from '@/services/revert'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

describe('撤回结算', () => {
  it('撤回后记录消失、汇总恢复', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 1000, price: 20 }],
    })
    const s = await createSettlement(db, {
      side: 'PURCHASE',
      counterpartyId: base.supplierId,
      amount: 5000,
      date: new Date('2026-08-08'),
      handlerName: 'admin',
    })
    await revertSettlement(db, s.id)
    const payables = await getPayableSummary(db)
    expect(payables[0].settledAmount.toString()).toBe('0')
    expect(payables[0].remainingAmount.toString()).toBe('20000')
  })

  it('不存在的记录报错', async () => {
    await expect(revertSettlement(db, 'nope')).rejects.toThrow('结算记录不存在')
  })
})

describe('撤回买入', () => {
  it('撤回后库存/成本/运费还原', async () => {
    const base = await createBase(db)
    const order = await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      freight: 100,
      items: [
        { variantId: base.variantId, batchNo: 'F1', weight: 300, price: 10 },
        { variantId: base.variantId, batchNo: 'F2', weight: 200, price: 10 },
      ],
    })
    await revertPurchase(db, order.id)
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA, includeZero: true })
    const f1 = rows.find((r) => r.batch.batchNo === 'F1')
    const f2 = rows.find((r) => r.batch.batchNo === 'F2')
    expect(f1?.weight.toString()).toBe('0')
    expect(f1?.cost.toString()).toBe('0')
    expect(f1?.freight.toString()).toBe('0')
    expect(f2?.weight.toString()).toBe('0')
    expect(await db.purchaseOrder.count()).toBe(0)
  })

  it('货已被卖出则禁止撤回', async () => {
    const base = await createBase(db)
    const order = await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-02'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    await expect(revertPurchase(db, order.id)).rejects.toThrow('已被卖出/调走')
  })

  it('撤回后供应商已付超过应付则禁止', async () => {
    const base = await createBase(db)
    const order = await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 500, price: 20 }],
    })
    await createSettlement(db, {
      side: 'PURCHASE',
      counterpartyId: base.supplierId,
      amount: 8000,
      date: new Date('2026-08-03'),
      handlerName: 'admin',
    })
    await expect(revertPurchase(db, order.id)).rejects.toThrow('已付超过应付')
  })
})

describe('撤回卖出', () => {
  it('撤回后库存与成本加回', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 1000, price: 20 }],
    })
    let rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const sale = await createSale(db, {
      date: new Date('2026-08-02'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    await revertSale(db, sale.id)
    rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(rows[0].weight.toString()).toBe('1000')
    expect(rows[0].cost.toString()).toBe('20000')
    expect(await db.saleOrder.count()).toBe(0)
  })

  it('撤回后客户已收超过应收则禁止', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const sale = await createSale(db, {
      date: new Date('2026-08-02'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    await createSettlement(db, {
      side: 'SALE',
      counterpartyId: base.customerId,
      amount: 2200,
      date: new Date('2026-08-03'),
      handlerName: 'admin',
    })
    await expect(revertSale(db, sale.id)).rejects.toThrow('已收超过应收')
  })
})
