import { Prisma } from '@prisma/client'

export function allocateAmountByWeight(
  weights: Prisma.Decimal[],
  total: Prisma.Decimal,
): Prisma.Decimal[] {
  if (weights.length === 0) return []
  const totalWeight = weights.reduce((sum, weight) => sum.plus(weight), new Prisma.Decimal(0))
  if (totalWeight.lessThanOrEqualTo(0)) throw new Error('分摊重量必须大于 0')

  const roundedTotal = total.toDecimalPlaces(2)
  const allocated = weights.map((weight) =>
    roundedTotal.mul(weight).div(totalWeight).toDecimalPlaces(2),
  )
  const allocatedTotal = allocated.reduce(
    (sum, value) => sum.plus(value),
    new Prisma.Decimal(0),
  )
  allocated[allocated.length - 1] = allocated[allocated.length - 1]
    .plus(roundedTotal.minus(allocatedTotal))
    .toDecimalPlaces(2)
  return allocated
}

export function formatYuan(value: Prisma.Decimal | string | number): string {
  const fixed = new Prisma.Decimal(value).toFixed(2)
  const sign = fixed.startsWith('-') ? '-' : ''
  const abs = fixed.replace('-', '')
  const [int, frac] = abs.split('.')
  const withComma = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}¥${withComma}.${frac}`
}
