import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { allocateAmountByWeight, formatYuan } from '@/lib/money'

describe('formatYuan', () => {
  it('格式化正数并带千分位', () => {
    expect(formatYuan('1234.5')).toBe('¥1,234.50')
  })
  it('保留两位小数', () => {
    expect(formatYuan(99)).toBe('¥99.00')
  })
  it('负数显示负号', () => {
    expect(formatYuan('-1234.5')).toBe('-¥1,234.50')
  })
})

describe('按重量分摊金额', () => {
  it('每行保留两位并把尾差补到最后一行，合计精确等于总额', () => {
    const allocated = allocateAmountByWeight(
      [new Prisma.Decimal(3000), new Prisma.Decimal(1)],
      new Prisma.Decimal(100),
    )

    expect(allocated.map((value) => value.toString())).toEqual(['99.97', '0.03'])
    expect(allocated.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toString()).toBe(
      '100',
    )
  })
})
