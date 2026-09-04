import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const componentPath = path.resolve(root, 'src', 'components', 'orders', 'OrderTraceLink.tsx')

describe('买入/卖出单号统一溯源', () => {
  it('提供统一单号链接，进入出入库记录并携带类型、单号和自动展开参数', () => {
    expect(existsSync(componentPath)).toBe(true)
    const source = readFileSync(componentPath, 'utf8')
    expect(source).toContain("'/app/orders?'")
    expect(source).toContain("params.set('type', orderType)")
    expect(source).toContain("params.set('q', orderNo)")
    expect(source).toContain("params.set('focus', orderNo)")
    expect(source).toContain('查看单据明细')
  })

  it('所有非展开式买卖单号展示点使用统一溯源链接', () => {
    const files = [
      'src/components/settlements/SettleForm.tsx',
      'src/components/purchases/PurchaseForm.tsx',
      'src/components/sales/SaleForm.tsx',
      'src/app/app/purchases/page.tsx',
      'src/app/app/sales/page.tsx',
      'src/app/app/dashboard/page.tsx',
      'src/app/app/reports/flow/page.tsx',
      'src/app/app/lots/[id]/page.tsx',
    ]
    for (const file of files) {
      expect(readFileSync(path.resolve(root, file), 'utf8'), file).toContain('<OrderTraceLink')
    }
  })

  it('目标记录页读取 focus 并让订单表自动展开对应单号', () => {
    const page = readFileSync(path.resolve(root, 'src', 'app', 'app', 'orders', 'page.tsx'), 'utf8')
    const table = readFileSync(
      path.resolve(root, 'src', 'components', 'orders', 'OrderTable.tsx'),
      'utf8',
    )
    expect(page).toContain('focus?: string')
    expect(page).toContain('initialExpandedOrderNo={filters.focus}')
    expect(table).toContain('initialExpandedOrderNo')
    expect(table).toContain('order.orderNo === initialExpandedOrderNo')
  })
})
