import type { PrismaClient } from '@prisma/client'

export interface BaseData {
  warehouseA: string
  warehouseB: string
  yarnId: string
  variantId: string
  supplierId: string
  customerId: string
}

export async function createBase(db: PrismaClient): Promise<BaseData> {
  const warehouseA = await db.warehouse.create({ data: { name: '仓A' } })
  const warehouseB = await db.warehouse.create({ data: { name: '仓B' } })
  const yarn = await db.yarn.create({ data: { name: '棉纱' } })
  const variant = await db.yarnVariant.create({
    data: { yarnId: yarn.id, spec: '32支', color: '白色', unit: 'kg' },
  })
  const supplier = await db.counterparty.create({ data: { name: '供应商甲', type: 'SUPPLIER' } })
  const customer = await db.counterparty.create({ data: { name: '客户乙', type: 'CUSTOMER' } })
  return {
    warehouseA: warehouseA.id,
    warehouseB: warehouseB.id,
    yarnId: yarn.id,
    variantId: variant.id,
    supplierId: supplier.id,
    customerId: customer.id,
  }
}
