import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createBase } from './helpers/base'
import { getTestDb, resetDb } from './helpers/db'
import { createPurchaseIdempotent } from '@/services/inventory'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

describe('业务写入幂等控制', () => {
  it('相同幂等键重复提交只生成一张单据和一次库存变化', async () => {
    const base = await createBase(db)
    const input = {
      date: new Date('2026-09-06'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'IDEM-1', weight: 100, price: 20 }],
    }

    const first = await createPurchaseIdempotent(db, input, 'idem-purchase-1')
    const second = await createPurchaseIdempotent(db, input, 'idem-purchase-1')

    expect(first.replayed).toBe(false)
    expect(second.replayed).toBe(true)
    expect(second.value.id).toBe(first.value.id)
    expect(await db.purchaseOrder.count()).toBe(1)
    expect(await db.stockMovement.count({ where: { type: 'PURCHASE_RECEIPT' } })).toBe(1)
    const inventory = await db.inventory.findMany({ where: { warehouseId: base.warehouseA } })
    expect(inventory).toHaveLength(1)
    expect(inventory[0].weight.toString()).toBe('100')
  })

  it('同一操作复用幂等键但修改请求内容时拒绝执行', async () => {
    const base = await createBase(db)
    const input = {
      date: new Date('2026-09-06'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, weight: 100, price: 20 }],
    }
    await createPurchaseIdempotent(db, input, 'idem-purchase-2')
    await expect(
      createPurchaseIdempotent(
        db,
        { ...input, items: [{ variantId: base.variantId, weight: 200, price: 20 }] },
        'idem-purchase-2',
      ),
    ).rejects.toThrow('幂等键已用于不同请求')
    expect(await db.purchaseOrder.count()).toBe(1)
  })

  it('并发发送两次相同请求也只执行一次', async () => {
    const base = await createBase(db)
    const input = {
      date: new Date('2026-09-06'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '萍',
      items: [{ variantId: base.variantId, batchNo: 'IDEM-CONCURRENT', weight: 80, price: 21 }],
    }
    const results = await Promise.all([
      createPurchaseIdempotent(db, input, 'idem-purchase-concurrent'),
      createPurchaseIdempotent(db, input, 'idem-purchase-concurrent'),
    ])
    expect(new Set(results.map((result) => result.value.id)).size).toBe(1)
    expect(results.filter((result) => result.replayed)).toHaveLength(1)
    expect(await db.purchaseOrder.count()).toBe(1)
    expect(await db.inventory.count()).toBe(1)
    expect(await db.stockMovement.count()).toBe(1)
  })

  it('新业务成功后清理超过 90 天的幂等记录，且不影响未过期记录', async () => {
    const base = await createBase(db)
    const input = {
      date: new Date('2026-09-06'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '刚',
      items: [{ variantId: base.variantId, batchNo: 'IDEM-CLEANUP', weight: 50, price: 10 }],
    }
    await db.idempotencyRequest.create({
      data: {
        operation: 'PURCHASE_CREATE',
        key: 'idem-expired',
        requestHash: 'old-hash',
        resourceId: 'res-old',
        completedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
      },
    })
    await db.idempotencyRequest.create({
      data: {
        operation: 'PURCHASE_CREATE',
        key: 'idem-recent',
        requestHash: 'recent-hash',
        resourceId: 'res-recent',
        completedAt: new Date(),
      },
    })

    const result = await createPurchaseIdempotent(db, input, 'idem-cleanup-trigger')

    expect(result.replayed).toBe(false)
    const keys = (await db.idempotencyRequest.findMany()).map((row) => row.key)
    expect(keys).toContain('idem-cleanup-trigger')
    expect(keys).toContain('idem-recent')
    expect(keys).not.toContain('idem-expired')
  })
})
