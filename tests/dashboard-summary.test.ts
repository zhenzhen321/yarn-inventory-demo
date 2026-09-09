import { beforeEach, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import { createPurchase } from '@/services/inventory'
import { getDashboardInventory } from '@/services/dashboard'
import { getInventoryValuation } from '@/services/reports'

let db: PrismaClient
beforeEach(async () => { db = getTestDb(); await resetDb(db) })

it('matches original dashboard populations including archived/zero balances and distinct internal lots', async () => {
  const base = await createBase(db)
  for (const [warehouseId, batchNo, weight, price] of [
    [base.warehouseA, 'same', 10, 2.33], [base.warehouseA, 'same', 20, 3.12],
    [base.warehouseB, 'zero', 3, 1], [base.warehouseB, 'archive', 5, 2],
  ] as const) await createPurchase(db, {
    date: new Date('2026-09-10'), supplierId: base.supplierId, warehouseId, handlerName: '刚',
    items: [{ variantId: base.variantId, batchNo, weight, price }],
  })
  const zero = await db.inventory.findFirstOrThrow({ where: { batch: { batchNo: 'zero' } } })
  await db.inventory.update({ where: { id: zero.id }, data: { weight: 0 } })
  const archived = await db.inventory.findFirstOrThrow({ where: { batch: { batchNo: 'archive' } } })
  await db.inventory.update({ where: { id: archived.id }, data: { archived: true } })
  const all = await db.inventory.findMany({ where: { archived: false, weight: { gt: 0 } } })
  const valuation = await getInventoryValuation(db)
  const actual = await getDashboardInventory(db)
  const warehouses = await db.warehouse.findMany()
  expect(actual.balanceCount).toBe(all.length)
  for (const warehouse of warehouses) {
    const rows = all.filter(row => row.warehouseId === warehouse.id)
    expect(actual.byWarehouse.get(warehouse.id)).toEqual({
      weight: rows.reduce((sum, row) => sum + Number(row.weight), 0),
      batches: new Set(rows.map(row => row.lotId ?? row.batchId)).size,
      value: Number(valuation.find(row => row.name === warehouse.name)?.value ?? 0),
    })
  }
})
