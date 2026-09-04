import { Prisma, PrismaClient } from '@prisma/client'
import {
  addToLotBalance,
  createLot,
  ensureInventoryLot,
  portionOf,
  recordMovement,
  refreshLotStatus,
  subtractFromBalance,
} from './lots'

export interface PurchaseItemInput {
  variantId?: string
  yarnId?: string
  spec?: string
  color?: string
  unit?: string
  batchNo?: string | null
  weight: number
  price: number
  packages?: number | null
}

export interface PurchaseInput {
  date: Date
  supplierId: string
  warehouseId: string
  handlerName: string
  note?: string | null
  freight?: number
  items: PurchaseItemInput[]
}

function amount(weight: number, price: number): Prisma.Decimal {
  return new Prisma.Decimal(weight).mul(price).toDecimalPlaces(2)
}

function dateYmd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

async function nextOrderNo(
  prefix: string,
  existingForDay: (base: string) => Promise<{ orderNo: string }[]>,
): Promise<string> {
  const base = `${prefix}-${dateYmd(new Date())}-`
  const rows = await existingForDay(base)
  const max = rows.reduce((current, row) => {
    const suffix = row.orderNo.slice(base.length)
    const value = /^\d+$/.test(suffix) ? Number(suffix) : 0
    return Number.isSafeInteger(value) ? Math.max(current, value) : current
  }, 0)
  return `${base}${String(max + 1).padStart(4, '0')}`
}

function assertUniqueInventoryItems(items: { inventoryId: string }[]): void {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.inventoryId)) {
      throw new Error('同一库存不能重复选择，请合并为一条明细')
    }
    seen.add(item.inventoryId)
  }
}

function resolveMovedPackages(
  row: { weight: Prisma.Decimal; packages: number | null },
  weight: Prisma.Decimal,
  requested: number | null | undefined,
  actionName: string,
): number | null {
  if (requested === null || requested === undefined) {
    if (weight.equals(row.weight)) return row.packages
    if (row.packages !== null) throw new Error(`部分${actionName}时必须填写本次件数`)
    return null
  }
  if (!Number.isInteger(requested) || requested < 0) {
    throw new Error(`${actionName}件数必须是非负整数`)
  }
  if (row.packages !== null && requested > row.packages) {
    throw new Error(`${actionName}件数不能超过当前库存：现有 ${row.packages} 件`)
  }
  return requested
}

async function getOrCreateBatch(
  tx: Prisma.TransactionClient,
  variant: { id: string; yarn: { name: string } },
  batchNo?: string | null,
) {
  const trimmed = batchNo?.trim()
  if (trimmed) {
    const existing = await tx.batch.findFirst({
      where: { variantId: variant.id, batchNo: trimmed },
    })
    if (existing) return existing
    return tx.batch.create({ data: { variantId: variant.id, batchNo: trimmed } })
  }
  const n = (await tx.batch.count({ where: { variantId: variant.id } })) + 1
  return tx.batch.create({
    data: {
      variantId: variant.id,
      batchNo: `${variant.yarn.name}-${dateYmd(new Date())}-${n}`,
    },
  })
}

async function getOrCreateVariant(
  tx: Prisma.TransactionClient,
  yarnId: string,
  spec: string,
  color: string,
  unit: string,
) {
  let variant = await tx.yarnVariant.findFirst({
    where: { yarnId, spec, color, unit },
    include: { yarn: true },
  })
  if (!variant) {
    variant = await tx.yarnVariant.create({
      data: { yarnId, spec, color, unit },
      include: { yarn: true },
    })
  }
  return variant
}

