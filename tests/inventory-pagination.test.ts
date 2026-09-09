import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { buildInventoryGroups } from '@/lib/inventory-presentation'
import { createPurchase, createTransfer, getInventoryPage, getInventoryRows, settleProcessingFee } from '@/services/inventory'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

describe('库存来源分组分页', () => {
  it('分页结果与旧全量分组一致，并覆盖筛选、legacy、零库存和越界页', async () => {
    const warehouseA = await db.warehouse.create({ data: { name: '仓A' } })
    const warehouseB = await db.warehouse.create({ data: { name: '仓B' } })
    const yarn = await db.yarn.create({ data: { name: '棉%_纱' } })
    const variant = await db.yarnVariant.create({ data: { yarnId: yarn.id, spec: '32支', color: '白色', unit: 'kg' } })
    const supplier = await db.counterparty.create({ data: { name: '供应商', type: 'SUPPLIER' } })

    for (let index = 0; index < 21; index++) {
      await createPurchase(db, {
        date: new Date(`2026-08-${String(index + 1).padStart(2, '0')}`),
        supplierId: supplier.id,
        warehouseId: warehouseA.id,
        handlerName: '测试',
        items: [
          { variantId: variant.id, batchNo: `B-${index}-1`, weight: 10, price: 2 },
          { variantId: variant.id, batchNo: `B-${index}-2`, weight: 20, price: 2 },
        ],
      })
    }
    await createPurchase(db, {
      date: new Date('2026-09-01'), supplierId: supplier.id, warehouseId: warehouseB.id,
      handlerName: '测试', items: [{ variantId: variant.id, batchNo: 'B-CROSS', weight: 5, price: 2 }],
    })
    const legacyBatch = await db.batch.findFirstOrThrow({ where: { variantId: variant.id } })
    await db.inventory.create({ data: { warehouseId: warehouseB.id, variantId: variant.id, batchId: legacyBatch.id, weight: 0, cost: 0, freight: 0 } })
    const original = await db.inventory.findFirstOrThrow({ where: { warehouseId: warehouseA.id } })
    await createTransfer(db, { date: new Date('2026-09-01'), fromWarehouseId: warehouseA.id, toWarehouseId: warehouseB.id,
      handlerName: '刚', items: [{ inventoryId: original.id, weight: 1 }] })
    const factory = await db.warehouse.create({ data: { name: '染厂', type: 'FACTORY' } })
    await createPurchase(db, { date: new Date('2026-09-01'), supplierId: supplier.id, warehouseId: factory.id,
      handlerName: '刚', items: [{ variantId: variant.id, batchNo: 'PROCESS-RAW', weight: 50, price: 2 }] })
    const raw = await db.inventory.findFirstOrThrow({ where: { warehouseId: factory.id } })
    await settleProcessingFee(db, raw.id, { feePerKg: 1, inputWeight: 50, outputWeight: 48, handlerName: '刚' })

    const allRows = await getInventoryRows(db, { includeZero: true })
    const allGroups = buildInventoryGroups(allRows.map((row) => ({
      ...row, warehouseName: row.warehouse.name, warehouseType: row.warehouse.type,
      yarnName: row.variant.yarn.name, spec: row.variant.spec, color: row.variant.color,
      unit: row.variant.unit, batchNo: row.batch.batchNo, lotNo: row.lot?.lotNo ?? null,
      lotId: row.lotId, weight: row.weight.toString(), cost: row.cost.toString(), freight: row.freight.toString(),
      sourceType: row.lot?.sourceType ?? 'LEGACY_AGGREGATED', sourceId: row.lot?.purchaseItem?.order.id ?? row.lot?.processingOutput?.job.id ?? row.lot?.id ?? row.id,
      sourceNo: row.lot?.purchaseItem?.order.orderNo ?? row.lot?.lotNo ?? '历史汇总库存', sourceDate: null,
    })))
    expect(allGroups.length).toBeGreaterThan(21)

    const page1 = await getInventoryPage(db, { includeZero: true }, 1)
    const page2 = await getInventoryPage(db, { includeZero: true }, 2)
    expect(page1.page).toBe(1)
    expect(page1.totalPages).toBe(2)
    expect(page1.totalGroups).toBe(allGroups.length)
    expect(page1.rows).toHaveLength(40)
    expect(new Set(page1.rows.map(row => row.id))).toEqual(new Set(allGroups.slice(0, 20).flatMap(group => group.rows.map(row => row.id))))
    expect(new Set(page2.rows.map(row => row.id))).toEqual(new Set(allGroups.slice(20).flatMap(group => group.rows.map(row => row.id))))
    expect(page2.rows).toHaveLength(allRows.length - page1.rows.length)
    expect(new Set([...page1.rows, ...page2.rows].map((row) => row.id))).toEqual(new Set(allRows.map((row) => row.id)))
    expect(Number(page1.totalWeight)).toBeCloseTo(allRows.reduce((sum, row) => sum + Number(row.weight), 0))
    expect(page1.totalRows).toBe(allRows.length)

    const overflow = await getInventoryPage(db, { includeZero: true }, 99)
    expect(overflow.page).toBe(2)
    expect(overflow.rows.map((row) => row.id)).toEqual(page2.rows.map((row) => row.id))

    const filtered = await getInventoryPage(db, { q: '%_', includeZero: true }, 1)
    const oldFiltered = await getInventoryRows(db, { q: '%_', includeZero: true })
    expect(filtered.totalRows).toBe(oldFiltered.length)
    const nonZero = await getInventoryPage(db, {}, 1)
    const oldNonZero = await getInventoryRows(db, {})
    expect(nonZero.totalRows).toBe(oldNonZero.length)
    const selectedWarehouse = await getInventoryPage(db, { warehouseId: warehouseB.id }, 1)
    expect(selectedWarehouse.rows.every(row => row.warehouseId === warehouseB.id)).toBe(true)
    expect((await getInventoryPage(db, { q: "' OR 1=1 --" }, 1)).rows).toHaveLength(0)
  })
})
