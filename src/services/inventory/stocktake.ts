import { Prisma, PrismaClient } from '@prisma/client'
import { ensureInventoryLot, recordMovement, refreshLotStatus } from '../lots'
import { runIdempotent } from '../idempotency'
import { assertUniqueInventoryItems, nextOrderNo } from './shared'

export interface StocktakeItemInput {
  inventoryId: string
  actualWeight: number
}

export interface StocktakeInput {
  date: Date
  warehouseId: string
  handlerName: string
  note?: string | null
  items: StocktakeItemInput[]
}

async function createStocktakeInTransaction(
  tx: Prisma.TransactionClient,
  input: StocktakeInput,
) {
    assertUniqueInventoryItems(input.items)
    const rows = await Promise.all(
      input.items.map((it) =>
        tx.inventory.findUnique({ where: { id: it.inventoryId }, include: { lot: true } }),
      ),
    )
    for (let i = 0; i < input.items.length; i++) {
      const row = rows[i]
      if (!row) throw new Error(`库存记录不存在：${input.items[i].inventoryId}`)
      if (row.warehouseId !== input.warehouseId) {
        throw new Error('盘点条目不属于所选仓库')
      }
    }

    const stocktake = await tx.stocktake.create({
      data: {
        orderNo: await nextOrderNo('ST', (base) =>
          tx.stocktake.findMany({
            where: { orderNo: { startsWith: base } },
            select: { orderNo: true },
          }),
        ),
        date: input.date,
        warehouseId: input.warehouseId,
        handlerName: input.handlerName,
        note: input.note ?? null,
      },
    })

    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]
      const row = rows[i]!
      const actual = new Prisma.Decimal(it.actualWeight)
      const diff = actual.minus(row.weight)
      await tx.stocktakeItem.create({
        data: {
          stocktakeId: stocktake.id,
          inventoryId: row.id,
          bookWeight: row.weight,
          actualWeight: actual,
          diff,
        },
      })
      const newCost = row.weight.greaterThan(0)
        ? row.cost.mul(actual).div(row.weight).toDecimalPlaces(2)
        : new Prisma.Decimal(0)
      const newFreight = row.weight.greaterThan(0)
        ? row.freight.mul(actual).div(row.weight).toDecimalPlaces(2)
        : new Prisma.Decimal(0)
      const updated = await tx.inventory.updateMany({
        where: { id: row.id, version: row.version },
        data: {
          weight: actual,
          cost: newCost,
          freight: newFreight,
          version: { increment: 1 },
        },
      })
      if (updated.count !== 1) throw new Error('库存已被其他操作修改，请刷新后重试')
      const lot = row.lot ?? (await ensureInventoryLot(tx, row))
      await recordMovement(tx, {
        lotId: lot.id,
        type: 'STOCKTAKE',
        referenceType: 'STOCKTAKE',
        referenceId: stocktake.id,
        fromWarehouseId: input.warehouseId,
        toWarehouseId: input.warehouseId,
        weight: diff,
        goodsCost: newCost.minus(row.cost),
        freightCost: newFreight.minus(row.freight),
        occurredAt: input.date,
      })
      await refreshLotStatus(tx, lot.id)
    }

    return tx.stocktake.findUniqueOrThrow({
      where: { id: stocktake.id },
      include: {
        items: {
          include: { inventory: { include: { variant: { include: { yarn: true } }, batch: true } } },
        },
        warehouse: true,
      },
    })
}

export function createStocktake(
  db: PrismaClient,
  input: StocktakeInput,
) {
  return db.$transaction((tx) => createStocktakeInTransaction(tx, input))
}

export function createStocktakeIdempotent(
  db: PrismaClient,
  input: StocktakeInput,
  idempotencyKey?: string,
) {
  return runIdempotent(
    db,
    'STOCKTAKE_CREATE',
    idempotencyKey,
    input,
    (tx) => createStocktakeInTransaction(tx, input),
    (tx, resourceId) => tx.stocktake.findUniqueOrThrow({
      where: { id: resourceId },
      include: {
        items: {
          include: { inventory: { include: { variant: { include: { yarn: true } }, batch: true } } },
        },
        warehouse: true,
      },
    }),
  )
}
