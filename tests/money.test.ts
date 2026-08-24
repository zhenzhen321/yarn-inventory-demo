import { describe, expect, it } from 'vitest'
import { formatYuan } from '@/lib/money'

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
