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
import {
  createFactoryFeePayment,
  getFactoryFeeSummary,
} from '@/services/factory-fee'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

describe('完整加工业务后台案例', () => {
  it('采购入仓→部分送厂→完工重称→欠费返仓及直销→后续付款', async () => {
    const base = await createBase(db)
    const factory = await db.warehouse.create({
      data: { name: '示例染厂', type: 'FACTORY' },
    })

    const purchase = await createPurchase(db, {
      date: new Date('2026-09-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      freight: 500,
      items: [
        {
          variantId: base.variantId,
          batchNo: 'RAW-EXAMPLE-001',
          weight: 1000,
          packages: 40,
          price: 20,
        },
      ],
    })
    const rawLotId = purchase.items[0].lotId!
    let warehouseRaw = (await getInventoryRows(db, { warehouseId: base.warehouseA }))[0]

    await createTransfer(db, {
      date: new Date('2026-09-02'),
      fromWarehouseId: base.warehouseA,
      toWarehouseId: factory.id,
      handlerName: 'admin',
      freight: 300,
      items: [{ inventoryId: warehouseRaw.id, weight: 600, packages: 24 }],
    })

    warehouseRaw = (await getInventoryRows(db, { warehouseId: base.warehouseA }))[0]
    expect(warehouseRaw.weight.toString()).toBe('400')
    expect(warehouseRaw.packages).toBe(16)
    expect(warehouseRaw.cost.toString()).toBe('8000')
    expect(warehouseRaw.freight.toString()).toBe('200')

    const factoryRaw = (await getInventoryRows(db, { warehouseId: factory.id }))[0]
    expect(factoryRaw.weight.toString()).toBe('600')
    expect(factoryRaw.packages).toBe(24)
    expect(factoryRaw.cost.toString()).toBe('12000')
    expect(factoryRaw.freight.toString()).toBe('600')
    expect(factoryRaw.processingFeeSettled).toBe(false)

    await expect(
      createSale(db, {
        date: new Date('2026-09-02'),
        customerId: base.customerId,
        warehouseId: factory.id,
        handlerName: 'admin',
        items: [{ inventoryId: factoryRaw.id, weight: 600, packages: 24, price: 35 }],
      }),
    ).rejects.toThrow('未结算加工费')
    expect(await db.saleOrder.count()).toBe(0)

    const completed = await settleProcessingFee(db, factoryRaw.id, {
      date: new Date('2026-09-03'),
      inputWeight: 600,
      inputPackages: 24,
      outputWeight: 570,
      outputPackages: 23,
      feePerKg: 4,
      spec: '32支',
      color: '藏青',
      unit: 'kg',
      batchNo: 'DYED-EXAMPLE-001',
      handlerName: 'clerk',
      note: '完整后台测试案例',
    })

    expect(completed.job.inputWeight.toString()).toBe('600')
    expect(completed.job.outputWeight.toString()).toBe('570')
    expect(completed.job.weightDiff.toString()).toBe('30')
    expect(completed.job.feeTotal.toString()).toBe('2280')
    expect(completed.outputLot.id).not.toBe(rawLotId)
    expect(completed.outputLot.sourceType).toBe('PROCESSING')

    let feeSummary = (await getFactoryFeeSummary(db)).find(
      (row) => row.id === factory.id,
    )!
    expect(feeSummary.totalAmount.toString()).toBe('2280')
    expect(feeSummary.paidAmount.toString()).toBe('0')
    expect(feeSummary.owedAmount.toString()).toBe('2280')

    let factoryFinished = (await getInventoryRows(db, { warehouseId: factory.id })).find(
      (row) => row.lotId === completed.outputLot.id,
    )!
    expect(factoryFinished.weight.toString()).toBe('570')
    expect(factoryFinished.packages).toBe(23)
    expect(factoryFinished.cost.toString()).toBe('14280')
    expect(factoryFinished.freight.toString()).toBe('600')
    expect(factoryFinished.processingFeeSettled).toBe(true)

    await createProcessingReturn(db, {
      date: new Date('2026-09-04'),
      factoryId: factory.id,
      warehouseId: base.warehouseA,
      handlerName: 'admin',
      freight: 150,
      items: [
        {
          inventoryId: factoryFinished.id,
          weight: 400,
          outputWeight: 400,
          packages: 16,
          spec: factoryFinished.variant.spec,
          color: factoryFinished.variant.color,
          unit: factoryFinished.variant.unit,
          batchNo: factoryFinished.batch.batchNo,
        },
      ],
    })

    const returned = (await getInventoryRows(db, { warehouseId: base.warehouseA })).find(
      (row) => row.lotId === completed.outputLot.id,
    )!
    expect(returned.weight.toString()).toBe('400')
    expect(returned.packages).toBe(16)
    expect(returned.cost.toString()).toBe('10021.05')
    expect(returned.freight.toString()).toBe('571.05')

    factoryFinished = (await getInventoryRows(db, { warehouseId: factory.id })).find(
      (row) => row.lotId === completed.outputLot.id,
    )!
    expect(factoryFinished.weight.toString()).toBe('170')
    expect(factoryFinished.packages).toBe(7)
    expect(factoryFinished.cost.toString()).toBe('4258.95')
    expect(factoryFinished.freight.toString()).toBe('178.95')

    const directSale = await createSale(db, {
      date: new Date('2026-09-05'),
      customerId: base.customerId,
      warehouseId: factory.id,
      handlerName: 'clerk',
      items: [{ inventoryId: factoryFinished.id, weight: 170, price: 35 }],
    })
    expect(directSale.totalAmount.toString()).toBe('5950')
    expect(directSale.items[0].packages).toBe(7)
    expect(directSale.items[0].allocations[0].lotId).toBe(completed.outputLot.id)

    feeSummary = (await getFactoryFeeSummary(db)).find((row) => row.id === factory.id)!
    expect(feeSummary.owedAmount.toString()).toBe('2280')

    await createFactoryFeePayment(db, {
      factoryId: factory.id,
      amount: 1000,
      date: new Date('2026-09-20'),
      method: '银行转账',
      handlerName: 'admin',
    })
    feeSummary = (await getFactoryFeeSummary(db)).find((row) => row.id === factory.id)!
    expect(feeSummary.paidAmount.toString()).toBe('1000')
    expect(feeSummary.owedAmount.toString()).toBe('1280')

    const processingJob = await db.processingJob.findUniqueOrThrow({
      where: { id: completed.job.id },
      include: { inputs: true, outputs: true, feeSettlement: true },
    })
    expect(processingJob.inputs.map((input) => input.lotId)).toEqual([rawLotId])
    expect(processingJob.outputs.map((output) => output.lotId)).toEqual([
      completed.outputLot.id,
    ])
    expect(processingJob.feeSettlement?.feeTotal.toString()).toBe('2280')

    const rawMovements = await db.stockMovement.findMany({ where: { lotId: rawLotId } })
    const finishedMovements = await db.stockMovement.findMany({
      where: { lotId: completed.outputLot.id },
    })
    expect(rawMovements.map((movement) => movement.type).sort()).toEqual(
      ['PROCESS_CONSUME', 'PURCHASE_RECEIPT', 'TRANSFER'].sort(),
    )
    expect(finishedMovements.map((movement) => movement.type).sort()).toEqual(
      ['PROCESS_PRODUCE', 'SALE', 'TRANSFER'].sort(),
    )

    console.info('完整加工案例结果', {
      purchaseWeight: 1000,
      sentToFactory: 600,
      rawLeftInWarehouse: 400,
      finishedWeight: 570,
      lossWeight: 30,
      processingFee: 2280,
      returnedWeight: 400,
      factoryDirectSaleWeight: 170,
      paidLater: 1000,
      feeStillOwed: 1280,
      rawMovementCount: rawMovements.length,
      finishedMovementCount: finishedMovements.length,
    })
  })
})
