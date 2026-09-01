import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTestDb, resetDb } from './helpers/db'
import { createBase } from './helpers/base'
import { createPurchase, createSale, getInventoryRows } from '@/services/inventory'
import { getOrderRecords } from '@/services/orders'
import { getCustomerOrders, getSupplierOrders } from '@/services/reports'
import { updateYarnMaster } from '@/services/yarns'

let db: PrismaClient

beforeEach(async () => {
  db = getTestDb()
  await resetDb(db)
})

describe('纱线全局更名', () => {
  it('只修改主档名称，库存、历史订单和报表统一显示新名称', async () => {
    const base = await createBase(db)
    const purchase = await createPurchase(db, {
      date: new Date('2026-08-01'),
      supplierId: base.supplierId,
      warehouseId: base.warehouseA,
      handlerName: '爸爸',
      items: [{
        variantId: base.variantId,
        batchNo: '棉纱-20260801-1',
        weight: 1000,
        price: 20,
      }],
    })
    const inventoryBefore = await getInventoryRows(db, { warehouseId: base.warehouseA })
    const sale = await createSale(db, {
      date: new Date('2026-08-05'),
      customerId: base.customerId,
      warehouseId: base.warehouseA,
      handlerName: '妈妈',
      items: [{ inventoryId: inventoryBefore[0].id, weight: 100, price: 22 }],
    })

    const returnOrder = await db.processingReturn.create({
      data: {
        orderNo: 'PR-TEST-1',
        date: new Date('2026-08-06'),
        factoryId: base.warehouseA,
        warehouseId: base.warehouseB,
        handlerName: '爸爸',
      },
    })
    await db.processingReturnItem.create({
      data: {
        orderId: returnOrder.id,
        inventoryId: inventoryBefore[0].id,
        variantId: base.variantId,
        batchNo: '棉纱-20260801-1',
        weight: 10,
        outputWeight: 10,
      },
    })
    await db.processingFeeSettlement.create({
      data: {
        warehouseId: base.warehouseA,
        variantId: base.variantId,
        batchNo: '棉纱-20260801-1',
        inputWeight: 10,
        outputWeight: 10,
        feePerKg: 1,
        feeTotal: 10,
        remainingWeight: 0,
        newUnitCost: 21,
        handlerName: '爸爸',
      },
    })

    const result = await updateYarnMaster(db, base.yarnId, { name: '涤纶' })
    expect(result.renamed).toBe(true)
    expect(result.previousName).toBe('棉纱')
    expect(result.relatedVariantCount).toBe(1)
    expect(result.renamedBatchCount).toBe(1)
    expect(result.renamedSnapshotCount).toBe(2)

    const [inventory, records, supplierOrders, customerOrders, purchaseAfter, saleAfter] =
      await Promise.all([
        getInventoryRows(db, { warehouseId: base.warehouseA }),
        getOrderRecords(db, {}),
        getSupplierOrders(db, base.supplierId),
        getCustomerOrders(db, base.customerId),
        db.purchaseOrder.findUniqueOrThrow({
          where: { id: purchase.id },
          include: { items: { include: { variant: { include: { yarn: true } } } } },
        }),
        db.saleOrder.findUniqueOrThrow({
          where: { id: sale.id },
          include: {
            items: {
              include: {
                inventory: { include: { variant: { include: { yarn: true } } } },
              },
            },
          },
        }),
      ])

    expect(inventory[0].variant.yarn.name).toBe('涤纶')
    expect(inventory[0].batch.batchNo).toBe('涤纶-20260801-1')
    expect(records.every((record) => record.items.every((item) => item.yarnName === '涤纶'))).toBe(true)
    expect(supplierOrders[0].items[0].yarnName).toBe('涤纶')
    expect(customerOrders[0].items[0].yarnName).toBe('涤纶')
    expect(purchaseAfter.items[0].variant.yarn.name).toBe('涤纶')
    expect(saleAfter.items[0].inventory.variant.yarn.name).toBe('涤纶')
    expect(purchaseAfter.items[0].variantId).toBe(base.variantId)
    expect(saleAfter.items[0].inventory.variantId).toBe(base.variantId)
    expect(
      await db.processingReturnItem.findFirstOrThrow({
        where: { orderId: returnOrder.id },
      }),
    ).toMatchObject({ batchNo: '涤纶-20260801-1' })
    expect(
      await db.processingFeeSettlement.findFirstOrThrow({
        where: { variantId: base.variantId },
      }),
    ).toMatchObject({ batchNo: '涤纶-20260801-1' })
  })

  it('拒绝更名成另一个已存在的纱线名称', async () => {
    const base = await createBase(db)
    await db.yarn.create({ data: { name: '涤纶' } })

    await expect(
      updateYarnMaster(db, base.yarnId, { name: ' 涤纶 ' }),
    ).rejects.toThrow('已存在同名纱线')
  })
})
