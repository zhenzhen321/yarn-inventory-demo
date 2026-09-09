import { Prisma, PrismaClient } from '@prisma/client'
import { ensureInventoryLot, recordMovement, refreshLotStatus, subtractFromBalance } from '../lots'
import { runIdempotent } from '../idempotency'
import { amount, assertUniqueInventoryItems, nextOrderNo, resolveMovedPackages } from './shared'

export interface SaleItemInput {
  inventoryId: string
  weight: number
  price: number
  packages?: number | null
}

export interface SaleInput {
  date: Date
  customerId: string
  warehouseId: string
  handlerName: string
  note?: string | null
  freight?: number
  items: SaleItemInput[]
}

async function createSaleInTransaction(
  tx: Prisma.TransactionClient,
  input: SaleInput,
) {
    assertUniqueInventoryItems(input.items)
    const [customer, warehouse] = await Promise.all([
      tx.counterparty.findUnique({ where: { id: input.customerId } }),
      tx.warehouse.findUnique({ where: { id: input.warehouseId } }),
    ])
    if (!customer?.active || !['CUSTOMER', 'BOTH'].includes(customer.type)) {
      throw new Error('客户不存在、已停用或类型不正确')
    }
    if (!warehouse?.active) throw new Error('销售仓库不存在或已停用')

    const rows = await Promise.all(
      input.items.map((it) =>
        tx.inventory.findUnique({
          where: { id: it.inventoryId },
          include: {
            warehouse: true,
            variant: { include: { yarn: true } },
            batch: true,
            lot: true,
          },
        }),
      ),
    )

    for (let i = 0; i < input.items.length; i++) {
      const row = rows[i]
      if (!row) throw new Error(`库存记录不存在：${input.items[i].inventoryId}`)
      if (row.archived) {
        throw new Error(`库存已归档，不能销售：${row.variant.yarn.name} ${row.variant.color} 批次 ${row.batch.batchNo}`)
      }
      if (row.warehouseId !== input.warehouseId) {
        throw new Error(`库存 ${row.variant.yarn.name} ${row.variant.color} 不在所选仓库`)
      }
      if (row.weight.lessThan(input.items[i].weight)) {
        throw new Error(
          `库存不足：${row.variant.yarn.name} ${row.variant.color} 批次 ${row.batch.batchNo}，现有 ${row.weight} kg`,
        )
      }
      if (row.warehouse.type === 'FACTORY' && !row.processingFeeSettled) {
        throw new Error(
          `该批货未结算加工费，无法出加工厂：${row.variant.yarn.name} ${row.variant.color} 批次 ${row.batch.batchNo}`,
        )
      }
    }

    const totalAmount = input.items
      .reduce((sum, it) => sum.plus(amount(it.weight, it.price)), new Prisma.Decimal(0))
      .toDecimalPlaces(2)

    const order = await tx.saleOrder.create({
      data: {
        orderNo: await nextOrderNo('SO', (base) =>
          tx.saleOrder.findMany({
            where: { orderNo: { startsWith: base } },
            select: { orderNo: true },
          }),
        ),
        date: input.date,
        customerId: input.customerId,
        warehouseId: input.warehouseId,
        handlerName: input.handlerName,
        note: input.note ?? null,
        totalAmount,
        freight: input.freight ?? 0,
      },
    })

    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]
      const row = rows[i]!
      const unitCost = row.weight.greaterThan(0)
        ? row.cost.div(row.weight).toDecimalPlaces(2)
        : new Prisma.Decimal(0)
      const unitFreight = row.weight.greaterThan(0)
        ? row.freight.div(row.weight).toDecimalPlaces(2)
        : new Prisma.Decimal(0)
      const lot = row.lot ?? (await ensureInventoryLot(tx, row))
      const soldWeight = new Prisma.Decimal(it.weight)
      const soldPackages = resolveMovedPackages(row, soldWeight, it.packages, '销售')
      const saleItem = await tx.saleItem.create({
        data: {
          orderId: order.id,
          inventoryId: row.id,
          weight: it.weight,
          price: it.price,
          amount: amount(it.weight, it.price),
          packages: soldPackages,
          unitCost,
          unitFreight,
        },
      })
      const sold = await subtractFromBalance(tx, row, soldWeight, soldPackages)
      await tx.saleAllocation.create({
        data: {
          saleItemId: saleItem.id,
          lotId: lot.id,
          inventoryId: row.id,
          warehouseId: input.warehouseId,
          weight: soldWeight,
          packages: soldPackages,
          unitCost,
          unitFreight,
        },
      })
      await recordMovement(tx, {
        lotId: lot.id,
        type: 'SALE',
        referenceType: 'SALE',
        referenceId: order.id,
        referenceItemId: saleItem.id,
        fromWarehouseId: input.warehouseId,
        weight: soldWeight,
        packages: soldPackages,
        goodsCost: sold.cost,
        freightCost: sold.freight,
        occurredAt: input.date,
      })
      await refreshLotStatus(tx, lot.id)
    }

    return tx.saleOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        items: {
          include: {
            inventory: { include: { variant: { include: { yarn: true } }, batch: true } },
            allocations: { include: { lot: true } },
          },
        },
        customer: true,
        warehouse: true,
      },
    })
}

export function createSale(
  db: PrismaClient,
  input: SaleInput,
) {
  return db.$transaction((tx) => createSaleInTransaction(tx, input))
}

export function createSaleIdempotent(
  db: PrismaClient,
  input: SaleInput,
  idempotencyKey?: string,
) {
  return runIdempotent(
    db,
    'SALE_CREATE',
    idempotencyKey,
    input,
    (tx) => createSaleInTransaction(tx, input),
    (tx, resourceId) => tx.saleOrder.findUniqueOrThrow({
      where: { id: resourceId },
      include: {
        items: {
          include: {
            inventory: { include: { variant: { include: { yarn: true } }, batch: true } },
            allocations: { include: { lot: true } },
          },
        },
        customer: true,
        warehouse: true,
      },
    }),
  )
}
