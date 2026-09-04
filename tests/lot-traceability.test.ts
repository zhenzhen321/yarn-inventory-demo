import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import {
  createProcessingReturn,
  createPurchase,
  createSale,
  getInventoryRows,
  settleProcessingFee,
} from '@/services/inventory'
import { getFactoryFeeSummary } from '@/services/factory-fee'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

describe('内部批次与实际成本追溯', () => {
  it('同一品种和供应商批号的两次采购不合并，销售准确指向所选成本批次', async () => {
    const base = await createBase(db)
    const first = await createPurchase(db, {
      date: new Date('2026-09-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ variantId: base.variantId, batchNo: 'SUP-88', weight: 100, price: 20, packages: 5 }],
    })
    const second = await createPurchase(db, {
      date: new Date('2026-09-02'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ variantId: base.variantId, batchNo: 'SUP-88', weight: 100, price: 25, packages: 4 }],
    })

    expect(first.items[0].lot?.id).not.toBe(second.items[0].lot?.id)
    expect(first.items[0].lot?.scanCode).not.toBe(second.items[0].lot?.scanCode)
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    expect(rows).toHaveLength(2)
    const expensive = rows.find((row) => row.lotId === second.items[0].lotId)!
    const sale = await createSale(db, {
      date: new Date('2026-09-03'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ inventoryId: expensive.id, weight: 100, price: 30 }],
    })
    const allocation = await db.saleAllocation.findFirstOrThrow({
      where: { saleItemId: sale.items[0].id },
    })
    expect(allocation.lotId).toBe(second.items[0].lotId)
    expect(allocation.unitCost.toString()).toBe('25')
    expect(allocation.packages).toBe(4)
    expect((await db.inventory.findUniqueOrThrow({ where: { id: rows.find((row) => row.lotId === first.items[0].lotId)!.id } })).weight.toString()).toBe('100')
  })

  it('有件数的批次部分销售必须填写件数，整批销售可自动带出全部剩余件数', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-09-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ variantId: base.variantId, batchNo: 'PKG-1', weight: 100, price: 20, packages: 10 }],
    })
    let row = (await getInventoryRows(db, { warehouseId: base.warehouseA }))[0]
    await expect(
      createSale(db, {
        date: new Date('2026-09-02'),
        customerId: base.customerId,
        warehouseId: base.warehouseA,
        handlerName: 'admin',
        items: [{ inventoryId: row.id, weight: 20, price: 25 }],
      }),
    ).rejects.toThrow('部分销售时必须填写本次件数')

    await createSale(db, {
      date: new Date('2026-09-02'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ inventoryId: row.id, weight: 20, price: 25, packages: 2 }],
    })
    const updatedRow = await db.inventory.findUniqueOrThrow({ where: { id: row.id } })
    expect(updatedRow.packages).toBe(8)
    const finalSale = await createSale(db, {
      date: new Date('2026-09-03'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ inventoryId: updatedRow.id, weight: 80, price: 25 }],
    })
    expect(finalSale.items[0].packages).toBe(8)
  })
})

describe('供应商直送加工厂与加工欠款', () => {
  it('直送货先处于待加工，完工后生成新成品批次且可欠费直接销售', async () => {
    const base = await createBase(db)
    const factory = await db.warehouse.create({ data: { name: '直送染厂', type: 'FACTORY' } })
    const purchase = await createPurchase(db, {
      date: new Date('2026-09-01'),
      supplierId: base.supplierId,
      warehouseId: factory.id,
      handlerName: 'admin',
      items: [{ variantId: base.variantId, batchNo: 'RAW-9', weight: 100, price: 20, packages: 10 }],
    })
    let raw = (await getInventoryRows(db, { warehouseId: factory.id }))[0]
    expect(purchase.items[0].lot?.status).toBe('AWAITING_PROCESS')
    await expect(
      createSale(db, {
        date: new Date('2026-09-01'),
        customerId: base.customerId,
        warehouseId: factory.id,
        handlerName: 'admin',
        items: [{ inventoryId: raw.id, weight: 100, price: 30, packages: 10 }],
      }),
    ).rejects.toThrow('未结算加工费')

    const completed = await settleProcessingFee(db, raw.id, {
      feePerKg: 3,
      outputWeight: 90,
      outputPackages: 9,
      color: '蓝色',
      batchNo: 'VAT-9',
      handlerName: 'admin',
    })
    expect(completed.job.weightDiff.toString()).toBe('10')
    expect(completed.outputLot.id).not.toBe(completed.inputLot.id)
    expect(completed.outputLot.processingCost.toString()).toBe('270')
    const fee = (await getFactoryFeeSummary(db)).find((row) => row.id === factory.id)!
    expect(fee.owedAmount.toString()).toBe('270')
    expect(fee.paidAmount.toString()).toBe('0')

    const finished = (await getInventoryRows(db, { warehouseId: factory.id })).find(
      (row) => row.lotId === completed.outputLot.id,
    )!
    const sale = await createSale(db, {
      date: new Date('2026-09-02'),
      customerId: base.customerId,
      warehouseId: factory.id,
      handlerName: 'admin',
      items: [{ inventoryId: finished.id, weight: 90, price: 35 }],
    })
    expect(sale.items[0].packages).toBe(9)
    expect((await getFactoryFeeSummary(db)).find((row) => row.id === factory.id)!.owedAmount.toString()).toBe('270')
  })

  it('返仓只移动同一成品批次并增加回程运费，不生成第二笔加工费', async () => {
    const base = await createBase(db)
    const factory = await db.warehouse.create({ data: { name: '返仓染厂', type: 'FACTORY' } })
    await createPurchase(db, {
      date: new Date('2026-09-01'),
      supplierId: base.supplierId,
      warehouseId: factory.id,
      handlerName: 'admin',
      freight: 20,
      items: [{ variantId: base.variantId, batchNo: 'RAW-10', weight: 100, price: 20, packages: 10 }],
    })
    const raw = (await getInventoryRows(db, { warehouseId: factory.id }))[0]
    const completed = await settleProcessingFee(db, raw.id, {
      feePerKg: 2,
      outputWeight: 95,
      outputPackages: 10,
      batchNo: 'VAT-10',
    })
    const finished = (await getInventoryRows(db, { warehouseId: factory.id })).find(
      (row) => row.lotId === completed.outputLot.id,
    )!
    await createProcessingReturn(db, {
      date: new Date('2026-09-02'),
      factoryId: factory.id,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      freight: 30,
      items: [{
        inventoryId: finished.id,
        weight: 95,
        outputWeight: 95,
        packages: 10,
        spec: finished.variant.spec,
        color: finished.variant.color,
        unit: finished.variant.unit,
        batchNo: finished.batch.batchNo,
      }],
    })
    const returned = (await getInventoryRows(db, { warehouseId: base.warehouseA }))[0]
    expect(returned.lotId).toBe(completed.outputLot.id)
    expect(returned.freight.toString()).toBe('50')
    expect(await db.processingJob.count()).toBe(1)
    expect(await db.processingFeeSettlement.count()).toBe(1)
  })
})
