import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const settlementRoot = path.resolve(process.cwd(), 'src', 'app', 'app', 'settlements')
const homeSource = readFileSync(path.join(settlementRoot, 'page.tsx'), 'utf8')

describe('结算导航页', () => {
  const destinations = ['new', 'payables', 'receivables', 'factory-fees', 'records']

  it('首页只提供五个清晰的功能入口', () => {
    for (const destination of destinations) {
      expect(homeSource).toContain(`/app/settlements/${destination}`)
      expect(existsSync(path.join(settlementRoot, destination, 'page.tsx'))).toBe(true)
    }
    expect(homeSource).not.toContain('SettleForm')
    expect(homeSource).not.toContain('<Table')
  })

  it('欠款清单的去结算链接进入登记页并预填方向和单位', () => {
    for (const destination of ['payables', 'receivables', 'factory-fees']) {
      const source = readFileSync(path.join(settlementRoot, destination, 'page.tsx'), 'utf8')
      expect(source).toContain('/app/settlements/new?')
      expect(source).toContain('side:')
      expect(source).toContain('cp:')
    }
  })

  it('结算记录筛选留在独立记录页', () => {
    const filterSource = readFileSync(
      path.resolve(process.cwd(), 'src', 'components', 'settlements', 'SettlementRecordsFilter.tsx'),
      'utf8',
    )
    expect(filterSource).toContain('/app/settlements/records?')
  })
})
