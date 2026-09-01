import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const componentSource = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'labels', 'LabelPrintButton.tsx'),
  'utf8',
)
const purchaseSource = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'purchases', 'PurchaseForm.tsx'),
  'utf8',
)
const orderTableSource = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'orders', 'OrderTable.tsx'),
  'utf8',
)

describe('通用入库标签打印', () => {
  it('标签只展示单号、品名、支数和色号', () => {
    for (const field of ['order.orderNo', 'item.yarnName', 'item.spec', 'item.color']) {
      expect(componentSource).toContain(field)
    }
    for (const label of ['支数', '色号']) {
      expect(componentSource).toContain(label)
    }
  })

  it('支持常用尺寸、自定义毫米尺寸和本机设置记忆', () => {
    for (const size of ['40 × 30 mm', '50 × 30 mm', '60 × 40 mm']) {
      expect(componentSource).toContain(size)
    }
    expect(componentSource).toContain('自定义尺寸')
    expect(componentSource).toContain('localStorage')
    expect(componentSource).toContain('@page')
    expect(componentSource).toContain('settings.width')
    expect(componentSource).toContain('settings.height')
  })

  it('保存买入后可打印，并能从出入库记录补打', () => {
    expect(purchaseSource).toContain('打印本单标签')
    expect(orderTableSource).toContain('补打标签')
    expect(orderTableSource).toContain("order.orderType === 'PURCHASE'")
  })

  it('默认打印份数取包数，未填包数时为一张', () => {
    expect(componentSource).toContain('item.packages && item.packages > 0')
    expect(componentSource).toContain(': 1')
  })
})
