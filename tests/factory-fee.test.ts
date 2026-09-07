import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import {
  createPurchase,
  createTransfer,
  getInventoryRows,
  settleProcessingFee,
} from '@/services/inventory'
import {
  createFactoryFeePayment,
  getFactoryFeeSummary,
  getFactoryFeePayments,
  getFactoryStatement,
  revertFactoryFeePayment,
} from '@/services/factory-fee'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

async function setupFactory(weight = 400) {
  const base = await createBase(db)
  const factory = await db.warehouse.create({ data: { name: '染厂', type: 'FACTORY' } })
  await createPurchase(db, {
    date: new Date('2026-08-01'),
    supplierId: base.supplierId,
    warehouseId: base.warehouseA,
    handlerName: '刚',
    items: [{ variantId: base.variantId, batchNo: 'G-1', weight: 1000, price: 20 }],
  })
  let rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
  await createTransfer(db, {
    date: new Date('2026-08-02'),
    fromWarehouseId: base.warehouseA,
    toWarehouseId: factory.id,
    handlerName: '刚',
    freight: 80,
    items: [{ inventoryId: rows[0].id, weight }],
  })
  rows = await getInventoryRows(db, { warehouseId: factory.id })
  return { ...base, factoryId: factory.id, factoryRow: rows[0] }
}

describe('加工厂欠款汇总', () => {
  it('结算加工费自动计入欠款，部分结算多次累加', async () => {
    const s = await setupFactory()
    await settleProcessingFee(db, s.factoryRow.id, {
      feePerKg: 2,
      inputWeight: 100,
      handlerName: '刚',
    })
    let sum = await getFactoryFeeSummary(db)
    let f = sum.find((x) => x.id === s.factoryId)!
    expect(f.totalAmount.toString()).toBe('200')
    expect(f.paidAmount.toString()).toBe('0')
    expect(f.owedAmount.toString()).toBe('200')
    expect(f.status).toBe('UNPAID')
    expect(f.feeCount).toBe(1)

    await settleProcessingFee(db, s.factoryRow.id, {
      feePerKg: 3,
      inputWeight: 150,
      handlerName: '刚',
    })
    sum = await getFactoryFeeSummary(db)
    f = sum.find((x) => x.id === s.factoryId)!
    expect(f.totalAmount.toString()).toBe('650')
    expect(f.owedAmount.toString()).toBe('650')
    expect(f.feeCount).toBe(2)
  })
})

describe('加工费付款', () => {
  it('付款后已付/未付更新，未结状态正确', async () => {
    const s = await setupFactory()
    await settleProcessingFee(db, s.factoryRow.id, {
      feePerKg: 2,
      inputWeight: 100,
      handlerName: '刚',
    })
    const pay = await createFactoryFeePayment(db, {
      factoryId: s.factoryId,
      amount: 150,
      date: new Date('2026-08-10'),
      method: '微信',
      handlerName: '萍',
    })
    expect(pay.amount.toString()).toBe('150')
    const f = (await getFactoryFeeSummary(db)).find((x) => x.id === s.factoryId)!
    expect(f.paidAmount.toString()).toBe('150')
    expect(f.owedAmount.toString()).toBe('50')
    expect(f.status).toBe('PARTIAL')
    const records = await getFactoryFeePayments(db)
    expect(records).toHaveLength(1)
    expect(records[0].factoryName).toBe('染厂')
    expect(records[0].handlerName).toBe('萍')
  })

  it('超付拦截；非加工厂拦截', async () => {
    const s = await setupFactory()
    await settleProcessingFee(db, s.factoryRow.id, {
      feePerKg: 2,
      inputWeight: 100,
      handlerName: '刚',
    })
    await expect(
      createFactoryFeePayment(db, {
        factoryId: s.factoryId,
        amount: 201,
        date: new Date('2026-08-10'),
        handlerName: '刚',
      }),
    ).rejects.toThrow('超过未结金额')
    await expect(
      createFactoryFeePayment(db, {
        factoryId: s.warehouseA,
        amount: 10,
        date: new Date('2026-08-10'),
        handlerName: '刚',
      }),
    ).rejects.toThrow('加工厂不存在')
  })

  it('撤回付款后欠款恢复', async () => {
    const s = await setupFactory()
    await settleProcessingFee(db, s.factoryRow.id, {
      feePerKg: 2,
      inputWeight: 100,
      handlerName: '刚',
    })
    const pay = await createFactoryFeePayment(db, {
      factoryId: s.factoryId,
      amount: 100,
      date: new Date('2026-08-10'),
      handlerName: '刚',
    })
    const deleted = await revertFactoryFeePayment(db, pay.id)
    expect(deleted.id).toBe(pay.id)
    const f = (await getFactoryFeeSummary(db)).find((x) => x.id === s.factoryId)!
    expect(f.paidAmount.toString()).toBe('0')
    expect(f.owedAmount.toString()).toBe('200')
  })
})

describe('加工厂对账单', () => {
  it('合并加工费发生与付款，按日期累计应付余额', async () => {
    const s = await setupFactory()
    await settleProcessingFee(db, s.factoryRow.id, {
      feePerKg: 2,
      inputWeight: 100,
      handlerName: '刚',
    })
    await createFactoryFeePayment(db, {
      factoryId: s.factoryId,
      amount: 50,
      date: new Date('2026-08-10'),
      handlerName: '萍',
    })
    const rows = await getFactoryStatement(db, s.factoryId)
    expect(rows).toHaveLength(2)
    const feeRow = rows.find((r) => r.type === '加工费')!
    const payRow = rows.find((r) => r.type === '付款')!
    expect(feeRow.amount.toString()).toBe('200')
    expect(feeRow.yarnName).toBe('棉纱')
    expect(feeRow.lots).toHaveLength(1)
    expect(feeRow.lots[0].lotNo).toMatch(/^LOT-/)
    expect(payRow.amount.toString()).toBe('-50')
    expect(rows[rows.length - 1].balance.toString()).toBe('150')
  })
})