export async function createPurchase(db: PrismaClient, input: PurchaseInput) {
  return db.$transaction(async (tx) => {
    const [supplier, warehouse] = await Promise.all([
      tx.counterparty.findUnique({ where: { id: input.supplierId } }),
      tx.warehouse.findUnique({ where: { id: input.warehouseId } }),
    ])
    if (!supplier?.active || !['SUPPLIER', 'BOTH'].includes(supplier.type)) {
      throw new Error('供应商不存在、已停用或类型不正确')
    }
    if (!warehouse?.active || !['WAREHOUSE', 'FACTORY'].includes(warehouse.type)) {
      throw new Error('入库地点不存在、已停用或类型不正确')
    }

    const totalAmount = input.items
      .reduce((sum, it) => sum.plus(amount(it.weight, it.price)), new Prisma.Decimal(0))
      .toDecimalPlaces(2)
    const totalWeight = input.items.reduce(
      (s, it) => s.plus(new Prisma.Decimal(it.weight)),
      new Prisma.Decimal(0),
    )
    const orderFreight = new Prisma.Decimal(input.freight ?? 0)
    const unitBuyFreight = totalWeight.greaterThan(0)
      ? orderFreight.div(totalWeight).toDecimalPlaces(2)
      : new Prisma.Decimal(0)

    const order = await tx.purchaseOrder.create({
      data: {
        orderNo: await nextOrderNo('PO', (base) =>
          tx.purchaseOrder.findMany({
            where: { orderNo: { startsWith: base } },
            select: { orderNo: true },
          }),
        ),
        date: input.date,
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        handlerName: input.handlerName,
        note: input.note ?? null,
        totalAmount,
        freight: input.freight ?? 0,
      },
    })

    for (const it of input.items) {
      const variant = it.variantId
        ? await tx.yarnVariant.findUnique({
            where: { id: it.variantId },
            include: { yarn: true },
          })
        : await getOrCreateVariant(tx, it.yarnId!, it.spec!, it.color!, it.unit ?? 'kg')
      if (!variant) throw new Error(`纱线规格不存在：${it.variantId}`)
      if (!variant.active || !variant.yarn.active) {
        throw new Error('纱线或规格已停用，不能继续入库')
      }
      const batch = await getOrCreateBatch(tx, variant, it.batchNo)
      const itemAmount = amount(it.weight, it.price)
      const itemFreight = unitBuyFreight.mul(it.weight).toDecimalPlaces(2)
      const lot = await createLot(tx, {
        date: input.date,
        sourceType: 'PURCHASE',
        variantId: variant.id,
        batchId: batch.id,
        initialWeight: new Prisma.Decimal(it.weight),
        initialPackages: it.packages ?? null,
        goodsCost: itemAmount,
        freightCost: itemFreight,
        status: warehouse.type === 'FACTORY' ? 'AWAITING_PROCESS' : 'AVAILABLE',
      })
      const purchaseItem = await tx.purchaseItem.create({
        data: {
          orderId: order.id,
          variantId: variant.id,
          batchId: batch.id,
          lotId: lot.id,
          weight: it.weight,
          price: it.price,
          amount: itemAmount,
          packages: it.packages ?? null,
        },
      })
      await addToLotBalance(
        tx,
        {
          lotId: lot.id,
          warehouseId: input.warehouseId,
          variantId: variant.id,
          batchId: batch.id,
          processingCostCalculated: false,
        },
        {
          weight: new Prisma.Decimal(it.weight),
          packages: it.packages ?? null,
          cost: itemAmount,
          freight: itemFreight,
        },
      )
      await recordMovement(tx, {
        lotId: lot.id,
        type: 'PURCHASE_RECEIPT',
        referenceType: 'PURCHASE',
        referenceId: order.id,
        referenceItemId: purchaseItem.id,
        toWarehouseId: input.warehouseId,
        weight: new Prisma.Decimal(it.weight),
        packages: it.packages ?? null,
        goodsCost: itemAmount,
        freightCost: itemFreight,
        occurredAt: input.date,
      })
    }

    return tx.purchaseOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        items: { include: { variant: { include: { yarn: true } }, batch: true, lot: true } },
        supplier: true,
        warehouse: true,
      },
    })
  })
}

