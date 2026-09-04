import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'

export type InventoryTx = Prisma.TransactionClient

function dateYmd(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

export async function nextLotNo(tx: InventoryTx, date: Date): Promise<string> {
  const base = `LOT-${dateYmd(date)}-`
  const rows = await tx.inventoryLot.findMany({
    where: { lotNo: { startsWith: base } },
    select: { lotNo: true },
  })
  const max = rows.reduce((current, row) => {
    const suffix = row.lotNo.slice(base.length)
    const value = /^\d+$/.test(suffix) ? Number(suffix) : 0
    return Number.isSafeInteger(value) ? Math.max(current, value) : current
  }, 0)
  return `${base}${String(max + 1).padStart(4, '0')}`
}

export function newScanCode(): string {
  return `YMS-L-${randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`
}

export interface CreateLotInput {
  date: Date
  sourceType: 'PURCHASE' | 'PROCESSING' | 'LEGACY_AGGREGATED'
  provenanceQuality?: 'EXACT' | 'LEGACY_AGGREGATED'
  variantId: string
  batchId: string
  initialWeight: Prisma.Decimal
  initialPackages?: number | null
  goodsCost: Prisma.Decimal
  freightCost: Prisma.Decimal
  processingCost?: Prisma.Decimal
  status?: 'AVAILABLE' | 'AWAITING_PROCESS' | 'CONSUMED' | 'ARCHIVED'
}

export async function createLot(tx: InventoryTx, input: CreateLotInput) {
  return tx.inventoryLot.create({
    data: {
      lotNo: await nextLotNo(tx, input.date),
      scanCode: newScanCode(),
      sourceType: input.sourceType,
      provenanceQuality: input.provenanceQuality ?? 'EXACT',
      variantId: input.variantId,
      batchId: input.batchId,
      initialWeight: input.initialWeight,
      initialPackages: input.initialPackages ?? null,
      goodsCost: input.goodsCost,
      freightCost: input.freightCost,
      processingCost: input.processingCost ?? 0,
      status: input.status ?? 'AVAILABLE',
    },
  })
}

export async function ensureInventoryLot(
  tx: InventoryTx,
  row: {
    id: string
    lotId: string | null
    variantId: string
    batchId: string
    weight: Prisma.Decimal
    packages: number | null
    cost: Prisma.Decimal
    freight: Prisma.Decimal
    archived: boolean
    updatedAt: Date
  },
) {
  if (row.lotId) {
    return tx.inventoryLot.findUniqueOrThrow({ where: { id: row.lotId } })
  }
  const lot = await tx.inventoryLot.create({
    data: {
      lotNo: `LEGACY-${row.id.slice(0, 12)}`,
      scanCode: `YMS-L-LEGACY-${row.id}`,
      sourceType: 'LEGACY_AGGREGATED',
      provenanceQuality: 'LEGACY_AGGREGATED',
      variantId: row.variantId,
      batchId: row.batchId,
      initialWeight: row.weight,
      initialPackages: row.packages,
      goodsCost: row.cost,
      freightCost: row.freight,
      status: row.archived ? 'ARCHIVED' : row.weight.greaterThan(0) ? 'AVAILABLE' : 'CONSUMED',
      createdAt: row.updatedAt,
    },
  })
  await tx.inventory.update({ where: { id: row.id }, data: { lotId: lot.id } })
  return lot
}

export interface BalanceDelta {
  weight: Prisma.Decimal
  packages?: number | null
  cost: Prisma.Decimal
  freight: Prisma.Decimal
}

export async function addToLotBalance(
  tx: InventoryTx,
  key: {
    lotId: string
    warehouseId: string
    variantId: string
    batchId: string
    processingCostCalculated: boolean
  },
  delta: BalanceDelta,
  processingFeePerKg?: Prisma.Decimal,
) {
  const existing = await tx.inventory.findFirst({
    where: {
      lotId: key.lotId,
      warehouseId: key.warehouseId,
      processingFeeSettled: key.processingCostCalculated,
      archived: false,
    },
  })
  if (!existing) {
    return tx.inventory.create({
      data: {
        lotId: key.lotId,
        warehouseId: key.warehouseId,
        variantId: key.variantId,
        batchId: key.batchId,
        processingFeeSettled: key.processingCostCalculated,
        processingFeePerKg,
        weight: delta.weight,
        packages: delta.packages ?? null,
        cost: delta.cost,
        freight: delta.freight,
      },
    })
  }
  const packages =
    delta.packages === undefined || delta.packages === null
      ? existing.packages
      : (existing.packages ?? 0) + delta.packages
  const nextWeight = existing.weight.plus(delta.weight).toDecimalPlaces(2)
  const nextCost = existing.cost.plus(delta.cost).toDecimalPlaces(2)
  const nextFreight = existing.freight.plus(delta.freight).toDecimalPlaces(2)
  return tx.inventory.update({
    where: { id: existing.id },
    data: {
      weight: nextWeight,
      cost: nextCost,
      freight: nextFreight,
      packages,
      version: { increment: 1 },
      ...(processingFeePerKg !== undefined ? { processingFeePerKg } : {}),
    },
  })
}

export function portionOf(
  row: { weight: Prisma.Decimal; cost: Prisma.Decimal; freight: Prisma.Decimal },
  weight: Prisma.Decimal,
) {
  if (row.weight.lessThanOrEqualTo(0)) throw new Error('库存重量为 0，无法分配')
  return {
    cost: row.cost.mul(weight).div(row.weight).toDecimalPlaces(2),
    freight: row.freight.mul(weight).div(row.weight).toDecimalPlaces(2),
  }
}

export async function subtractFromBalance(
  tx: InventoryTx,
  row: {
    id: string
    weight: Prisma.Decimal
    packages: number | null
    cost: Prisma.Decimal
    freight: Prisma.Decimal
    version: number
  },
  weight: Prisma.Decimal,
  packages?: number | null,
) {
  if (weight.lessThanOrEqualTo(0)) throw new Error('重量必须大于 0')
  if (row.weight.lessThan(weight)) throw new Error('库存不足')
  if (packages !== undefined && packages !== null) {
    if (packages < 0) throw new Error('件数不能为负')
    if (row.packages !== null && row.packages < packages) throw new Error('库存件数不足')
  }
  const part = portionOf(row, weight)
  const nextWeight = row.weight.minus(weight).toDecimalPlaces(2)
  const nextCost = row.cost.minus(part.cost).toDecimalPlaces(2)
  const nextFreight = row.freight.minus(part.freight).toDecimalPlaces(2)
  const nextPackages =
    packages === undefined || packages === null || row.packages === null
      ? row.packages
      : row.packages - packages
  const updated = await tx.inventory.updateMany({
    where: { id: row.id, version: row.version, weight: { gte: weight }, archived: false },
    data: {
      weight: nextWeight,
      cost: nextCost,
      freight: nextFreight,
      packages: nextPackages,
      version: { increment: 1 },
    },
  })
  if (updated.count !== 1) throw new Error('库存已被其他操作修改，请刷新后重试')
  return part
}

export interface MovementInput {
  lotId: string
  type:
    | 'PURCHASE_RECEIPT'
    | 'TRANSFER'
    | 'PROCESS_CONSUME'
    | 'PROCESS_PRODUCE'
    | 'SALE'
    | 'STOCKTAKE'
    | 'REVERSAL'
  referenceType: string
  referenceId: string
  referenceItemId?: string | null
  fromWarehouseId?: string | null
  toWarehouseId?: string | null
  weight: Prisma.Decimal
  packages?: number | null
  goodsCost?: Prisma.Decimal
  freightCost?: Prisma.Decimal
  reversalOfId?: string | null
  occurredAt: Date
}

export function recordMovement(tx: InventoryTx, input: MovementInput) {
  return tx.stockMovement.create({
    data: {
      ...input,
      referenceItemId: input.referenceItemId ?? null,
      fromWarehouseId: input.fromWarehouseId ?? null,
      toWarehouseId: input.toWarehouseId ?? null,
      packages: input.packages ?? null,
      goodsCost: input.goodsCost ?? 0,
      freightCost: input.freightCost ?? 0,
      reversalOfId: input.reversalOfId ?? null,
    },
  })
}

export async function refreshLotStatus(tx: InventoryTx, lotId: string) {
  const aggregate = await tx.inventory.aggregate({
    where: { lotId, archived: false },
    _sum: { weight: true },
  })
  const remaining = aggregate._sum.weight ?? new Prisma.Decimal(0)
  if (remaining.lessThanOrEqualTo(0)) {
    await tx.inventoryLot.update({ where: { id: lotId }, data: { status: 'CONSUMED' } })
  }
}
