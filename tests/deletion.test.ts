import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import {
  createPurchase,
  createProcessingReturn,
  createTransfer,
  getInventoryRows,
  settleProcessingFee,
} from '@/services/inventory'
import {
  deleteCounterpartySafe,
  deleteWarehouseSafe,
  deleteYarnSafe,
  deleteYarnVariantSafe,
} from '@/services/deletion'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

describe('删除安全检测', () => {
  it('未引用的仓库可以删除', async () => {
    const w = await db.warehouse.create({ data: { name: '空仓' } })
    await expect(deleteWarehouseSafe(db, w.id)).resolves.toBeTruthy()
  })

  it('被买入/卖出/调拨/盘库/库存引用的仓库拒绝删除', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    await expect(deleteWarehouseSafe(db, base.warehouseA)).rejects.toThrow('已被使用')
  })

  it('未引用的往来单位可以删除，被引用则拒绝', async () => {
    const base = await createBase(db)
    const free = await db.counterparty.create({ data: { name: '空单位', type: 'CUSTOMER' } })
    await expect(deleteCounterpartySafe(db, free.id)).resolves.toBeTruthy()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    await expect(deleteCounterpartySafe(db, base.supplierId)).rejects.toThrow('已被使用')
  })

  it('未引用变体可删除（含其批次），被引用变体拒绝', async () => {
    const base = await createBase(db)
    const free = await db.yarnVariant.create({
      data: { yarnId: base.yarnId, spec: '21支', color: '灰色', unit: 'kg' },
    })
    await expect(deleteYarnVariantSafe(db, free.id)).resolves.toBeTruthy()
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    await expect(deleteYarnVariantSafe(db, base.variantId)).rejects.toThrow('已被使用')
  })

  it('纱线：无变体或变体全未引用可删除，任一变体被引用则整体拒绝', async () => {
    const base = await createBase(db)
    const empty = await db.yarn.create({ data: { name: '空纱' } })
    await expect(deleteYarnSafe(db, empty.id)).resolves.toBeTruthy()

    const freeYarn = await db.yarn.create({ data: { name: '自由纱' } })
    await db.yarnVariant.create({
      data: { yarnId: freeYarn.id, spec: '10支', color: '白色', unit: 'kg' },
    })
    await expect(deleteYarnSafe(db, freeYarn.id)).resolves.toBeTruthy()

    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 }],
    })
    await expect(deleteYarnSafe(db, base.yarnId)).rejects.toThrow('已被业务使用')
  })

  it('加工收回生成的新变体被库存引用，拒绝删除', async () => {
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
    const ret = await createProcessingReturn(db, {
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
    await expect(deleteYarnVariantSafe(db, ret.items[0].variantId)).rejects.toThrow('已被使用')
  })

  it('有加工费结算记录的仓库拒绝删除', async () => {
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
    await expect(deleteWarehouseSafe(db, factory.id)).rejects.toThrow('加工费')
  })
})