// 修改买入单运费：按明细重量比例分摊到各批次库存运费（最后一条补差，合计精确等于运费）
export async function updatePurchaseFreight(db: PrismaClient, id: string, freight: number) {
  return db.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: { include: { lot: true } } },
    })
    if (!order) throw new Error('买入单不存在')
    if (order.reversedAt) throw new Error('已撤回的买入单不能修改运费')
    const items = order.items
    const totalWeight = items.reduce(
      (s, it) => s.plus(new Prisma.Decimal(it.weight)),
      new Prisma.Decimal(0),
    )
    if (totalWeight.lessThanOrEqualTo(0)) throw new Error('买入单没有有效重量')
    const newFreight = new Prisma.Decimal(freight).toDecimalPlaces(2)
    if (newFreight.lessThan(0)) throw new Error('运费不能为负')

    const exactItems = items.filter((item) => item.lotId)
    for (const item of exactItems) {
      const [row, laterMovements] = await Promise.all([
        tx.inventory.findFirst({
          where: {
            lotId: item.lotId!,
            warehouseId: order.warehouseId,
            archived: false,
          },
        }),
        tx.stockMovement.count({
          where: {
            lotId: item.lotId!,
            NOT: { type: 'PURCHASE_RECEIPT', referenceId: order.id },
          },
        }),
      ])
      if (!row || !row.weight.equals(item.weight) || laterMovements > 0) {
        throw new Error('该买入单库存已发生卖出、调拨、加工或盘点，不能再修改运费')
      }
    }

    const legacyItems = items.filter((item) => !item.lotId)
    const legacyKeys = new Set(legacyItems.map((item) => `${item.variantId}|${item.batchId}`))
    for (const key of legacyKeys) {
      const [variantId, batchId] = key.split('|')
      const [row, purchased] = await Promise.all([
        tx.inventory.findFirst({
          where: {
            warehouseId: order.warehouseId,
            variantId,
            batchId,
            processingFeeSettled: false,
            archived: false,
          },
        }),
        tx.purchaseItem.aggregate({
          where: { variantId, batchId, order: { warehouseId: order.warehouseId } },
          _sum: { weight: true },
        }),
      ])
      const totalPurchased = purchased._sum.weight ?? new Prisma.Decimal(0)
      if (!row || !row.weight.equals(totalPurchased)) {
        throw new Error('该买入单库存已发生卖出、调拨或盘点，不能再修改运费')
      }
    }

    const oldFreight = order.freight
    const allocate = (total: Prisma.Decimal) => {
      const arr = items.map((it) => total.mul(it.weight).div(totalWeight).toDecimalPlaces(2))
      const sum = arr.reduce((s, v) => s.plus(v), new Prisma.Decimal(0))
      arr[arr.length - 1] = arr[arr.length - 1].plus(total.minus(sum))
      return arr
    }
    const oldArr = allocate(oldFreight)
    const newArr = allocate(newFreight)
    await tx.purchaseOrder.update({ where: { id }, data: { freight: newFreight } })
    for (let i = 0; i < items.length; i++) {
      const delta = newArr[i].minus(oldArr[i])
      if (delta.isZero()) continue
      const it = items[i]
      const row = it.lotId
        ? await tx.inventory.findFirst({
            where: { lotId: it.lotId, warehouseId: order.warehouseId, archived: false },
          })
        : await tx.inventory.findFirst({
            where: {
              warehouseId: order.warehouseId,
              variantId: it.variantId,
              batchId: it.batchId,
              processingFeeSettled: false,
              archived: false,
            },
          })
      if (!row) throw new Error(`库存记录不存在：变体 ${it.variantId} 批次 ${it.batchId}`)
      await tx.inventory.update({
        where: { id: row.id },
        data: {
          freight: row.freight.plus(delta).toDecimalPlaces(2),
          version: { increment: 1 },
        },
      })
      if (it.lotId) {
        await tx.inventoryLot.update({
          where: { id: it.lotId },
          data: {
            freightCost: (it.lot?.freightCost ?? new Prisma.Decimal(0))
              .plus(delta)
              .toDecimalPlaces(2),
          },
        })
        await tx.stockMovement.updateMany({
          where: {
            lotId: it.lotId,
            type: 'PURCHASE_RECEIPT',
            referenceId: order.id,
            referenceItemId: it.id,
          },
          data: { freightCost: newArr[i] },
        })
      }
    }
    return tx.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: {
        items: { include: { variant: { include: { yarn: true } }, batch: true, lot: true } },
        supplier: true,
        warehouse: true,
      },
    })
  })
}

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

export async function createSale(db: PrismaClient, input: SaleInput) {
  return db.$transaction(async (tx) => {
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
  })
}

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

export async function createTransfer(db: PrismaClient, input: TransferInput) {
  return db.$transaction(async (tx) => {
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

    const totalMovedWeight = input.items.reduce(
      (s, it) => s.plus(new Prisma.Decimal(it.weight)),
      new Prisma.Decimal(0),
    )
    const unitTransferFreight = totalMovedWeight.greaterThan(0)
      ? new Prisma.Decimal(input.freight ?? 0).div(totalMovedWeight).toDecimalPlaces(2)
      : new Prisma.Decimal(0)

    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]
      const row = rows[i]!
      const lot = row.lot ?? (await ensureInventoryLot(tx, row))
      const movedWeight = new Prisma.Decimal(it.weight)
      const movedPackages = resolveMovedPackages(row, movedWeight, it.packages, '调拨')
      const addedFreight = unitTransferFreight.mul(it.weight).toDecimalPlaces(2)
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
  })
}

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

