import { Prisma, PrismaClient } from '@prisma/client'
import { allocateAmountByWeight } from '@/lib/money'
import { addToLotBalance, createLot, recordMovement } from '../lots'
import { runIdempotent } from '../idempotency'
import { amount, getOrCreateBatch, getOrCreateVariant, nextOrderNo } from './shared'

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

async function createPurchaseInTransaction(
  tx: Prisma.TransactionClient,
  input: PurchaseInput,
) {
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
    const orderFreight = new Prisma.Decimal(input.freight ?? 0)
    const itemFreights = allocateAmountByWeight(
      input.items.map((item) => new Prisma.Decimal(item.weight)),
      orderFreight,
    )

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

    for (let index = 0; index < input.items.length; index++) {
      const it = input.items[index]
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
      const itemFreight = itemFreights[index]
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
}

export function createPurchase(
  db: PrismaClient,
  input: PurchaseInput,
) {
  return db.$transaction((tx) => createPurchaseInTransaction(tx, input))
}

export function createPurchaseIdempotent(
  db: PrismaClient,
  input: PurchaseInput,
  idempotencyKey?: string,
) {
  return runIdempotent(
    db,
    'PURCHASE_CREATE',
    idempotencyKey,
    input,
    (tx) => createPurchaseInTransaction(tx, input),
    (tx, resourceId) => tx.purchaseOrder.findUniqueOrThrow({
      where: { id: resourceId },
      include: {
        items: { include: { variant: { include: { yarn: true } }, batch: true, lot: true } },
        supplier: true,
        warehouse: true,
      },
    }),
  )
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
    const weights = items.map((item) => item.weight)
    const oldArr = allocateAmountByWeight(weights, oldFreight)
    const newArr = allocateAmountByWeight(weights, newFreight)
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
