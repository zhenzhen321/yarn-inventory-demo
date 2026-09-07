import { LabelPrintButton } from '@/components/labels/LabelPrintButton'

export interface CurrentInventoryLabelRow {
  sourceNo: string
  warehouseName: string
  yarnName: string
  spec: string
  color: string | null
  unit: string
  batchNo: string
  lotNo: string | null
  scanCode: string | null
  weight: string
  packages: number | null
  archived: boolean
}

// 两个入口均传入单一地点的余额，不使用采购数量或成品初始数量。
export function CurrentInventoryLabelButton({ row }: { row: CurrentInventoryLabelRow }) {
  const weight = Number(row.weight)
  if (row.archived || !Number.isFinite(weight) || weight <= 0 || !row.lotNo || !row.scanCode) {
    return null
  }

  return (
    <LabelPrintButton
      label="打印当前库存标签"
      className="whitespace-nowrap px-2 py-1 text-xs"
      context={`地点：${row.warehouseName} · 数量为本页面加载时该地点的库存余额；如刚发生出入库，请先刷新页面。`}
      order={{
        orderNo: row.sourceNo,
        items: [{
          yarnName: row.yarnName,
          spec: row.spec,
          color: row.color ?? '',
          unit: row.unit,
          batchNo: row.batchNo,
          lotNo: row.lotNo,
          scanCode: row.scanCode,
          weight: row.weight,
          packages: row.packages,
        }],
      }}
    />
  )
}
