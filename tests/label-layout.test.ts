import { describe, expect, it } from 'vitest'
import { buildLabelDocument } from '@/lib/label-layout'

const settings = { width: 50, height: 30, padding: 1.5, topOffset: 0.5, fontSize: 10 }
const item = { yarnName: '色纺包芯纱', spec: '28/1', color: '5146白灰-11', batchNo: '色纺包芯纱-20260904-1', weight: '1920', unit: 'kg', packages: 96, lotNo: 'LOT-20260904-0002' }

describe('统一标签文档', () => {
  it.each([[40, 30], [50, 30], [60, 40]])('纸张为%s×%smm，完整保留每个字段', (width, height) => {
    const html = buildLabelDocument('PF-20260904-0001', [{ item, qr: '' }], { ...settings, width, height })
    expect(html).toContain(`size: ${width}mm ${height}mm`)
    for (const value of [item.yarnName, item.color, item.batchNo, item.lotNo, '1920 kg · 96 件']) expect(html).toContain(value)
    expect(html).not.toContain('text-overflow: ellipsis')
    expect(html).toContain('white-space: nowrap')
  })

  it('恶意字段作为文字保留，不执行HTML或脚本', () => {
    const html = buildLabelDocument('<script>alert(1)</script>', [{ item: { ...item, yarnName: '<img src=x onerror=alert(1)>' }, qr: '' }], settings)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('未知件数不伪造，零件数明确打印', () => {
    expect(buildLabelDocument('PF', [{ item: { ...item, packages: null }, qr: '' }], settings)).not.toContain(' 件')
    expect(buildLabelDocument('PF', [{ item: { ...item, packages: 0 }, qr: '' }], settings)).toContain('0 件')
  })
})
