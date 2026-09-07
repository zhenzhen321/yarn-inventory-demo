import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import { createPurchase, createSale, getInventoryRows } from '@/services/inventory'
import {
  createSettlement,
  getDiscountByCounterparty,
  getCounterpartyStatement,
  getPayableSummary,
  getReceivableSummary,
  getSettlementRecords,
} from '@/services/settlement'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

async function setupBoth() {
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
    handlerName: '爸爸',
    items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
  })
  return base
}

describe('按往来单位结算', () => {
  it('登记多笔结算并正确汇总', async () => {
    const base = await setupBoth()
    await createSettlement(db, {
      side: 'PURCHASE',
      counterpartyId: base.supplierId,
      amount: 5000,
      date: new Date('2026-08-08'),
      handlerName: '妈妈',
    })
    await createSettlement(db, {
      side: 'PURCHASE',
      counterpartyId: base.supplierId,
      amount: 5000,
      date: new Date('2026-08-09'),
      handlerName: '妈妈',
    })
    await createSettlement(db, {
      side: 'PURCHASE',
      counterpartyId: base.supplierId,
      amount: 10000,
      date: new Date('2026-08-10'),
      handlerName: '妈妈',
    })
    const payables = await getPayableSummary(db)
    expect(payables).toHaveLength(1)
    expect(payables[0].totalAmount.toString()).toBe('20000')
    expect(payables[0].settledAmount.toString()).toBe('20000')
    expect(payables[0].remainingAmount.toString()).toBe('0')
    expect(payables[0].status).toBe('PAID')

    const records = await getSettlementRecords(db, { counterpartyId: base.supplierId })
    expect(records).toHaveLength(3)
    expect(records.map((r) => r.amount.toString())).toEqual(['10000', '5000', '5000'])
  })

  it('超结拦截按往来单位', async () => {
    const base = await setupBoth()
    await createSettlement(db, {
      side: 'PURCHASE',
      counterpartyId: base.supplierId,
      amount: 20000,
      date: new Date('2026-08-08'),
      handlerName: '妈妈',
    })
    await expect(
      createSettlement(db, {
        side: 'PURCHASE',
        counterpartyId: base.supplierId,
        amount: 1,
        date: new Date('2026-08-09'),
        handlerName: '妈妈',
      }),
    ).rejects.toThrow('超过未结金额')
  })

  it('应收应付汇总与状态正确', async () => {
    const base = await setupBoth()
    await createSettlement(db, {
      side: 'SALE',
      counterpartyId: base.customerId,
      amount: 1000,
      date: new Date('2026-08-09'),
      handlerName: '妈妈',
    })
    const receivables = await getReceivableSummary(db)
    expect(receivables).toHaveLength(1)
    expect(receivables[0].totalAmount.toString()).toBe('2200')
    expect(receivables[0].remainingAmount.toString()).toBe('1200')
    expect(receivables[0].status).toBe('PARTIAL')
  })
})

describe('往来单位对账单', () => {
  it('按时间顺序合并订单与结算并累计余额', async () => {
    const base = await setupBoth()
    await createSettlement(db, {
      side: 'PURCHASE',
      counterpartyId: base.supplierId,
      amount: 5000,
      date: new Date('2026-08-08'),
      handlerName: '妈妈',
    })
    await createSettlement(db, {
      side: 'SALE',
      counterpartyId: base.customerId,
      amount: 1000,
      date: new Date('2026-08-09'),
      handlerName: '妈妈',
    })

    const s1 = await getCounterpartyStatement(db, base.supplierId)
    expect(s1).toHaveLength(2)
    expect(s1[0].type).toBe('买入')
    expect(s1[0].yarnName).toBe('棉纱')
    expect(s1[0].spec).toBe('32支')
    expect(s1[0].color).toBe('白色')
    expect(s1[0].batchNo).toBe('G-001')
    expect(s1[0].lots).toHaveLength(1)
    expect(s1[0].lots[0].id).toBeTruthy()
    expect(s1[0].lots[0].lotNo).toMatch(/^LOT-/)
    expect(s1[0].weight?.toString()).toBe('1000')
    expect(s1[0].price?.toString()).toBe('20')
    expect(s1[0].amount.toString()).toBe('20000')
    expect(s1[0].payableBalance.toString()).toBe('20000')
    expect(s1[1].type).toBe('付款')
    expect(s1[1].amount.toString()).toBe('-5000')
    expect(s1[1].payableBalance.toString()).toBe('15000')

    const s2 = await getCounterpartyStatement(db, base.customerId)
    expect(s2).toHaveLength(2)
    expect(s2[0].type).toBe('卖出')
    expect(s2[0].lots).toEqual(s1[0].lots)
    expect(s2[0].receivableBalance.toString()).toBe('2200')
    expect(s2[1].type).toBe('收款')
    expect(s2[1].receivableBalance.toString()).toBe('1200')
  })

  it('一张单含多个色号/批次时逐明细展开，余额按整单累计一次', async () => {
    const base = await createBase(db)
    const other = await db.yarnVariant.create({
      data: { yarnId: base.yarnId, spec: '32支', color: '蓝色', unit: 'kg' },
    })
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [
        { variantId: base.variantId, batchNo: 'G-001', weight: 100, price: 20 },
        { variantId: other.id, batchNo: 'G-002', weight: 50, price: 18 },
      ],
    })
    const rows = await getCounterpartyStatement(db, base.supplierId)
    expect(rows).toHaveLength(2)
    expect(rows[0].color).toBe('白色')
    expect(rows[0].batchNo).toBe('G-001')
    expect(rows[0].amount.toString()).toBe('2000')
    expect(rows[1].color).toBe('蓝色')
    expect(rows[1].batchNo).toBe('G-002')
    expect(rows[1].amount.toString()).toBe('900')
    // 余额逐行累计：第一行 2000，第二行 2000+900=2900
    expect(rows[0].payableBalance.toString()).toBe('2000')
    expect(rows[1].payableBalance.toString()).toBe('2900')
  })
})

describe('折让结算', () => {
  it('SALE 折让抵扣应收，折让汇总只统计方式为折让的记录', async () => {
    const base = await setupBoth() // 卖出 2200
    await createSettlement(db, {
      side: 'SALE',
      counterpartyId: base.customerId,
      amount: 500,
      date: new Date('2026-08-09'),
      method: '折让',
      handlerName: '萍',
    })
    await createSettlement(db, {
      side: 'SALE',
      counterpartyId: base.customerId,
      amount: 1000,
      date: new Date('2026-08-10'),
      method: '微信',
      handlerName: '刚',
    })

    const receivables = await getReceivableSummary(db)
    expect(receivables[0].totalAmount.toString()).toBe('2200')
    expect(receivables[0].settledAmount.toString()).toBe('1500')
    expect(receivables[0].remainingAmount.toString()).toBe('700')

    const map = await getDiscountByCounterparty(db)
    const d = map.get(base.customerId)
    expect(d?.total.toString()).toBe('500')
    expect(d?.records).toHaveLength(1)
    expect(d?.records[0].amount.toString()).toBe('500')
    expect(d?.records[0].handlerName).toBe('萍')
  })
})
