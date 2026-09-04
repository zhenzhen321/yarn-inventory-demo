import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const settlementRoot = path.resolve(process.cwd(), 'src', 'app', 'app', 'settlements')
const homeSource = readFileSync(path.join(settlementRoot, 'page.tsx'), 'utf8')
const settleFormSource = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'settlements', 'SettleForm.tsx'),
  'utf8',
)
const detailApiPath = path.resolve(
  process.cwd(),
  'src',
  'app',
  'api',
  'settlement-details',
  'route.ts',
)

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

  it('选择结算对象后按需加载该对象的往来明细和内部批次入口', () => {
    expect(existsSync(detailApiPath)).toBe(true)
    expect(settleFormSource).toContain('/api/settlement-details?')
    expect(settleFormSource).toContain('结算对象明细')
    expect(settleFormSource).toContain('/app/lots/')

    const detailApiSource = readFileSync(detailApiPath, 'utf8')
    expect(detailApiSource).toContain('getSessionUser')
    expect(detailApiSource).toContain('getCounterpartyStatement')
    expect(detailApiSource).toContain('getFactoryStatement')
  })

  it('批次追溯页返回真实上一界面并保留库存作为无历史回退', () => {
    const backLinkPath = path.resolve(
      process.cwd(),
      'src',
      'components',
      'lots',
      'LotBackLink.tsx',
    )
    expect(existsSync(backLinkPath)).toBe(true)
    const backLinkSource = readFileSync(backLinkPath, 'utf8')
    expect(backLinkSource).toContain('router.back()')
    expect(backLinkSource).toContain("router.replace('/app/inventory')")
    expect(backLinkSource).toContain('返回上一界面')

    const lotPageSource = readFileSync(
      path.resolve(process.cwd(), 'src', 'app', 'app', 'lots', '[id]', 'page.tsx'),
      'utf8',
    )
    expect(lotPageSource).toContain('<LotBackLink />')
    expect(lotPageSource).not.toContain('返回库存')
  })

  it('登记页把结算方向和对象写入网址，以便从批次页返回后恢复原查询', () => {
    expect(settleFormSource).toContain('replaceSettlementQuery')
    expect(settleFormSource).toContain("params.set('side', nextSide)")
    expect(settleFormSource).toContain("params.set('cp', nextCounterpartyId)")
    expect(settleFormSource).toContain(
      'router.replace(`/app/settlements/new?${params.toString()}`, { scroll: false })',
    )
    expect(settleFormSource).toContain('setDetailsVersion((version) => version + 1)')
  })
})
