import { Prisma } from '@prisma/client'

export function amount(weight: number, price: number): Prisma.Decimal {
  return new Prisma.Decimal(weight).mul(price).toDecimalPlaces(2)
}

export function dateYmd(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

export async function nextOrderNo(
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

export function assertUniqueInventoryItems(items: { inventoryId: string }[]): void {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.inventoryId)) {
      throw new Error('同一库存不能重复选择，请合并为一条明细')
    }
    seen.add(item.inventoryId)
  }
}

export function resolveMovedPackages(
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

export async function getOrCreateBatch(
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
  const count = (await tx.batch.count({ where: { variantId: variant.id } })) + 1
  return tx.batch.create({
    data: {
      variantId: variant.id,
      batchNo: `${variant.yarn.name}-${dateYmd(new Date())}-${count}`,
    },
  })
}

export async function getOrCreateVariant(
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
