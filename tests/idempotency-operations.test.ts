import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createBase } from './helpers/base'
import { getTestDb, resetDb } from './helpers/db'
import {
  completeProcessingJobIdempotent,
  createProcessingReturnIdempotent,
  createPurchase,
  createSaleIdempotent,
  createStocktakeIdempotent,
  createTransfer,
  createTransferIdempotent,
  getInventoryRows,
} from '@/services/inventory'
import { createSettlementIdempotent } from '@/services/settlement'
import { createFactoryFeePaymentIdempotent } from '@/services/factory-fee'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

describe('各类业务写入统一幂等', () => {
  it('销售、调拨、盘点、加工、返仓和两类结算均能重放首次结果', async () => {
    const base = await createBase(db)
    const factory = await db.warehouse.create({ data: { name: '幂等染厂', type: 'FACTORY' } })
    await createPurchase(db, {
      date: new Date('2026-09-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'BASE', weight: 500, price: 20 }],
    })
    let warehouseA = await getInventoryRows(db, { warehouseId: base.warehouseA })

    const saleInput = {
      date: new Date('2026-09-02'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ inventoryId: warehouseA[0].id, weight: 20, price: 25 }],
    }
    const sale1 = await createSaleIdempotent(db, saleInput, 'idem-sale')
    const sale2 = await createSaleIdempotent(db, saleInput, 'idem-sale')
    expect(sale2.value.id).toBe(sale1.value.id)
    expect(sale2.replayed).toBe(true)

    warehouseA = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const transferInput = {
      date: new Date('2026-09-02'),
      fromWarehouseId: base.warehouseA,
      toWarehouseId: base.warehouseB,
      handlerName: '刚',
      items: [{ inventoryId: warehouseA[0].id, weight: 100 }],
    }
    const transfer1 = await createTransferIdempotent(db, transferInput, 'idem-transfer')
    const transfer2 = await createTransferIdempotent(db, transferInput, 'idem-transfer')
    expect(transfer2.value.id).toBe(transfer1.value.id)
    expect(transfer2.replayed).toBe(true)

    const warehouseB = await getInventoryRows(db, { warehouseId: base.warehouseB })
    const stocktakeInput = {
      date: new Date('2026-09-03'),
      warehouseId: base.warehouseB,
      handlerName: '萍',
      items: [{ inventoryId: warehouseB[0].id, actualWeight: 90 }],
    }
    const stocktake1 = await createStocktakeIdempotent(db, stocktakeInput, 'idem-stocktake')
    const stocktake2 = await createStocktakeIdempotent(db, stocktakeInput, 'idem-stocktake')
    expect(stocktake2.value.id).toBe(stocktake1.value.id)
    expect(stocktake2.replayed).toBe(true)

    await createPurchase(db, {
      date: new Date('2026-09-03'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'RAW', weight: 100, price: 10 }],
    })
    warehouseA = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const raw = warehouseA.find((row) => row.batch.batchNo === 'RAW')!
    await createTransfer(db, {
      date: new Date('2026-09-03'),
      fromWarehouseId: base.warehouseA,
      toWarehouseId: factory.id,
      handlerName: '刚',
      items: [{ inventoryId: raw.id, weight: 100 }],
    })
    const factoryInputs = await getInventoryRows(db, { warehouseId: factory.id })
    const processingInput = {
      date: new Date('2026-09-04'),
      factoryId: factory.id,
      handlerName: '刚',
      feePerKg: 2,
      inputs: [{ inventoryId: factoryInputs[0].id, weight: 100 }],
      outputs: [{
        yarnId: base.yarnId,
        spec: '40支',
        color: '藏蓝',
        unit: 'kg',
        batchNo: 'FINISHED',
        weight: 95,
      }],
    }
    const job1 = await completeProcessingJobIdempotent(db, processingInput, 'idem-processing')
    const job2 = await completeProcessingJobIdempotent(db, processingInput, 'idem-processing')
    expect(job2.value.id).toBe(job1.value.id)
    expect(job2.replayed).toBe(true)

    const outputInventory = job1.value.outputs[0].inventory
    const returnInput = {
      date: new Date('2026-09-05'),
      factoryId: factory.id,
      warehouseId: base.warehouseB,
      handlerName: '萍',
      items: [{
        inventoryId: outputInventory.id,
        weight: 95,
        spec: outputInventory.variant.spec,
        color: outputInventory.variant.color,
        unit: outputInventory.variant.unit,
        batchNo: outputInventory.batch.batchNo,
        outputWeight: 95,
      }],
    }
    const return1 = await createProcessingReturnIdempotent(db, returnInput, 'idem-return')
    const return2 = await createProcessingReturnIdempotent(db, returnInput, 'idem-return')
    expect(return2.value.id).toBe(return1.value.id)
    expect(return2.replayed).toBe(true)

    await db.inventory.update({
      where: { id: outputInventory.id },
      data: { archived: true },
    })
    const jobAfterReturn = await completeProcessingJobIdempotent(
      db,
      processingInput,
      'idem-processing',
    )
    expect(jobAfterReturn.value.id).toBe(job1.value.id)
    expect(jobAfterReturn.replayed).toBe(true)

    const settlementInput = {
      side: 'PURCHASE' as const,
      counterpartyId: base.supplierId,
      amount: 50,
      date: new Date('2026-09-05'),
      handlerName: '刚',
    }
    const settlement1 = await createSettlementIdempotent(db, settlementInput, 'idem-settlement')
    const settlement2 = await createSettlementIdempotent(db, settlementInput, 'idem-settlement')
    expect(settlement2.value.id).toBe(settlement1.value.id)
    expect(settlement2.replayed).toBe(true)

    const paymentInput = {
      factoryId: factory.id,
      amount: 10,
      date: new Date('2026-09-05'),
      handlerName: '刚',
    }
    const payment1 = await createFactoryFeePaymentIdempotent(db, paymentInput, 'idem-fee-payment')
    const payment2 = await createFactoryFeePaymentIdempotent(db, paymentInput, 'idem-fee-payment')
    expect(payment2.value.id).toBe(payment1.value.id)
    expect(payment2.replayed).toBe(true)

    expect(await db.saleOrder.count()).toBe(1)
    expect(await db.transferOrder.count()).toBe(2)
    expect(await db.stocktake.count()).toBe(1)
    expect(await db.processingJob.count()).toBe(1)
    expect(await db.processingReturn.count()).toBe(1)
    expect(await db.settlement.count()).toBe(1)
    expect(await db.processingFeePayment.count()).toBe(1)
    expect(await db.idempotencyRequest.count()).toBe(7)
  })
})
