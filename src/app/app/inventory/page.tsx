import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { buildInventoryGroups } from '@/lib/inventory-presentation'
import { getInventoryRows } from '@/services/inventory'
import { Table } from '@/components/ui/Table'
import { InventoryFilter } from '@/components/inventory/InventoryFilter'
import {
  ProcessingFeeSettle,
  type FactoryInventoryRow,
} from '@/components/inventory/ProcessingFeeSettle'

function sourceLabel(sourceType: string) {
  if (sourceType === 'PURCHASE') return '采购入库'
  if (sourceType === 'PROCESSING') return '加工完工'
  return '历史汇总'
}

const inventoryGridColumns =
  'grid-cols-[minmax(180px,1.6fr)_100px_minmax(100px,1fr)_minmax(110px,1fr)_minmax(90px,1fr)_80px_110px_80px_minmax(140px,1fr)]'

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouseId?: string; q?: string; includeZero?: string }>
}) {
  const filters = await searchParams
  const warehouses = await prisma.warehouse.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
  })
  const rows = await getInventoryRows(prisma, {
    warehouseId: filters.warehouseId,
    q: filters.q,
    includeZero: filters.includeZero === '1',
  })
  const total = rows.reduce((sum, row) => sum + Number(row.weight), 0)
  const presentationRows = rows.map((row) => {
    const purchase = row.lot?.purchaseItem?.order
    const processing = row.lot?.processingOutput?.job
    const sourceType = row.lot?.sourceType ?? 'LEGACY_AGGREGATED'
    const source = purchase ?? processing

    return {
      id: row.id,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      warehouseType: row.warehouse.type,
      yarnName: row.variant.yarn.name,
      spec: row.variant.spec,
      color: row.variant.color,
      unit: row.variant.unit,
      batchNo: row.batch.batchNo,
      lotId: row.lot?.id ?? null,
      lotNo: row.lot?.lotNo ?? null,
      weight: row.weight.toString(),
      packages: row.packages,
      cost: row.cost.toString(),
      freight: row.freight.toString(),
      processingFeeSettled: row.processingFeeSettled,
      processingFeePerKg: row.processingFeePerKg?.toString() ?? null,
      sourceType,
      sourceId: source?.id ?? row.lot?.id ?? null,
      sourceNo: source?.orderNo ?? row.lot?.lotNo ?? '历史汇总库存',
      sourceDate: (source?.date ?? row.lot?.createdAt)?.toISOString().slice(0, 10) ?? null,
    }
  })
  const groups = buildInventoryGroups(presentationRows)
  const factoryRows: FactoryInventoryRow[] = rows
    .filter((row) => row.warehouse.type === 'FACTORY')
    .map((row) => ({
      id: row.id,
      warehouseName: row.warehouse.name,
      yarnName: row.variant.yarn.name,
      spec: row.variant.spec,
      color: row.variant.color,
      unit: row.variant.unit,
      batchNo: row.batch.batchNo,
      lotNo: row.lot?.lotNo ?? null,
      weight: Number(row.weight),
      packages: row.packages,
      cost: Number(row.cost),
      feePerKg: row.processingFeePerKg ? Number(row.processingFeePerKg) : null,
      settled: row.processingFeeSettled,
    }))

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">库存查询</h1>
      <ProcessingFeeSettle rows={factoryRows} />
      <InventoryFilter
        warehouses={warehouses}
        includeZero={filters.includeZero === '1'}
      />
      <p className="text-sm text-gray-600">
        共 {groups.length} 个来源单据，包含 {rows.length} 个批次余额，总重量{' '}
        {total.toFixed(2)} kg
      </p>

      <div className="overflow-x-auto rounded border bg-white text-sm">
        <div className="min-w-[1180px]">
          <div
            className={`grid ${inventoryGridColumns} gap-3 border-b bg-gray-50 px-3 py-2 font-medium text-gray-600 [&>span]:whitespace-nowrap`}
          >
            <span>来源单据</span>
            <span>日期</span>
            <span>仓库</span>
            <span>品名</span>
            <span>色号</span>
            <span>批次数</span>
            <span>重量</span>
            <span>件数</span>
            <span>含运费单价</span>
          </div>
          {groups.map((group) => {
            const totalUnit =
              group.weight > 0
                ? ((group.cost + group.freight) / group.weight).toFixed(2)
                : '-'
            return (
              <details key={group.key} className="group border-b last:border-b-0">
                <summary
                  className={`grid cursor-pointer list-none ${inventoryGridColumns} items-center gap-3 px-3 py-3 hover:bg-gray-50`}
                >
                  <span className="font-medium text-blue-800">
                    <span className="mr-1 inline-block transition-transform group-open:rotate-90">▶</span>
                    {group.sourceNo}
                    <span className="ml-1 text-xs font-normal text-gray-500">
                      {sourceLabel(group.sourceType)}
                    </span>
                  </span>
                  <span>{group.sourceDate ?? '-'}</span>
                  <span>{group.warehouseName}</span>
                  <span>{group.yarnSummary}</span>
                  <span>{group.colorSummary}</span>
                  <span>{group.rows.length}</span>
                  <span>{group.weight.toFixed(2)} kg</span>
                  <span>{group.packages ?? '-'}</span>
                  <span className="whitespace-nowrap">¥{totalUnit}/kg</span>
                </summary>
                <div className="border-t bg-gray-50/60 p-3">
                  <Table
                    headers={[
                      '纱线',
                      '规格',
                      '色号',
                      '单位',
                      '批次',
                      '内部批次',
                      '重量 (kg)',
                      '件数',
                      '单位成本',
                      '单位运费',
                      '加工费状态',
                    ]}
                  >
                    {group.rows.map((row) => {
                      const weight = Number(row.weight)
                      const unitCost = weight > 0 ? (Number(row.cost) / weight).toFixed(2) : '-'
                      const unitFreight =
                        weight > 0 ? (Number(row.freight) / weight).toFixed(2) : '-'
                      const feeStatus =
                        row.warehouseType === 'FACTORY'
                          ? row.processingFeeSettled
                            ? '已算'
                            : '未算'
                          : '-'
                      return (
                        <tr key={row.id}>
                          <td>{row.yarnName}</td>
                          <td>{row.spec}</td>
                          <td>{row.color}</td>
                          <td>{row.unit}</td>
                          <td>{row.batchNo}</td>
                          <td>
                            {row.lotId ? (
                              <Link
                                href={`/app/lots/${row.lotId}`}
                                className="text-blue-700 hover:underline"
                              >
                                {row.lotNo}
                              </Link>
                            ) : (
                              '历史汇总批次'
                            )}
                          </td>
                          <td>{weight.toFixed(2)}</td>
                          <td>{row.packages ?? '-'}</td>
                          <td>{unitCost}</td>
                          <td>{unitFreight}</td>
                          <td>{feeStatus}</td>
                        </tr>
                      )
                    })}
                  </Table>
                </div>
              </details>
            )
          })}
        </div>
      </div>
    </div>
  )
}