export async function createStocktake(db: PrismaClient, input: StocktakeInput) {
  return db.$transaction(async (tx) => {
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
  })
}

export async function archiveZeroInventory(db: PrismaClient, warehouseId: string) {
  const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId } })
  if (!warehouse) throw new Error('仓库不存在')
  const res = await db.inventory.updateMany({
    where: { warehouseId, weight: 0, archived: false },
    data: { archived: true },
  })
  return { count: res.count, warehouseName: warehouse.name }
}

export interface InventoryFilter {
  warehouseId?: string
  yarnId?: string
  q?: string
  includeZero?: boolean
}

export function getInventoryRows(db: PrismaClient, filter: InventoryFilter) {
  return db.inventory.findMany({
    where: {
      archived: false,
      warehouseId: filter.warehouseId || undefined,
      ...(filter.includeZero ? {} : { weight: { gt: 0 } }),
      variant: {
        ...(filter.yarnId ? { yarnId: filter.yarnId } : {}),
        ...(filter.q
          ? {
              OR: [
                { yarn: { name: { contains: filter.q } } },
                { color: { contains: filter.q } },
                { spec: { contains: filter.q } },
              ],
            }
          : {}),
      },
    },
    include: {
      warehouse: true,
      variant: { include: { yarn: true } },
      batch: true,
      lot: {
        include: {
          purchaseItem: {
            include: {
              order: { select: { id: true, orderNo: true, date: true } },
            },
          },
          processingOutput: {
            include: {
              job: { select: { id: true, orderNo: true, date: true } },
            },
          },
        },
      },
    },
    orderBy: [
      { warehouse: { name: 'asc' } },
      { variant: { yarn: { name: 'asc' } } },
      { batch: { batchNo: 'asc' } },
    ],
  })
}

export interface ProcessingFeeSettleInput {
  feePerKg: number
  inputWeight?: number
  inputPackages?: number | null
  handlerName?: string
  spec?: string
  color?: string
  unit?: string
  batchNo?: string
  outputWeight?: number
  outputPackages?: number | null
  packages?: number | null
  date?: Date
  note?: string | null
}

