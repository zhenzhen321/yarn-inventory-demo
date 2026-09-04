import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import {
  createProcessingReturn,
  createPurchase,
  createSale,
  createTransfer,
  getInventoryRows,
  settleProcessingFee,
} from '@/services/inventory'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

async function setupFactory(weight = 100) {
  const base = await createBase(db)
  const factory = await db.warehouse.create({ data: { name: '染厂', type: 'FACTORY' } })
  await createPurchase(db, {
    date: new Date('2026-08-01'),
    supplierId: base.supplierId,
    warehouseId: base.warehouseA,
    handlerName: 'admin',
    items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 1000, price: 20 }],
  })
  let rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
  await createTransfer(db, {
    date: new Date('2026-08-02'),
    fromWarehouseId: base.warehouseA,
    toWarehouseId: factory.id,
    handlerName: 'admin',
    freight: 80,
    items: [{ inventoryId: rows[0].id, weight }],
  })
  rows = await getInventoryRows(db, { warehouseId: factory.id })
  return { ...base, factoryId: factory.id, factoryRow: rows[0] }
}

describe('结算加工费', () => {
  it('整行结算：原行归零并标记已算，产出进入已算行（成本加计加工费）', async () => {
    const s = await setupFactory()
    const r = await settleProcessingFee(db, s.factoryRow.id, { feePerKg: 2 })
    expect(r.fee.toString()).toBe('2')
    expect(r.feeTotal.toString()).toBe('200')
    expect(r.remainingWeight.toString()).toBe('0')
    const all = await getInventoryRows(db, { warehouseId: s.factoryId, includeZero: true })
    const settled = all.filter((x) => x.processingFeeSettled && x.weight.greaterThan(0))
    const zeroed = await db.inventory.findUniqueOrThrow({ where: { id: s.factoryRow.id } })
    expect(settled).toHaveLength(1)
    expect(settled[0].processingFeePerKg?.toString()).toBe('2')
    expect(settled[0].cost.toString()).toBe('2200')
    expect(settled[0].weight.toString()).toBe('100')
    expect(zeroed.weight.toString()).toBe('0')
    expect(zeroed.cost.toString()).toBe('0')
    expect(zeroed.processingFeeSettled).toBe(true)
    expect(zeroed.archived).toBe(true)
    expect(r.outputLot.sourceType).toBe('PROCESSING')
    expect(r.outputLot.id).not.toBe(r.inputLot.id)
    const job = await db.processingJob.findUniqueOrThrow({
      where: { id: r.job.id },
      include: { inputs: true, outputs: true, feeSettlement: true },
    })
    expect(job.inputs[0].lotId).toBe(r.inputLot.id)
    expect(job.outputs[0].lotId).toBe(r.outputLot.id)
    expect(job.weightDiff.toString()).toBe('0')
    expect(job.feeSettlement?.feeTotal.toString()).toBe('200')
  })

  it('非加工厂/重复结算均拦截', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 100, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await expect(settleProcessingFee(db, rows[0].id, { feePerKg: 2 })).rejects.toThrow(
      '只有加工厂库存',
    )

    const s = await setupFactory()
    await settleProcessingFee(db, s.factoryRow.id, { feePerKg: 2 })
    await expect(settleProcessingFee(db, s.factoryRow.id, { feePerKg: 1 })).rejects.toThrow(
      '已完成加工核算',
    )
  })

  it('身份变化：原行归零标记已算，工厂新建新变体/批次已算行，成本重算', async () => {
    const s = await setupFactory() // 100kg，成本 2000，运费 80
    const r = await settleProcessingFee(db, s.factoryRow.id, {
      feePerKg: 2,
      spec: '20支',
      color: '紫',
      unit: 'kg',
      batchNo: 'PR-1',
      outputWeight: 80,
    })
    expect(r.identityChanged).toBe(true)
    expect(r.feeTotal.toString()).toBe('160')
    expect(r.newCost.toString()).toBe('2160')
    expect(r.newUnitCost.toString()).toBe('27')

    const rows = await getInventoryRows(db, { warehouseId: s.factoryId, includeZero: true })
    const oldRow = await db.inventory.findUniqueOrThrow({ where: { id: s.factoryRow.id } })
    const newRow = rows.find((x) => x.batch.batchNo === 'PR-1')
    expect(oldRow.weight.toString()).toBe('0')
    expect(oldRow.cost.toString()).toBe('0')
    expect(oldRow.processingFeeSettled).toBe(true)
    expect(oldRow.archived).toBe(true)
    expect(newRow?.weight.toString()).toBe('80')
    expect(newRow?.cost.toString()).toBe('2160')
    expect(newRow?.freight.toString()).toBe('80')
    expect(newRow?.processingFeeSettled).toBe(true)
    expect(newRow?.variant.spec).toBe('20支')
    expect(newRow?.variant.color).toBe('紫')
  })

  it('仅重量变化整行结算：原行归零已算，产出为独立已算行', async () => {
    const s = await setupFactory()
    await settleProcessingFee(db, s.factoryRow.id, { feePerKg: 2, outputWeight: 80 })
    const all = await getInventoryRows(db, { warehouseId: s.factoryId, includeZero: true })
    const live = all.filter((x) => x.weight.greaterThan(0))
    expect(live).toHaveLength(1)
    expect(live[0].id).not.toBe(s.factoryRow.id)
    expect(live[0].weight.toString()).toBe('80')
    expect(live[0].cost.toString()).toBe('2160')
    expect(live[0].freight.toString()).toBe('80')
    expect(live[0].processingFeeSettled).toBe(true)
    const zeroed = await db.inventory.findUniqueOrThrow({ where: { id: s.factoryRow.id } })
    expect(zeroed.weight.toString()).toBe('0')
    expect(zeroed.processingFeeSettled).toBe(true)
    expect(zeroed.archived).toBe(true)
  })

  it('部分结算：400kg 只结算 100kg，剩余 300kg 未算，已算行成本按比例+加工费', async () => {
    const s = await setupFactory(400) // 400kg，成本 8000，运费 80
    const r = await settleProcessingFee(db, s.factoryRow.id, {
      feePerKg: 2,
      inputWeight: 100,
      handlerName: 'admin',
    })
    expect(r.inputWeight.toString()).toBe('100')
    expect(r.remainingWeight.toString()).toBe('300')
    expect(r.feeTotal.toString()).toBe('200')
    expect(r.newCost.toString()).toBe('2200')
    expect(r.newUnitCost.toString()).toBe('22')

    const rows = await getInventoryRows(db, { warehouseId: s.factoryId, includeZero: true })
    const source = rows.find((x) => x.id === s.factoryRow.id)!
    const settled = rows.filter((x) => x.processingFeeSettled && x.weight.greaterThan(0))
    expect(source.weight.toString()).toBe('300')
    expect(source.cost.toString()).toBe('6000')
    expect(source.freight.toString()).toBe('60')
    expect(source.processingFeeSettled).toBe(false)
    expect(settled).toHaveLength(1)
    expect(settled[0].weight.toString()).toBe('100')
    expect(settled[0].cost.toString()).toBe('2200')
    expect(settled[0].freight.toString()).toBe('20')
    expect(settled[0].processingFeePerKg?.toString()).toBe('2')

    const recs = await db.processingFeeSettlement.findMany({
      where: { warehouseId: s.factoryId },
    })
    expect(recs).toHaveLength(1)
    expect(recs[0].inputWeight.toString()).toBe('100')
    expect(recs[0].outputWeight.toString()).toBe('100')
    expect(recs[0].feePerKg.toString()).toBe('2')
    expect(recs[0].feeTotal.toString()).toBe('200')
    expect(recs[0].remainingWeight.toString()).toBe('300')
    expect(recs[0].handlerName).toBe('admin')
  })

  it('部分结算 + 身份变化：原行保留剩余，新变体/批次已算行独立', async () => {
    const s = await setupFactory(400)
    const r = await settleProcessingFee(db, s.factoryRow.id, {
      feePerKg: 2,
      inputWeight: 100,
      spec: '20支',
      color: '紫',
      unit: 'kg',
      batchNo: 'PR-1',
      outputWeight: 80,
    })
    expect(r.identityChanged).toBe(true)
    expect(r.feeTotal.toString()).toBe('160')
    expect(r.newCost.toString()).toBe('2160')
    expect(r.newUnitCost.toString()).toBe('27')

    const rows = await getInventoryRows(db, { warehouseId: s.factoryId, includeZero: true })
    const source = rows.find((x) => x.id === s.factoryRow.id)!
    const newRow = rows.find((x) => x.batch.batchNo === 'PR-1')!
    expect(source.weight.toString()).toBe('300')
    expect(source.cost.toString()).toBe('6000')
    expect(source.processingFeeSettled).toBe(false)
    expect(newRow.weight.toString()).toBe('80')
    expect(newRow.cost.toString()).toBe('2160')
    expect(newRow.freight.toString()).toBe('20')
    expect(newRow.processingFeeSettled).toBe(true)
    expect(newRow.variant.spec).toBe('20支')
  })

  it('多次部分完工：每次生成独立成品批次，原料剩余递减', async () => {
    const s = await setupFactory(400)
    await settleProcessingFee(db, s.factoryRow.id, { feePerKg: 2, inputWeight: 100 })
    await settleProcessingFee(db, s.factoryRow.id, { feePerKg: 3, inputWeight: 150 })
    const rows = await getInventoryRows(db, { warehouseId: s.factoryId, includeZero: true })
    const source = rows.find((x) => x.id === s.factoryRow.id)!
    const settled = rows.filter((x) => x.processingFeeSettled && x.weight.greaterThan(0))
    expect(source.weight.toString()).toBe('150')
    expect(source.cost.toString()).toBe('3000')
    expect(source.freight.toString()).toBe('30')
    expect(source.processingFeeSettled).toBe(false)
    expect(settled).toHaveLength(2)
    expect(settled.map((row) => row.weight.toString()).sort()).toEqual(['100', '150'])
    expect(settled.map((row) => row.cost.toString()).sort()).toEqual(['2200', '3450'])
    expect(settled.map((row) => row.freight.toString()).sort()).toEqual(['20', '30'])
    expect(new Set(settled.map((row) => row.lotId)).size).toBe(2)
    expect(await db.processingJob.count()).toBe(2)
    expect(await db.processingFeeSettlement.count()).toBe(2)
  })

  it('拦截：本次加工重量为 0 或超过库存；加工后重量必须大于 0', async () => {
    const s = await setupFactory()
    await expect(
      settleProcessingFee(db, s.factoryRow.id, { feePerKg: 2, inputWeight: 101 }),
    ).rejects.toThrow('不能超过当前库存')
    await expect(
      settleProcessingFee(db, s.factoryRow.id, { feePerKg: 2, inputWeight: 0 }),
    ).rejects.toThrow('必须大于 0')
    await expect(
      settleProcessingFee(db, s.factoryRow.id, { feePerKg: 2, outputWeight: 0 }),
    ).rejects.toThrow('必须大于 0')
  })
})

