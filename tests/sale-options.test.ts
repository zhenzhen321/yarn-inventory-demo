import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { findSaleInventoryOption, getSaleInventoryOptions } from '@/services/sale-options'

let db: PrismaClient
let warehouseId: string
let otherWarehouseId: string

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
  const yarn = await db.yarn.create({ data: { name: '棉纱' } })
  const variant = await db.yarnVariant.create({ data: { yarnId: yarn.id, spec: '32', color: '红', unit: 'kg' } })
  const batch = await db.batch.create({ data: { variantId: variant.id, batchNo: 'B1' } })
  const warehouse = await db.warehouse.create({ data: { name: '一号仓' } })
  const other = await db.warehouse.create({ data: { name: '二号仓' } })
  warehouseId = warehouse.id
  otherWarehouseId = other.id
  const lot = await db.inventoryLot.create({ data: { lotNo: 'LOT-REAL', scanCode: 'YMS-L-REAL', variantId: variant.id, batchId: batch.id, initialWeight: 20 } })
  await db.inventory.create({ data: { warehouseId, variantId: variant.id, batchId: batch.id, lotId: lot.id, weight: 20 } })
  const otherBatch = await db.batch.create({ data: { variantId: variant.id, batchNo: 'B2' } })
  const otherLot = await db.inventoryLot.create({ data: { lotNo: 'LOT-OTHER', scanCode: 'YMS-I-REAL', variantId: variant.id, batchId: otherBatch.id, initialWeight: 10 } })
  await db.inventory.create({ data: { warehouseId: otherWarehouseId, variantId: variant.id, batchId: otherBatch.id, lotId: otherLot.id, weight: 10 } })
})

describe('sale inventory options', () => {
  it('returns only positive stock from the selected warehouse', async () => {
    const rows = await getSaleInventoryOptions(db, warehouseId)
    expect(rows).toHaveLength(1)
    expect(rows[0].warehouseId).toBe(warehouseId)
  })

  it('matches LOT and YMS codes case-insensitively and prefers selected warehouse', async () => {
    expect((await findSaleInventoryOption(db, warehouseId, 'lot-real'))?.warehouseId).toBe(warehouseId)
    expect((await findSaleInventoryOption(db, warehouseId, 'yms-i-real'))?.warehouseId).toBe(warehouseId)
    expect((await findSaleInventoryOption(db, 'missing', 'yms-i-real'))?.warehouseId).toBe(warehouseId)
    expect((await findSaleInventoryOption(db, warehouseId, 'LOT-OTHER'))?.warehouseId).toBe(otherWarehouseId)
    expect(await findSaleInventoryOption(db, 'missing', 'unknown')).toBeNull()
  })

  it('hides unsettled factory options but identifies the scan so the UI can explain the restriction', async () => {
    const factory = await db.warehouse.create({ data: { name: '加工厂', type: 'FACTORY' } })
    const row = await db.inventory.findFirstOrThrow({ where: { warehouseId } })
    await db.inventory.create({ data: { warehouseId: factory.id, variantId: row.variantId, batchId: row.batchId, lotId: row.lotId, weight: 5, processingFeeSettled: false } })
    expect(await getSaleInventoryOptions(db, factory.id)).toEqual([])
    expect((await findSaleInventoryOption(db, factory.id, 'LOT-REAL'))?.warehouseId).toBe(factory.id)
  })
})
