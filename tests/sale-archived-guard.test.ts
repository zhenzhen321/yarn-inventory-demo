import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createPurchase, createSale, getInventoryRows } from '@/services/inventory'

let db: PrismaClient
beforeEach(async () => { db = getTestDb(); await resetDb(db) })

describe('归档库存销售保护', () => {
  it('核心销售服务拒绝直接销售已归档库存', async () => {
    const warehouse = await db.warehouse.create({ data: { name: '测试仓' } })
    const yarn = await db.yarn.create({ data: { name: '测试纱' } })
    const variant = await db.yarnVariant.create({ data: { yarnId: yarn.id, spec: '32支', color: '测试色', unit: 'kg' } })
    const supplier = await db.counterparty.create({ data: { name: '测试供应商', type: 'SUPPLIER' } })
    const customer = await db.counterparty.create({ data: { name: '测试客户', type: 'CUSTOMER' } })
    await createPurchase(db, { date: new Date('2026-09-10'), supplierId: supplier.id, warehouseId: warehouse.id, handlerName: 'clerk', items: [{ variantId: variant.id, batchNo: 'ARCH-1', weight: 10, price: 2 }] })
    const row = (await getInventoryRows(db, { warehouseId: warehouse.id }))[0]
    await db.inventory.update({ where: { id: row.id }, data: { archived: true } })
    await expect(createSale(db, { date: new Date('2026-09-10'), customerId: customer.id, warehouseId: warehouse.id, handlerName: 'clerk', items: [{ inventoryId: row.id, weight: 1, price: 3 }] })).rejects.toThrow('库存已归档')
  })
})