import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import { createPurchase, createSale, getInventoryRows } from '@/services/inventory'
import { getOrderRecordCount, getOrderRecords } from '@/services/orders'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

async function seed() {
  const base = await createBase(db)
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
    handlerName: '妈妈',
    items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
  })
  const poly = await db.yarn.create({ data: { name: '涤纶纱' } })
  const black = await db.yarnVariant.create({
    data: { yarnId: poly.id, spec: '32支', color: '黑色', unit: 'kg' },
  })
  await createPurchase(db, {
    date: new Date('2026-08-03'),
    supplierId: base.supplierId,
    warehouseId: base.warehouseB,
    handlerName: '爸爸',
    items: [{ variantId: black.id, batchNo: 'D-001', weight: 500, price: 15 }],
  })
  return base
}

describe('出入库记录查询', () => {
  it('合并买入与卖出并按日期倒序', async () => {
    await seed()
    const rows = await getOrderRecords(db, {})
    expect(rows).toHaveLength(3)
    expect(rows[0].orderType).toBe('SALE')
  })

  it('默认截断到最近 200 张，limit null 返回全部，计数不受截断影响', async () => {
    const base = await seed()
    for (let i = 0; i < 210; i++) {
      await createPurchase(db, {
        date: new Date(2026, 7, 1 + (i % 28)),
        supplierId: base.supplierId,
        warehouseId: base.warehouseA,
        handlerName: '爸爸',
        items: [{ variantId: base.variantId, batchNo: `LIMIT-${i}`, weight: 10, price: 5 }],
      })
    }
    const total = await getOrderRecordCount(db, {})
    expect(total).toBeGreaterThanOrEqual(210)

    const capped = await getOrderRecords(db, {})
    expect(capped).toHaveLength(200)

    const all = await getOrderRecords(db, { limit: null })
    expect(all.length).toBe(total)
    expect(all.length).toBeGreaterThan(capped.length)

    expect(await getOrderRecordCount(db, { type: 'SALE' })).toBe(1)
  })

  it('按类型筛选', async () => {
    await seed()
    expect(await getOrderRecords(db, { type: 'PURCHASE' })).toHaveLength(2)
    expect(await getOrderRecords(db, { type: 'SALE' })).toHaveLength(1)
  })

  it('按日期范围筛选', async () => {
    await seed()
    expect(await getOrderRecords(db, { from: '2026-08-02' })).toHaveLength(2)
    expect(await getOrderRecords(db, { to: '2026-08-02' })).toHaveLength(1)
  })

  it('按仓库筛选', async () => {
    const base = await seed()
    expect(await getOrderRecords(db, { warehouseId: base.warehouseA })).toHaveLength(2)
    expect(await getOrderRecords(db, { warehouseId: base.warehouseB })).toHaveLength(1)
  })

  it('按往来单位筛选', async () => {
    const base = await seed()
    const buys = await getOrderRecords(db, { counterpartyId: base.supplierId })
    const sells = await getOrderRecords(db, { counterpartyId: base.customerId })
    expect(buys.every((r) => r.orderType === 'PURCHASE')).toBe(true)
    expect(sells.every((r) => r.orderType === 'SALE')).toBe(true)
  })

  it('按单号关键词筛选', async () => {
    await seed()
    const rows = await getOrderRecords(db, { q: 'PO-' })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.orderNo.startsWith('PO-'))).toBe(true)
  })

  it('按纱线明细筛选（名称/支数/色号）', async () => {
    await seed()
    expect(await getOrderRecords(db, { yarnQ: '涤纶' })).toHaveLength(1)
    expect(await getOrderRecords(db, { yarnQ: '黑色' })).toHaveLength(1)
    expect(await getOrderRecords(db, { yarnQ: '白' })).toHaveLength(2)
  })

  it('明细包含展开显示所需的完整货品字段', async () => {
    await seed()
    const rows = await getOrderRecords(db, { yarnQ: '涤纶' })
    expect(rows).toHaveLength(1)
    const it = rows[0].items[0]
    expect(it.yarnName).toBe('涤纶纱')
    expect(it.spec).toBe('32支')
    expect(it.color).toBe('黑色')
    expect(it.unit).toBe('kg')
    expect(it.batchNo).toBe('D-001')
    expect(it.weight.toString()).toBe('500')
    expect(it.price.toString()).toBe('15')
    expect(it.amount.toString()).toBe('7500')
  })
})
