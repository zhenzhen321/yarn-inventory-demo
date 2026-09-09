import type { Prisma, PrismaClient } from '@prisma/client'

export interface SaleInventoryRow {
  id: string
  warehouseId: string
  warehouseName: string
  yarnName: string
  spec: string
  color: string | null
  unit: string
  batchNo: string
  lotNo: string | null
  scanCode: string | null
  weight: string
  packages: number | null
  processingFeeSettled: boolean
}

const inventorySelect = {
  id: true,
  warehouseId: true,
  weight: true,
  packages: true,
  processingFeeSettled: true,
  warehouse: { select: { name: true, type: true } },
  variant: { select: { spec: true, color: true, unit: true, yarn: { select: { name: true } } } },
  batch: { select: { batchNo: true } },
  lot: { select: { lotNo: true, scanCode: true } },
} as const

type SaleInventoryRecord = Prisma.InventoryGetPayload<{ select: typeof inventorySelect }>

function toRow(row: SaleInventoryRecord): SaleInventoryRow {
  return {
    id: row.id,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    yarnName: row.variant.yarn.name,
    spec: row.variant.spec,
    color: row.variant.color,
    unit: row.variant.unit,
    batchNo: row.batch.batchNo,
    lotNo: row.lot?.lotNo ?? null,
    scanCode: row.lot?.scanCode ?? null,
    weight: row.weight.toString(),
    packages: row.packages,
    processingFeeSettled: row.processingFeeSettled,
  }
}

function payload(code: string) {
  return code.match(/^YMS-[^-]+-(.+)$/)?.[1] ?? null
}

function allowed(row: SaleInventoryRecord) {
  return row.warehouse.type !== 'FACTORY' || row.processingFeeSettled
}

export async function getSaleInventoryOptions(db: PrismaClient, warehouseId: string) {
  const rows = await db.inventory.findMany({
    where: { warehouseId, weight: { gt: 0 }, archived: false },
    select: inventorySelect,
    orderBy: [{ warehouse: { name: 'asc' } }, { variant: { yarn: { name: 'asc' } } }, { batch: { batchNo: 'asc' } }],
  })
  return rows.filter(allowed).map(toRow)
}

export async function findSaleInventoryOption(db: PrismaClient, warehouseId: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase()
  if (!code) return null
  const scanPayload = payload(code)
  const candidates = await db.inventory.findMany({
    where: {
      weight: { gt: 0 },
      archived: false,
      lot: {
        is: {
          OR: [
            { lotNo: code },
            { scanCode: code },
            ...(scanPayload ? [{ scanCode: { contains: scanPayload } }] : []),
          ],
        },
      },
    },
    select: inventorySelect,
    orderBy: [{ warehouse: { name: 'asc' } }, { variant: { yarn: { name: 'asc' } } }, { id: 'asc' }],
  })
  const matches = candidates.filter((row) => {
    const lotNo = row.lot?.lotNo?.toUpperCase()
    const scanCode = row.lot?.scanCode?.toUpperCase()
    const rowPayload = scanCode ? payload(scanCode) : null
    return lotNo === code || scanCode === code || (scanPayload !== null && rowPayload === scanPayload)
  })
  const selected = matches.find((row) => row.warehouseId === warehouseId) ?? matches[0]
  return selected ? toRow(selected) : null
}