export async function settleProcessingFee(
  db: PrismaClient,
  inventoryId: string,
  input: ProcessingFeeSettleInput,
) {
  return db.$transaction(async (tx) => {
    const row = await tx.inventory.findUnique({
      where: { id: inventoryId },
      include: { warehouse: true, variant: { include: { yarn: true } }, batch: true, lot: true },
    })
    if (!row) throw new Error('库存记录不存在')
    if (row.warehouse.type !== 'FACTORY') throw new Error('只有加工厂库存可以结算加工费')
    if (row.processingFeeSettled) throw new Error('该批货已完成加工核算')
    if (row.weight.lessThanOrEqualTo(0)) throw new Error('库存重量为 0，无法完成加工')

    const fee = new Prisma.Decimal(input.feePerKg).toDecimalPlaces(2)
    if (fee.lessThan(0)) throw new Error('加工费不能为负')
    const inputWeight = new Prisma.Decimal(
      input.inputWeight ?? Number(row.weight),
    ).toDecimalPlaces(2)
    if (inputWeight.lessThanOrEqualTo(0)) throw new Error('本次加工重量必须大于 0')
    if (inputWeight.greaterThan(row.weight)) {
      throw new Error(`本次加工重量不能超过当前库存：现有 ${row.weight} kg`)
    }

    const isWholeBalance = inputWeight.equals(row.weight)
    if (!isWholeBalance && row.packages !== null && input.inputPackages == null) {
      throw new Error('部分加工时必须填写本次投入件数')
    }
    const inputPackages = input.inputPackages ?? (isWholeBalance ? row.packages : null)
    if (inputPackages !== null && (!Number.isInteger(inputPackages) || inputPackages < 0)) {
      throw new Error('本次投入件数必须是非负整数')
    }
    if (inputPackages !== null && row.packages !== null && inputPackages > row.packages) {
      throw new Error(`本次投入件数不能超过当前库存：现有 ${row.packages} 件`)
    }

    const spec = (input.spec ?? row.variant.spec).trim()
    const color = (input.color ?? row.variant.color).trim()
    const unit = (input.unit ?? row.variant.unit).trim()
    const batchNo = (input.batchNo ?? row.batch.batchNo).trim()
    const outputWeight = new Prisma.Decimal(
      input.outputWeight ?? Number(inputWeight),
    ).toDecimalPlaces(2)
    if (outputWeight.lessThanOrEqualTo(0)) throw new Error('加工后重量必须大于 0')
    const outputPackages = input.outputPackages ?? input.packages ?? inputPackages
    if (
      outputPackages !== null &&
      outputPackages !== undefined &&
      (!Number.isInteger(outputPackages) || outputPackages < 0)
    ) {
      throw new Error('加工后件数必须是非负整数')
    }
    const identityChanged =
      spec !== row.variant.spec ||
      color !== row.variant.color ||
      unit !== row.variant.unit ||
      batchNo !== row.batch.batchNo
    if (!spec || !color || !unit || !batchNo) {
      throw new Error('加工后支数、色号、单位和批次必填')
    }

    const moved = portionOf(row, inputWeight)
    const feeTotal = fee.mul(outputWeight).toDecimalPlaces(2)
    const newCost = moved.cost.plus(feeTotal).toDecimalPlaces(2)
    const newUnitCost = newCost.div(outputWeight).toDecimalPlaces(2)
    const occurredAt = input.date ?? new Date()

    let targetVariantId = row.variantId
    let targetBatchId = row.batchId
    if (identityChanged) {
      const variant = await getOrCreateVariant(tx, row.variant.yarnId, spec, color, unit)
      const batch = await getOrCreateBatch(tx, variant, batchNo)
      targetVariantId = variant.id
      targetBatchId = batch.id
    }

    const job = await tx.processingJob.create({
      data: {
        orderNo: await nextOrderNo('PF', (base) =>
          tx.processingJob.findMany({
            where: { orderNo: { startsWith: base } },
            select: { orderNo: true },
          }),
        ),
        date: occurredAt,
        factoryId: row.warehouseId,
        status: 'COMPLETED',
        feeBasis: 'OUTPUT',
        chargedWeight: outputWeight,
        feePerKg: fee,
        feeTotal,
        inputWeight,
        outputWeight,
        weightDiff: inputWeight.minus(outputWeight),
        handlerName: input.handlerName ?? '未知',
        note: input.note ?? null,
      },
    })
    const outputLot = await createLot(tx, {
      date: occurredAt,
      sourceType: 'PROCESSING',
      variantId: targetVariantId,
      batchId: targetBatchId,
      initialWeight: outputWeight,
      initialPackages: outputPackages ?? null,
      goodsCost: moved.cost,
      freightCost: moved.freight,
      processingCost: feeTotal,
      status: 'AVAILABLE',
    })
    const outputInventory = await addToLotBalance(
      tx,
      {
        lotId: outputLot.id,
        warehouseId: row.warehouseId,
        variantId: targetVariantId,
        batchId: targetBatchId,
        processingCostCalculated: true,
      },
      {
        weight: outputWeight,
        packages: outputPackages ?? null,
        cost: newCost,
        freight: moved.freight,
      },
      fee,
    )

    const inputLot = row.lot ?? (await ensureInventoryLot(tx, row))
    await subtractFromBalance(tx, row, inputWeight, inputPackages)
    const remaining = row.weight.minus(inputWeight)
    if (remaining.isZero()) {
      await tx.inventory.update({
        where: { id: row.id },
        data: { processingFeeSettled: true, archived: true },
      })
    }
    const processingInput = await tx.processingInput.create({
      data: {
        jobId: job.id,
        lotId: inputLot.id,
        inventoryId: row.id,
        weight: inputWeight,
        packages: inputPackages,
        goodsCost: moved.cost,
        freightCost: moved.freight,
      },
    })
    const processingOutput = await tx.processingOutput.create({
      data: {
        jobId: job.id,
        lotId: outputLot.id,
        weight: outputWeight,
        packages: outputPackages ?? null,
        allocatedGoodsCost: moved.cost,
        allocatedFreight: moved.freight,
      },
    })
    const settlement = await tx.processingFeeSettlement.create({
      data: {
        warehouseId: row.warehouseId,
        variantId: row.variantId,
        batchNo: row.batch.batchNo,
        inputWeight,
        outputWeight,
        feePerKg: fee,
        feeTotal,
        remainingWeight: remaining,
        newUnitCost,
        handlerName: input.handlerName ?? '未知',
        processingJobId: job.id,
      },
    })
    await recordMovement(tx, {
      lotId: inputLot.id,
      type: 'PROCESS_CONSUME',
      referenceType: 'PROCESSING_JOB',
      referenceId: job.id,
      referenceItemId: processingInput.id,
      fromWarehouseId: row.warehouseId,
      weight: inputWeight,
      packages: inputPackages,
      goodsCost: moved.cost,
      freightCost: moved.freight,
      occurredAt,
    })
    await recordMovement(tx, {
      lotId: outputLot.id,
      type: 'PROCESS_PRODUCE',
      referenceType: 'PROCESSING_JOB',
      referenceId: job.id,
      referenceItemId: processingOutput.id,
      toWarehouseId: row.warehouseId,
      weight: outputWeight,
      packages: outputPackages ?? null,
      goodsCost: newCost,
      freightCost: moved.freight,
      occurredAt,
    })
    await refreshLotStatus(tx, inputLot.id)

    return {
      row,
      job,
      settlement,
      inputLot,
      outputLot,
      outputInventory,
      fee,
      inputWeight,
      inputPackages,
      remainingWeight: remaining,
      feeTotal,
      outputWeight,
      outputPackages,
      newCost,
      newUnitCost,
      identityChanged,
      newSpec: spec,
      newColor: color,
      newUnit: unit,
      newBatchNo: batchNo,
    }
  })
}

