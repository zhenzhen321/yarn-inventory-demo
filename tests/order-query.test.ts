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
  it('客户/供应商订单查询返回货款与运费', async () => {
    const base = await createBase(db)
    await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 300,
      items: [{ variantId: base.variantId, batchNo: 'G-001', weight: 1000, price: 20 }],
    })
    const rows = await getInventoryRows(db, { warehouseId: base.warehouseA })
    await createSale(db, {
      date: new Date('2026-08-05'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      freight: 50,
      items: [{ inventoryId: rows[0].id, weight: 100, price: 22 }],
    })
    const customerOrders = await getCustomerOrders(db, base.customerId)
    const supplierOrders = await getSupplierOrders(db, base.supplierId)
    expect(customerOrders).toHaveLength(1)
    expect(customerOrders[0].totalAmount.toString()).toBe('2200')
    expect(customerOrders[0].freight.toString()).toBe('50')
    expect(supplierOrders).toHaveLength(1)
    expect(supplierOrders[0].totalAmount.toString()).toBe('20000')
    expect(supplierOrders[0].freight.toString()).toBe('300')
  })
})