describe('只有已算加工费的货能出加工厂', () => {
  it('调拨/卖出/加工收回拦截未算货，已算后放行', async () => {
    const s = await setupFactory()
    await expect(
      createTransfer(db, {
        date: new Date('2026-08-03'),
        fromWarehouseId: s.factoryId,
        toWarehouseId: s.warehouseB,
        handlerName: 'admin',
        items: [{ inventoryId: s.factoryRow.id, weight: 10 }],
      }),
    ).rejects.toThrow('未结算加工费')
    await expect(
      createSale(db, {
        date: new Date('2026-08-03'),
        customerId: s.customerId,
        warehouseId: s.factoryId,
        handlerName: 'admin',
        items: [{ inventoryId: s.factoryRow.id, weight: 10, price: 25 }],
      }),
    ).rejects.toThrow('未结算加工费')
    await expect(
      createProcessingReturn(db, {
        date: new Date('2026-08-03'),
        factoryId: s.factoryId,
        warehouseId: s.warehouseA,
        handlerName: 'admin',
        items: [
          {
            inventoryId: s.factoryRow.id,
            weight: 100,
            spec: '20支',
            color: '紫',
            unit: 'kg',
            batchNo: 'PR-1',
            outputWeight: 800,
          },
        ],
      }),
    ).rejects.toThrow('未结算加工费')

    await settleProcessingFee(db, s.factoryRow.id, { feePerKg: 2 })
    const settledRows = await getInventoryRows(db, { warehouseId: s.factoryId })
    const settledRow = settledRows.find((r) => r.processingFeeSettled)!
    await expect(
      createTransfer(db, {
        date: new Date('2026-08-04'),
        fromWarehouseId: s.factoryId,
        toWarehouseId: s.warehouseB,
        handlerName: 'admin',
        items: [{ inventoryId: settledRow.id, weight: 10 }],
      }),
    ).resolves.toBeTruthy()
    const rows = await getInventoryRows(db, { warehouseId: s.warehouseB })
    expect(rows[0].weight.toString()).toBe('10')
    expect(rows[0].cost.toString()).toBe('220')
  })
})
