import { Prisma, PrismaClient } from '@prisma/client'

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

async function mergeInventory(
  tx: Prisma.TransactionClient,
  key: { warehouseId: string; variantId: string; batchId: string; settled: boolean },
  delta: { weight: Prisma.Decimal; cost: Prisma.Decimal; freight: Prisma.Decimal },
  feePerKg?: Prisma.Decimal,
) {
  const existing = await tx.inventory.findFirst({
    where: {
      warehouseId: key.warehouseId,
      variantId: key.variantId,
      batchId: key.batchId,
      processingFeeSettled: key.settled,
      archived: false,
    },
  })
  if (existing) {
    return tx.inventory.update({
      where: { id: existing.id },
      data: {
        weight: { increment: delta.weight },
        cost: { increment: delta.cost },
        freight: { increment: delta.freight },
        ...(feePerKg !== undefined ? { processingFeePerKg: feePerKg } : {}),
      },
    })
  }
  return tx.inventory.create({
    data: {
      warehouseId: key.warehouseId,
      variantId: key.variantId,
      batchId: key.batchId,
      processingFeeSettled: key.settled,
      weight: delta.weight,
      cost: delta.cost,
      freight: delta.freight,
      ...(feePerKg !== undefined ? { processingFeePerKg: feePerKg } : {}),
    },
  })
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
    if (!warehouse?.active || warehouse.type !== 'WAREHOUSE') {
      throw new Error('入库仓库不存在、已停用或类型不正确')
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
      await tx.purchaseItem.create({
        data: {
          orderId: order.id,
          variantId: variant.id,
          batchId: batch.id,
          weight: it.weight,
          price: it.price,
          amount: itemAmount,
          packages: it.packages ?? null,
        },
      })
      await mergeInventory(
        tx,
        {
          warehouseId: input.warehouseId,
          variantId: variant.id,
          batchId: batch.id,
          settled: false,
        },
        { weight: new Prisma.Decimal(it.weight), cost: itemAmount, freight: itemFreight },
      )
    }

    return tx.purchaseOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        items: { include: { variant: { include: { yarn: true } }, batch: true } },
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
      include: { items: true },
    })
    if (!order) throw new Error('买入单不存在')
    const items = order.items
    const totalWeight = items.reduce(
      (s, it) => s.plus(new Prisma.Decimal(it.weight)),
      new Prisma.Decimal(0),
    )
    if (totalWeight.lessThanOrEqualTo(0)) throw new Error('买入单没有有效重量')
    const newFreight = new Prisma.Decimal(freight).toDecimalPlaces(2)
    if (newFreight.lessThan(0)) throw new Error('运费不能为负')
    const inventoryKeys = new Set(items.map((item) => `${item.variantId}|${item.batchId}`))
    for (const key of inventoryKeys) {
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
      const row = await tx.inventory.findFirst({
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
        data: { freight: { increment: delta } },
      })
    }
    return tx.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: {
        items: { include: { variant: { include: { yarn: true } }, batch: true } },
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
          include: { warehouse: true, variant: { include: { yarn: true } }, batch: true },
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
      await tx.saleItem.create({
        data: {
          orderId: order.id,
          inventoryId: row.id,
          weight: it.weight,
          price: it.price,
          amount: amount(it.weight, it.price),
          packages: it.packages ?? null,
          unitCost,
          unitFreight,
        },
      })
      const soldCost = row.cost.mul(it.weight).div(row.weight).toDecimalPlaces(2)
      const soldFreight = row.freight.mul(it.weight).div(row.weight).toDecimalPlaces(2)
      await tx.inventory.update({
        where: { id: row.id },
        data: {
          weight: { decrement: it.weight },
          cost: { decrement: soldCost },
          freight: { decrement: soldFreight },
        },
      })
    }

    return tx.saleOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        items: {
          include: { inventory: { include: { variant: { include: { yarn: true } }, batch: true } } },
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
          include: { warehouse: true, variant: { include: { yarn: true } }, batch: true },
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
      const movedCost = row.cost.mul(it.weight).div(row.weight).toDecimalPlaces(2)
      const movedFreight = row.freight.mul(it.weight).div(row.weight).toDecimalPlaces(2)
      const addedFreight = unitTransferFreight.mul(it.weight).toDecimalPlaces(2)
      await tx.transferItem.create({
        data: {
          orderId: order.id,
          inventoryId: row.id,
          weight: it.weight,
          packages: it.packages ?? null,
        },
      })
      await tx.inventory.update({
        where: { id: row.id },
        data: {
          weight: { decrement: it.weight },
          cost: { decrement: movedCost },
          freight: { decrement: movedFreight },
        },
      })
      await mergeInventory(
        tx,
        {
          warehouseId: input.toWarehouseId,
          variantId: row.variantId,
          batchId: row.batchId,
          settled: false,
        },
        {
          weight: new Prisma.Decimal(it.weight),
          cost: movedCost,
          freight: movedFreight.plus(addedFreight),
        },
      )
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
      input.items.map((it) => tx.inventory.findUnique({ where: { id: it.inventoryId } })),
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
      await tx.inventory.update({
        where: { id: row.id },
        data: { weight: actual, cost: newCost, freight: newFreight },
      })
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
    include: { warehouse: true, variant: { include: { yarn: true } }, batch: true },
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
  handlerName?: string
  spec?: string
  color?: string
  unit?: string
  batchNo?: string
  outputWeight?: number
}

