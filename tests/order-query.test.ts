import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import { createPurchase, createSale, getInventoryRows } from '@/services/inventory'
import { getCustomerOrders, getSupplierOrders } from '@/services/reports'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

describe('订单查询', () => {
  it('客户/供应商订单查询返回汇总、备注与完整货品明细', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      note: '采购备注',
      freight: 300,
      items: [{
        variantId: base.variantId,
        batchNo: 'G-001',
        weight: 1000,
        price: 20,
        packages: 40,
      }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-05'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      note: '销售备注',
      freight: 50,
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22, packages: 4 }],
    })
    const customerOrders = await getCustomerOrders(db, base.customerId)
    const supplierOrders = await getSupplierOrders(db, base.supplierId)
    expect(customerOrders).toHaveLength(1)
    expect(customerOrders[0].totalAmount.toString()).toBe('2200')
    expect(customerOrders[0].freight.toString()).toBe('50')
    expect(customerOrders[0].note).toBe('销售备注')
    expect(customerOrders[0].items).toHaveLength(1)
    expect(customerOrders[0].items[0]).toMatchObject({
      yarnName: '棉纱',
      spec: '32支',
      color: '白色',
      unit: 'kg',
      batchNo: 'G-001',
      packages: 4,
    })
    expect(customerOrders[0].items[0].weight.toString()).toBe('100')
    expect(customerOrders[0].items[0].price.toString()).toBe('22')
    expect(customerOrders[0].items[0].amount.toString()).toBe('2200')
    expect(supplierOrders).toHaveLength(1)
    expect(supplierOrders[0].totalAmount.toString()).toBe('20000')
    expect(supplierOrders[0].freight.toString()).toBe('300')
    expect(supplierOrders[0].note).toBe('采购备注')
    expect(supplierOrders[0].items).toHaveLength(1)
    expect(supplierOrders[0].items[0]).toMatchObject({
      yarnName: '棉纱',
      spec: '32支',
      color: '白色',
      unit: 'kg',
      batchNo: 'G-001',
      packages: 40,
    })
    expect(supplierOrders[0].items[0].weight.toString()).toBe('1000')
    expect(supplierOrders[0].items[0].price.toString()).toBe('20')
    expect(supplierOrders[0].items[0].amount.toString()).toBe('20000')
  })
})
