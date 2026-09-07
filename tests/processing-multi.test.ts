import { beforeEach, describe, expect, it } from 'vitest'
import { Prisma, type PrismaClient } from '@prisma/client'
import { createBase } from './helpers/base'
import { getTestDb, resetDb } from './helpers/db'
import {
  completeProcessingJob,
  createPurchase,
  createTransfer,
  getInventoryRows,
} from '@/services/inventory'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

async function setupFactoryInputs(weights: number[]) {
  const base = await createBase(db)
  const factory = await db.warehouse.create({ data: { name: '多批次染厂', type: 'FACTORY' } })
  await createPurchase(db, {
    date: new Date('2026-09-01'),
    supplierId: base.supplierId,
    warehouseId: base.warehouseA,
    handlerName: '刚',
    freight: 30,
    items: weights.map((weight, index) => ({
      variantId: base.variantId,
      batchNo: `RAW-${index + 1}`,
      weight,
      price: 10 + index,
    })),
  })
  const source = await getInventoryRows(db, { warehouseId: base.warehouseA })
  await createTransfer(db, {
    date: new Date('2026-09-02'),
    fromWarehouseId: base.warehouseA,
    toWarehouseId: factory.id,
    handlerName: '刚',
    freight: 20,
    items: source.map((row) => ({ inventoryId: row.id, weight: Number(row.weight) })),
  })
  const inputs = await getInventoryRows(db, { warehouseId: factory.id })
  return { ...base, factoryId: factory.id, inputs }
}

function sum(values: Prisma.Decimal[]) {
  return values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0))
}

describe('多投入多产出加工完工', () => {
  it('支持多投入一产出并可从成品追溯全部投入', async () => {
    const s = await setupFactoryInputs([60, 40])
    const result = await completeProcessingJob(db, {
      date: new Date('2026-09-03'),
      factoryId: s.factoryId,
      handlerName: '刚',
      feePerKg: 2,
      inputs: s.inputs.map((row) => ({ inventoryId: row.id, weight: Number(row.weight) })),
      outputs: [{
        yarnId: s.yarnId,
        spec: '40支',
        color: '蓝色',
        unit: 'kg',
        batchNo: 'OUT-MERGED',
        weight: 95,
      }],
    })
    expect(result.job.inputs).toHaveLength(2)
    expect(result.job.outputs).toHaveLength(1)
    const traced = await db.processingOutput.findUniqueOrThrow({
      where: { lotId: result.outputs[0].lot.id },
      include: { job: { include: { inputs: { include: { lot: true } } } } },
    })
    expect(traced.job.inputs).toHaveLength(2)
    expect(new Set(traced.job.inputs.map((input) => input.lotId))).toEqual(
      new Set(s.inputs.map((input) => input.lotId)),
    )
  })

  it('支持一投入多产出，分币后各成本池仍精确守恒', async () => {
    const s = await setupFactoryInputs([100])
    const result = await completeProcessingJob(db, {
      date: new Date('2026-09-03'),
      factoryId: s.factoryId,
      handlerName: '刚',
      feePerKg: 1.23,
      additionalFreight: 10.01,
      otherCost: 7.01,
      inputs: [{ inventoryId: s.inputs[0].id, weight: 100 }],
      outputs: [
        { yarnId: s.yarnId, spec: '40支', color: '红', unit: 'kg', batchNo: 'OUT-A', weight: 33.33 },
        { yarnId: s.yarnId, spec: '40支', color: '蓝', unit: 'kg', batchNo: 'OUT-B', weight: 33.33 },
        { yarnId: s.yarnId, spec: '40支', color: '绿', unit: 'kg', batchNo: 'OUT-C', weight: 33.34 },
      ],
    })
    const outputs = result.job.outputs
    expect(sum(outputs.map((row) => row.allocatedGoodsCost)).toString()).toBe('1000')
    expect(sum(outputs.map((row) => row.allocatedFreight)).toString()).toBe('60.01')
    expect(sum(outputs.map((row) => row.allocatedProcessingCost)).toString()).toBe('123')
    expect(sum(outputs.map((row) => row.allocatedOtherCost)).toString()).toBe('7.01')
    expect(result.job.costAllocationBasis).toBe('OUTPUT_WEIGHT')
  })

  it('支持多投入多产出且产出库存总成本等于全部投入和新增费用', async () => {
    const s = await setupFactoryInputs([70, 30])
    const result = await completeProcessingJob(db, {
      date: new Date('2026-09-03'),
      factoryId: s.factoryId,
      handlerName: '萍',
      feePerKg: 2,
      otherCost: 5,
      inputs: s.inputs.map((row) => ({ inventoryId: row.id, weight: Number(row.weight) })),
      outputs: [
        { yarnId: s.yarnId, spec: '48支', color: '深蓝', unit: 'kg', batchNo: 'MM-A', weight: 50 },
        { yarnId: s.yarnId, spec: '48支', color: '浅蓝', unit: 'kg', batchNo: 'MM-B', weight: 45 },
      ],
    })
    expect(result.job.inputs).toHaveLength(2)
    expect(result.job.outputs).toHaveLength(2)
    const inventories = await db.inventory.findMany({
      where: { id: { in: result.outputs.map((output) => output.inventory.id) } },
    })
    expect(sum(inventories.map((row) => row.cost)).toString()).toBe('1225')
    expect(sum(inventories.map((row) => row.freight)).toString()).toBe('50')
  })
})
