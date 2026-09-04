import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const inventoryPage = readFileSync(
  path.resolve(process.cwd(), 'src', 'app', 'app', 'inventory', 'page.tsx'),
  'utf8',
)
const saleForm = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'sales', 'SaleForm.tsx'),
  'utf8',
)
const appShell = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'layout', 'AppShell.tsx'),
  'utf8',
)

describe('库存与销售选货界面契约', () => {
  it('库存主列表按来源单据显示一行，并可展开批次明细', () => {
    expect(inventoryPage).toContain('buildInventoryGroups')
    expect(inventoryPage).toContain('<details')
    expect(inventoryPage).toContain('group.sourceNo')
    expect(inventoryPage).toContain('group.rows.map')
  })

  it('销售手工选货按仓库、品名、色号、批次逐级缩小范围', () => {
    expect(saleForm).toContain('getSaleInventoryChoices')
    expect(saleForm).toContain('选择品名')
    expect(saleForm).toContain('选择色号')
    expect(saleForm).toContain('选择具体批次')
    expect(saleForm).toContain('choices.rowsFor(row.yarnName, row.color)')
  })

  it('桌面框架加宽并为库存表关键列保留足够空间', () => {
    expect(appShell).toContain('max-w-7xl')
    expect(appShell).not.toContain('max-w-5xl')
    expect(inventoryPage).toContain('min-w-[1180px]')
    expect(inventoryPage).toContain('minmax(140px,1fr)')
    expect(inventoryPage).toContain('whitespace-nowrap')
  })
})
