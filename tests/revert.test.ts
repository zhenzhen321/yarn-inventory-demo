import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import {
  archiveZeroInventory,
  createPurchase,
  createSale,
  getInventoryRows,
} from '@/services/inventory'
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
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 1000, price: 20 }],
    })
    const s = await createSettlement(db, {
      side: 'PURCHASE',
      counterpartyId: base.supplierId,
      amount: 5000,
      date: new Date('2026-08-08'),
      handlerName: '刚',
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
      handlerName: '刚',
      freight: 100,
      items: [
        { variantId: base.variantId, batchNo: 'F1', weight: 300, price: 10 },
        { variantId: base.variantId, batchNo: 'F2', weight: 200, price: 10 },
      ],
    })
    await revertPurchase(db, order.id)
    const rows = await db.inventory.findMany({ where: { warehouseId: base.warehouseA } })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.archived && row.weight.isZero())).toBe(true)
    expect(rows.every((row) => row.cost.isZero() && row.freight.isZero())).toBe(true)
    const preserved = await db.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(preserved.reversedAt).toBeTruthy()
    expect(await db.purchaseOrder.count()).toBe(1)
    expect(await db.stockMovement.count({ where: { type: 'REVERSAL' } })).toBe(2)
  })

  it('同批次存在归档行时撤回新买入只扣活动行', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'ARCHIVE-P', weight: 100, price: 20 }],
    })
    const original = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-02'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ inventoryId: original[0].id, weight: 100, price: 22 }],
    })
    await archiveZeroInventory(db, base.warehouseA)

    const second = await createPurchase(db, {
      date: new Date('2026-08-03'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'ARCHIVE-P', weight: 50, price: 21 }],
    })
    await revertPurchase(db, second.id)

    const allRows = await db.inventory.findMany({
      where: { warehouseId: base.warehouseA },
      orderBy: { archived: 'desc' },
    })
    expect(allRows).toHaveLength(2)
    expect(allRows.every((row) => row.weight.toString() === '0')).toBe(true)
    expect(allRows.every((row) => row.archived)).toBe(true)
    expect(allRows.every((row) => row.cost.toString() === '0')).toBe(true)
  })

  it('货已被卖出则禁止撤回', async () => {
    const base = await createBase(db)
    const order = await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-02'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    await expect(revertPurchase(db, order.id)).rejects.toThrow(
      '已被卖出、调拨、加工或盘点',
    )
  })

  it('撤回后供应商已付超过应付则禁止', async () => {
    const base = await createBase(db)
    const order = await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 500, price: 20 }],
    })
    await createSettlement(db, {
      side: 'PURCHASE',
      counterpartyId: base.supplierId,
      amount: 8000,
      date: new Date('2026-08-03'),
      handlerName: '刚',
    })
    await expect(revertPurchase(db, order.id)).rejects.toThrow('已付超过应付')
  })
})

describe('撤回卖出', () => {
  it('零库存归档后撤回卖出会恢复为可见库存', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'ARCHIVE-1', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const sale = await createSale(db, {
      date: new Date('2026-08-02'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    await archiveZeroInventory(db, base.warehouseA)
    expect(await getInventoryRows(db, { warehouseId: base.warehouseA, includeZero: true })).toHaveLength(0)

    await revertSale(db, sale.id)

    const restored = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(restored).toHaveLength(1)
    expect(restored[0].weight.toString()).toBe('100')
    expect(restored[0].archived).toBe(false)
  })

  it('撤回后库存与成本加回', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 1000, price: 20 }],
    })
    let rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const sale = await createSale(db, {
      date: new Date('2026-08-02'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    await revertSale(db, sale.id)
    rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(rows[0].weight.toString()).toBe('1000')
    expect(rows[0].cost.toString()).toBe('20000')
    const preserved = await db.saleOrder.findUniqueOrThrow({ where: { id: sale.id } })
    expect(preserved.reversedAt).toBeTruthy()
    expect(await db.saleOrder.count()).toBe(1)
    expect(await db.stockMovement.count({ where: { type: 'REVERSAL' } })).toBe(1)
  })

  it('撤回后客户已收超过应收则禁止', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const sale = await createSale(db, {
      date: new Date('2026-08-02'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    await createSettlement(db, {
      side: 'SALE',
      counterpartyId: base.customerId,
      amount: 2200,
      date: new Date('2026-08-03'),
      handlerName: '刚',
    })
    await expect(revertSale(db, sale.id)).rejects.toThrow('已收超过应收')
  })
})
