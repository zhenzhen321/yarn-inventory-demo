import { describe, expect, it } from 'vitest'
import { evaluateExpression, resolveNumeric } from '@/lib/expression'

describe('算式求值', () => {
  it('乘法与加法算式', () => {
    expect(evaluateExpression('52*25')).toBe(1300)
    expect(evaluateExpression('600+900')).toBe(1500)
  })

  it('除法、括号与小数', () => {
    expect(evaluateExpression('10/4')).toBe(2.5)
    expect(evaluateExpression('(2+3)*4')).toBe(20)
    expect(evaluateExpression('1.5*2')).toBe(3)
  })

  it('容忍空格', () => {
    expect(evaluateExpression('12 * 3')).toBe(36)
  })

  it('非法输入返回 null', () => {
    expect(evaluateExpression('')).toBeNull()
    expect(evaluateExpression('abc')).toBeNull()
    expect(evaluateExpression('5++3')).toBeNull()
    expect(evaluateExpression('5%3')).toBeNull()
    expect(evaluateExpression('-5')).toBeNull()
    expect(evaluateExpression('(2+3')).toBeNull()
    expect(evaluateExpression('1 2')).toBeNull()
    expect(evaluateExpression('10/0')).toBeNull()
  })

  it('结果四舍五入保留 4 位小数', () => {
    expect(evaluateExpression('10/3')).toBe(3.3333)
  })
})

describe('resolveNumeric', () => {
  it('算式与纯数字都解析', () => {
    expect(resolveNumeric('1300')).toBe(1300)
    expect(resolveNumeric('52*25')).toBe(1300)
  })

  it('空串与非法值返回 null', () => {
    expect(resolveNumeric('')).toBeNull()
    expect(resolveNumeric('abc')).toBeNull()
  })
})