export interface ProcessingReturnItemInput {
  inventoryId: string
  weight: number
  spec: string
  color: string
  unit: string
  batchNo: string
  outputWeight: number
  packages?: number | null
}

export interface ProcessingReturnInput {
  date: Date
  factoryId: string
  warehouseId: string
  handlerName: string
  note?: string | null
  processingFeePerKg?: number | null
  freight?: number
  expectedSellPricePerKg?: number | null
  items: ProcessingReturnItemInput[]
}

export async function createProcessingReturn(db: PrismaClient, input: ProcessingReturnInput) {
  return db.$transaction(async (tx) => {
    assertUniqueInventoryItems(input.items)
    if (input.factoryId === input.warehouseId) throw new Error('加工厂与目标仓库不能相同')
    const factory = await tx.warehouse.findUnique({ where: { id: input.factoryId } })
    const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId } })
    if (!factory || !factory.active || factory.type !== 'FACTORY') {
      throw new Error('来源仓库必须是加工厂且处于启用状态')
    }
    if (!warehouse || !warehouse.active || warehouse.type !== 'WAREHOUSE') {
      throw new Error('目标仓库必须是普通仓库且处于启用状态')
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
      if (row.warehouseId !== input.factoryId) {
        throw new Error(
          `库存 ${row.variant.yarn.name} ${row.variant.spec} ${row.variant.color} 不在加工厂`,
        )
      }
      const movedWeight = new Prisma.Decimal(input.items[i].weight).toDecimalPlaces(2)
      if (movedWeight.lessThanOrEqualTo(0)) throw new Error('返仓重量必须大于 0')
      if (row.weight.lessThan(movedWeight)) {
        throw new Error(
          `库存不足：${row.variant.yarn.name} ${row.variant.spec} ${row.variant.color} 批次 ${row.batch.batchNo}，现有 ${row.weight} kg`,
        )
      }
      if (row.warehouse.type === 'FACTORY' && !row.processingFeeSettled) {
        throw new Error(
          `该批货未结算加工费，无法出加工厂：${row.variant.yarn.name} ${row.variant.spec} ${row.variant.color} 批次 ${row.batch.batchNo}`,
        )
      }
      const submittedOutputWeight = new Prisma.Decimal(input.items[i].outputWeight).toDecimalPlaces(2)
      if (!submittedOutputWeight.equals(movedWeight)) {
        throw new Error('加工后重量已在完工核算时确定，返仓重量必须与本次移出重量一致')
      }
      const packages = input.items[i].packages
      if (
        packages !== null &&
        packages !== undefined &&
        (!Number.isInteger(packages) || packages < 0)
      ) {
        throw new Error('返仓件数必须是非负整数')
      }
      if (packages !== null && packages !== undefined && row.packages !== null && packages > row.packages) {
        throw new Error(`返仓件数不能超过当前库存：现有 ${row.packages} 件`)
      }
    }

    const order = await tx.processingReturn.create({
      data: {
        orderNo: await nextOrderNo('PR', (base) =>
          tx.processingReturn.findMany({
            where: { orderNo: { startsWith: base } },
            select: { orderNo: true },
          }),
        ),
        date: input.date,
        factoryId: input.factoryId,
        warehouseId: input.warehouseId,
        handlerName: input.handlerName,
        note: input.note ?? null,
        processingFeePerKg: 0,
        freight: input.freight ?? 0,
        expectedSellPricePerKg: input.expectedSellPricePerKg ?? null,
      },
    })

    const totalMovedWeight = input.items.reduce(
      (s, it) => s.plus(new Prisma.Decimal(it.weight)),
      new Prisma.Decimal(0),
    )
    const totalBackFreight = new Prisma.Decimal(input.freight ?? 0).toDecimalPlaces(2)

    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]
      const row = rows[i]!
      const movedWeight = new Prisma.Decimal(it.weight).toDecimalPlaces(2)
      const packages =
        it.packages ?? (movedWeight.equals(row.weight) ? row.packages : null)
      if (!movedWeight.equals(row.weight) && row.packages !== null && it.packages == null) {
        throw new Error('部分返仓时必须填写本次返仓件数')
      }
      const moved = portionOf(row, movedWeight)
      const addedFreight =
        i === input.items.length - 1
          ? totalBackFreight.minus(
              input.items.slice(0, -1).reduce(
                (sum, item) =>
                  sum.plus(
                    totalMovedWeight.greaterThan(0)
                      ? totalBackFreight
                          .mul(new Prisma.Decimal(item.weight))
                          .div(totalMovedWeight)
                          .toDecimalPlaces(2)
                      : 0,
                  ),
                new Prisma.Decimal(0),
              ),
            )
          : totalMovedWeight.greaterThan(0)
            ? totalBackFreight.mul(movedWeight).div(totalMovedWeight).toDecimalPlaces(2)
            : new Prisma.Decimal(0)
      const newCost = moved.cost
      const newFreight = moved.freight.plus(addedFreight).toDecimalPlaces(2)
      const lot = row.lot ?? (await ensureInventoryLot(tx, row))

      await subtractFromBalance(tx, row, movedWeight, packages)
      const destination = await addToLotBalance(
        tx,
        {
          lotId: lot.id,
          warehouseId: input.warehouseId,
          variantId: row.variantId,
          batchId: row.batchId,
          processingCostCalculated: true,
        },
        {
          weight: movedWeight,
          packages,
          cost: newCost,
          freight: newFreight,
        },
        row.processingFeePerKg ?? undefined,
      )
      const returnItem = await tx.processingReturnItem.create({
        data: {
          orderId: order.id,
          inventoryId: row.id,
          weight: movedWeight,
          variantId: row.variantId,
          batchNo: row.batch.batchNo,
          outputWeight: movedWeight,
          packages,
          newCost,
          newFreight,
          outputLotId: lot.id,
          destinationInventoryId: destination.id,
        },
      })
      if (!addedFreight.isZero()) {
        await tx.inventoryLot.update({
          where: { id: lot.id },
          data: { freightCost: lot.freightCost.plus(addedFreight).toDecimalPlaces(2) },
        })
      }
      await recordMovement(tx, {
        lotId: lot.id,
        type: 'TRANSFER',
        referenceType: 'PROCESSING_RETURN',
        referenceId: order.id,
        referenceItemId: returnItem.id,
        fromWarehouseId: input.factoryId,
        toWarehouseId: input.warehouseId,
        weight: movedWeight,
        packages,
        goodsCost: moved.cost,
        freightCost: newFreight,
        occurredAt: input.date,
      })
    }

    return tx.processingReturn.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        items: {
          include: {
            inventory: { include: { variant: { include: { yarn: true } }, batch: true } },
            variant: { include: { yarn: true } },
          },
        },
        factory: true,
        warehouse: true,
      },
    })
  })
}
