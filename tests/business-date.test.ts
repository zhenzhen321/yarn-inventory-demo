import { describe, expect, it } from 'vitest'
import { businessDateFromInput, businessDateToday, formatBusinessDate } from '@/lib/business-date'

describe('北京时间业务日期', () => {
  it('北京时间凌晨使用北京时间当天作为默认日期', () => {
    expect(businessDateToday(new Date('2026-09-05T18:00:00.000Z'))).toBe('2026-09-06')
  })

  it('操作时选择的日期按原日历日期保存和显示', () => {
    const date = businessDateFromInput('2026-09-06')
    expect(date.toISOString()).toBe('2026-09-06T00:00:00.000Z')
    expect(formatBusinessDate(date)).toBe('2026-09-06')
  })

  it('拒绝会被 JavaScript 自动滚动到下月的无效日期', () => {
    expect(() => businessDateFromInput('2026-02-31')).toThrow('业务日期不正确')
  })
})
