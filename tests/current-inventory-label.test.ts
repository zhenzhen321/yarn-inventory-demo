import { describe, expect, it, vi } from 'vitest'
import { CurrentInventoryLabelButton } from '@/components/labels/CurrentInventoryLabelButton'

vi.mock('@/components/labels/LabelPrintButton', () => ({ LabelPrintButton: () => null }))

const finished = {
  sourceNo: 'PF-20260904-0001', warehouseName: '并线厂',
  yarnName: '色纺包芯纱', spec: '28/1', color: '5146白灰-11', unit: 'kg',
  batchNo: '色纺包芯纱-20260904-1', lotNo: 'LOT-20260904-0002',
  scanCode: 'FINISHED-SCAN-CODE', weight: '1920', packages: 96, archived: false,
}

describe('当前地点库存补打标签', () => {
  it('加工后使用成品批次、1920kg和96件，可重复进入补打', () => {
    for (let visit = 0; visit < 2; visit++) {
      const button = CurrentInventoryLabelButton({ row: finished })!
      expect(button.props.label).toBe('打印当前库存标签')
      expect(button.props.context).toContain('并线厂')
      expect(button.props.order.orderNo).toBe('PF-20260904-0001')
      expect(button.props.order.items[0]).toEqual({
        yarnName: finished.yarnName, spec: finished.spec, color: finished.color,
        unit: 'kg', batchNo: finished.batchNo, lotNo: finished.lotNo,
        scanCode: 'FINISHED-SCAN-CODE', weight: '1920', packages: 96,
      })
    }
  })

  it('同批次分布两地时各自打印本地余额，不合并件数', () => {
    const factory = CurrentInventoryLabelButton({ row: { ...finished, weight: '1200', packages: 60 } })!
    const warehouse = CurrentInventoryLabelButton({ row: { ...finished, warehouseName: '东山仓库', weight: '720', packages: 36 } })!
    expect(factory.props.order.items[0]).toMatchObject({ weight: '1200', packages: 60 })
    expect(warehouse.props.order.items[0]).toMatchObject({ weight: '720', packages: 36, scanCode: finished.scanCode })
    expect(warehouse.props.context).toContain('东山仓库')
  })

  it('部分销售后按剩余库存补打，二维码保持不变', () => {
    const button = CurrentInventoryLabelButton({ row: { ...finished, weight: '1720', packages: 86 } })!
    expect(button.props.order.items[0]).toMatchObject({ weight: '1720', packages: 86, scanCode: finished.scanCode })
  })

  it.each(['0', '-1', 'NaN'])('重量为%s时不允许打印当前库存标签', (weight) => {
    expect(CurrentInventoryLabelButton({ row: { ...finished, weight } })).toBeNull()
  })

  it('已归档、缺少内部批次或扫码码时不提供误导性标签', () => {
    expect(CurrentInventoryLabelButton({ row: { ...finished, archived: true } })).toBeNull()
    expect(CurrentInventoryLabelButton({ row: { ...finished, lotNo: null } })).toBeNull()
    expect(CurrentInventoryLabelButton({ row: { ...finished, scanCode: null } })).toBeNull()
  })

  it('未知件数保持为空，不能伪造0件；空色号可打印', () => {
    const button = CurrentInventoryLabelButton({ row: { ...finished, packages: null, color: null } })!
    expect(button.props.order.items[0]).toMatchObject({ packages: null, color: '' })
  })
})
