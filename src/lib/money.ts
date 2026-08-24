import { Prisma } from '@prisma/client'

export function formatYuan(value: Prisma.Decimal | string | number): string {
  const fixed = new Prisma.Decimal(value).toFixed(2)
  const sign = fixed.startsWith('-') ? '-' : ''
  const abs = fixed.replace('-', '')
  const [int, frac] = abs.split('.')
  const withComma = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}¥${withComma}.${frac}`
}
