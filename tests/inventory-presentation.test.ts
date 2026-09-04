import { describe, expect, it } from 'vitest'
import {
  buildInventoryGroups,
  getSaleInventoryChoices,
} from '@/lib/inventory-presentation'

const sampleRows = [
  {
    id: 'inv-a1',
    warehouseId: 'warehouse-a',
    warehouseName: '一号仓',
    yarnName: '棉纱',
    spec: '20支',
    color: '白色',
    unit: 'kg',
    batchNo: 'B-01',
    lotNo: 'LOT-001',
    weight: '100',
    packages: 10,
    cost: '2000',
    freight: '100',
    sourceType: 'PURCHASE',
    sourceId: 'purchase-1',
    sourceNo: 'PO-001',
    sourceDate: '2026-09-01',
  },
  {
    id: 'inv-a2',
    warehouseId: 'warehouse-a',
    warehouseName: '一号仓',
    yarnName: '棉纱',
    spec: '32支',
    color: '黑色',
    unit: 'kg',
    batchNo: 'B-02',
    lotNo: 'LOT-002',
    weight: '80',
    packages: 8,
    cost: '1920',
    freight: '80',
    sourceType: 'PURCHASE',
    sourceId: 'purchase-1',
    sourceNo: 'PO-001',
    sourceDate: '2026-09-01',
  },
  {
    id: 'inv-a3',
    warehouseId: 'warehouse-a',
    warehouseName: '一号仓',
    yarnName: '涤纶',
    spec: '20支',
    color: '白色',
    unit: 'kg',
    batchNo: 'B-03',
    lotNo: 'LOT-003',
    weight: '60',
    packages: null,
    cost: '1500',
    freight: '60',
    sourceType: 'PURCHASE',
    sourceId: 'purchase-2',
    sourceNo: 'PO-002',
    sourceDate: '2026-09-02',
  },
]

describe('库存展示按来源单据收拢', () => {
  it('同一仓库同一来源单据只显示一个汇总行，明细仍完整保留', () => {
    const groups = buildInventoryGroups(sampleRows)

    expect(groups).toHaveLength(2)
    expect(groups[0].sourceNo).toBe('PO-001')
    expect(groups[0].rows).toHaveLength(2)
    expect(groups[0].weight).toBe(180)
    expect(groups[0].packages).toBe(18)
    expect(groups[0].cost).toBe(3920)
    expect(groups[0].freight).toBe(180)
  })

  it('件数存在未知值时汇总件数保持未知，避免误报', () => {
    const groups = buildInventoryGroups(sampleRows)
    expect(groups.find((group) => group.sourceNo === 'PO-002')?.packages).toBeNull()
  })
})

describe('销售库存逐级选择', () => {
  it('先按仓库，再给出品名、色号和最终批次', () => {
    const warehouseRows = getSaleInventoryChoices(sampleRows, 'warehouse-a')

    expect(warehouseRows.yarnNames).toEqual(['棉纱', '涤纶'])
    expect(warehouseRows.colorsFor('棉纱')).toEqual(['白色', '黑色'])
    expect(warehouseRows.rowsFor('棉纱', '黑色').map((row) => row.id)).toEqual(['inv-a2'])
  })

  it('未选择品名或色号时不提前暴露整仓批次列表', () => {
    const warehouseRows = getSaleInventoryChoices(sampleRows, 'warehouse-a')

    expect(warehouseRows.rowsFor('', '')).toEqual([])
    expect(warehouseRows.rowsFor('棉纱', '')).toEqual([])
  })
})