export async function settleProcessingFee(
  db: PrismaClient,
  inventoryId: string,
  input: ProcessingFeeSettleInput,
) {
  return db.$transaction(async (tx) => {
    const row = await tx.inventory.findUnique({
      where: { id: inventoryId },
      include: { warehouse: true, variant: { include: { yarn: true } }, batch: true },
    })
    if (!row) throw new Error('库存记录不存在')
    if (row.warehouse.type !== 'FACTORY') throw new Error('只有加工厂库存可以结算加工费')
    if (row.processingFeeSettled) throw new Error('该批货已结算过加工费')
    if (row.weight.lessThanOrEqualTo(0)) throw new Error('库存重量为 0，无法结算加工费')
    const fee = new Prisma.Decimal(input.feePerKg).toDecimalPlaces(2)
    if (fee.lessThan(0)) throw new Error('加工费不能为负')
    const inputWeight = new Prisma.Decimal(
      input.inputWeight ?? Number(row.weight),
    ).toDecimalPlaces(2)
    if (inputWeight.lessThanOrEqualTo(0)) throw new Error('本次加工重量必须大于 0')
    if (inputWeight.greaterThan(row.weight)) {
      throw new Error(`本次加工重量不能超过当前库存：现有 ${row.weight} kg`)
    }
    const spec = (input.spec ?? row.variant.spec).trim()
    const color = (input.color ?? row.variant.color).trim()
    const unit = (input.unit ?? row.variant.unit).trim()
    const batchNo = (input.batchNo ?? row.batch.batchNo).trim()
    const outputWeight = new Prisma.Decimal(
      input.outputWeight ?? Number(inputWeight),
    ).toDecimalPlaces(2)
    if (outputWeight.lessThanOrEqualTo(0)) throw new Error('加工后重量必须大于 0')
    const identityChanged =
      spec !== row.variant.spec ||
      color !== row.variant.color ||
      unit !== row.variant.unit ||
      batchNo !== row.batch.batchNo
    if (identityChanged && (!spec || !color || !unit || !batchNo)) {
      throw new Error('加工后信息变化时，支数/色号/单位/批次必填')
    }
    const movedCost = row.cost.mul(inputWeight).div(row.weight).toDecimalPlaces(2)
    const movedFreight = row.freight.mul(inputWeight).div(row.weight).toDecimalPlaces(2)
    const feeTotal = fee.mul(outputWeight).toDecimalPlaces(2)
    const newCost = movedCost.plus(feeTotal).toDecimalPlaces(2)
    const newUnitCost = newCost.div(outputWeight).toDecimalPlaces(2)

    // 1) 产出先合并进已算行（此时原行仍未算，findFirst 不会误命中原行）
    let targetVariantId = row.variantId
    let targetBatchId = row.batchId
    if (identityChanged) {
      const variant = await getOrCreateVariant(tx, row.variant.yarnId, spec, color, unit)
      const batch = await getOrCreateBatch(tx, variant, batchNo)
      targetVariantId = variant.id
      targetBatchId = batch.id
    }
    await mergeInventory(
      tx,
      {
        warehouseId: row.warehouseId,
        variantId: targetVariantId,
        batchId: targetBatchId,
        settled: true,
      },
      { weight: outputWeight, cost: newCost, freight: movedFreight },
      fee,
    )

    // 2) 原行按比例扣减；归零时标记已算
    const remaining = row.weight.minus(inputWeight)
    await tx.inventory.update({
      where: { id: inventoryId },
      data: {
        weight: remaining,
        cost: row.cost.minus(movedCost),
        freight: row.freight.minus(movedFreight),
        ...(remaining.isZero() ? { processingFeeSettled: true, archived: true } : {}),
      },
    })
    await tx.processingFeeSettlement.create({
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
      },
    })

    return {
      row,
      fee,
      inputWeight,
      remainingWeight: remaining,
      feeTotal,
      outputWeight,
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
          include: { warehouse: true, variant: { include: { yarn: true } }, batch: true },
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
      if (row.weight.lessThan(input.items[i].weight)) {
        throw new Error(
          `库存不足：${row.variant.yarn.name} ${row.variant.spec} ${row.variant.color} 批次 ${row.batch.batchNo}，现有 ${row.weight} kg`,
        )
      }
      if (row.warehouse.type === 'FACTORY' && !row.processingFeeSettled) {
        throw new Error(
          `该批货未结算加工费，无法出加工厂：${row.variant.yarn.name} ${row.variant.spec} ${row.variant.color} 批次 ${row.batch.batchNo}`,
        )
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
        processingFeePerKg: input.processingFeePerKg ?? 0,
        freight: input.freight ?? 0,
        expectedSellPricePerKg: input.expectedSellPricePerKg ?? null,
      },
    })

    const totalOutputWeight = input.items.reduce(
      (s, it) => s.plus(new Prisma.Decimal(it.outputWeight)),
      new Prisma.Decimal(0),
    )
    const unitBackFreight = totalOutputWeight.greaterThan(0)
      ? new Prisma.Decimal(input.freight ?? 0).div(totalOutputWeight).toDecimalPlaces(2)
      : new Prisma.Decimal(0)

    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]
      const row = rows[i]!
      const feeTotal = new Prisma.Decimal(input.processingFeePerKg ?? 0)
        .mul(it.outputWeight)
        .toDecimalPlaces(2)
      const movedCost = row.cost.mul(it.weight).div(row.weight).toDecimalPlaces(2)
      const movedFreight = row.freight.mul(it.weight).div(row.weight).toDecimalPlaces(2)
      const newUnitCost = movedCost.plus(feeTotal).div(it.outputWeight).toDecimalPlaces(2)
      const newUnitFreight = movedFreight
        .div(it.outputWeight)
        .toDecimalPlaces(2)
        .plus(unitBackFreight)
      const newCost = newUnitCost.mul(it.outputWeight).toDecimalPlaces(2)
      const newFreight = newUnitFreight.mul(it.outputWeight).toDecimalPlaces(2)

      // 按（所属产品 + 支数 + 色号 + 单位）查找或创建收回变体
      const variant = await getOrCreateVariant(
        tx,
        row.variant.yarnId,
        it.spec,
        it.color,
        it.unit,
      )
      const batch = await getOrCreateBatch(tx, variant, it.batchNo)

      await tx.processingReturnItem.create({
        data: {
          orderId: order.id,
          inventoryId: row.id,
          weight: it.weight,
          variantId: variant.id,
          batchNo: it.batchNo,
          outputWeight: it.outputWeight,
          packages: it.packages ?? null,
          newCost,
          newFreight,
        },
      })
      await tx.inventory.update({
        where: { id: row.id },
        data: {
          weight: { decrement: it.weight },
          cost: { decrement: movedCost },
          freight: { decrement: movedFreight },
        },
      })
      await mergeInventory(
        tx,
        {
          warehouseId: input.warehouseId,
          variantId: variant.id,
          batchId: batch.id,
          settled: false,
        },
        { weight: new Prisma.Decimal(it.outputWeight), cost: newCost, freight: newFreight },
      )
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
