import { Prisma, PrismaClient } from '@prisma/client'
import { allocateAmountByWeight } from '@/lib/money'
import { addToLotBalance, ensureInventoryLot, recordMovement, subtractFromBalance } from '../lots'
import { runIdempotent } from '../idempotency'
import { assertUniqueInventoryItems, nextOrderNo, resolveMovedPackages } from './shared'

export interface TransferItemInput {
  inventoryId: string
  weight: number
  packages?: number | null
}

export interface TransferInput {
  date: Date
  fromWarehouseId: string
  toWarehouseId: string
  handlerName: string
  note?: string | null
  processingFeePerKg?: number | null
  freight?: number
  items: TransferItemInput[]
}

async function createTransferInTransaction(
  tx: Prisma.TransactionClient,
  input: TransferInput,
) {
    assertUniqueInventoryItems(input.items)
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new Error('来源仓库与目标仓库不能相同')
    }
    const [fromWarehouse, toWarehouse] = await Promise.all([
      tx.warehouse.findUnique({ where: { id: input.fromWarehouseId } }),
      tx.warehouse.findUnique({ where: { id: input.toWarehouseId } }),
    ])
    if (!fromWarehouse?.active || !toWarehouse?.active) {
      throw new Error('来源仓库或目标仓库不存在或已停用')
    }

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
      if (row.warehouseId !== input.fromWarehouseId) {
        throw new Error(`库存 ${row.variant.yarn.name} ${row.variant.color} 不在来源仓库`)
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

    const order = await tx.transferOrder.create({
      data: {
        orderNo: await nextOrderNo('TO', (base) =>
          tx.transferOrder.findMany({
            where: { orderNo: { startsWith: base } },
            select: { orderNo: true },
          }),
        ),
        date: input.date,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        handlerName: input.handlerName,
        note: input.note ?? null,
        processingFeePerKg: input.processingFeePerKg ?? null,
        freight: input.freight ?? 0,
      },
    })

    const transferFreights = allocateAmountByWeight(
      input.items.map((item) => new Prisma.Decimal(item.weight)),
      new Prisma.Decimal(input.freight ?? 0),
    )

    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]
      const row = rows[i]!
      const lot = row.lot ?? (await ensureInventoryLot(tx, row))
      const movedWeight = new Prisma.Decimal(it.weight)
      const movedPackages = resolveMovedPackages(row, movedWeight, it.packages, '调拨')
      const addedFreight = transferFreights[i]
      const transferItem = await tx.transferItem.create({
        data: {
          orderId: order.id,
          inventoryId: row.id,
          weight: it.weight,
          packages: movedPackages,
        },
      })
      const moved = await subtractFromBalance(tx, row, movedWeight, movedPackages)
      const destination = await addToLotBalance(
        tx,
        {
          lotId: lot.id,
          warehouseId: input.toWarehouseId,
          variantId: row.variantId,
          batchId: row.batchId,
          processingCostCalculated:
            toWarehouse.type === 'FACTORY' && fromWarehouse.type !== 'FACTORY'
              ? false
              : row.processingFeeSettled,
        },
        {
          weight: movedWeight,
          packages: movedPackages,
          cost: moved.cost,
          freight: moved.freight.plus(addedFreight),
        },
      )
      await tx.transferItem.update({
        where: { id: transferItem.id },
        data: { destinationInventoryId: destination.id },
      })
      if (!addedFreight.isZero()) {
        await tx.inventoryLot.update({
          where: { id: lot.id },
          data: { freightCost: lot.freightCost.plus(addedFreight).toDecimalPlaces(2) },
        })
      }
      if (toWarehouse.type === 'FACTORY' && fromWarehouse.type !== 'FACTORY') {
        await tx.inventoryLot.update({
          where: { id: lot.id },
          data: { status: 'AWAITING_PROCESS' },
        })
      }
      await recordMovement(tx, {
        lotId: lot.id,
        type: 'TRANSFER',
        referenceType: 'TRANSFER',
        referenceId: order.id,
        referenceItemId: transferItem.id,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        weight: movedWeight,
        packages: movedPackages,
        goodsCost: moved.cost,
        freightCost: moved.freight.plus(addedFreight),
        occurredAt: input.date,
      })
    }

    return tx.transferOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        items: {
          include: { inventory: { include: { variant: { include: { yarn: true } }, batch: true } } },
        },
        fromWarehouse: true,
        toWarehouse: true,
      },
    })
}

export function createTransfer(
  db: PrismaClient,
  input: TransferInput,
) {
  return db.$transaction((tx) => createTransferInTransaction(tx, input))
}

export function createTransferIdempotent(
  db: PrismaClient,
  input: TransferInput,
  idempotencyKey?: string,
) {
  return runIdempotent(
    db,
    'TRANSFER_CREATE',
    idempotencyKey,
    input,
    (tx) => createTransferInTransaction(tx, input),
    (tx, resourceId) => tx.transferOrder.findUniqueOrThrow({
      where: { id: resourceId },
      include: {
        items: {
          include: { inventory: { include: { variant: { include: { yarn: true } }, batch: true } } },
        },
        fromWarehouse: true,
        toWarehouse: true,
      },
    }),
  )
}
