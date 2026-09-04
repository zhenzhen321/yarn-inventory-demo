import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'orders', 'OrderTable.tsx'),
  'utf8',
)

describe('出入库记录简洁视图', () => {
  it('默认一张订单一行且只显示五个摘要字段', () => {
    expect(source).toContain(
      "<Table headers={['单号', '供应商/客户', '支数', '色号', '总额 (元)']}>",
    )
    expect(source).not.toContain('CollapseToggle')
  })

  it('单号支持展开和再次收起', () => {
    expect(source).toContain('aria-expanded={expanded}')
    expect(source).toContain('onClick={() => toggle(order.id)}')
    expect(source).toContain('expandedIds')
    expect(source).toContain('initialExpandedOrderNo')
  })

  it('展开区保留订单信息、货品明细和撤回操作', () => {
    for (const label of [
      '类型：',
      '日期：',
      '往来单位：',
      '仓库：',
      '经办人：',
      '货款：',
      '运费：',
      '备注：',
      '品名',
      '批次',
      '内部批次',
      '重量',
      '单价',
      '件数',
      '原单保留',
      '撤回本单',
    ]) {
      expect(source).toContain(label)
    }
  })
})
