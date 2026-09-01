import { prisma } from '@/lib/prisma'
import { getInventoryRows } from '@/services/inventory'
import { Table } from '@/components/ui/Table'
import { InventoryFilter } from '@/components/inventory/InventoryFilter'
import {
  ProcessingFeeSettle,
  type FactoryInventoryRow,
} from '@/components/inventory/ProcessingFeeSettle'

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
  const total = rows.reduce((s, r) => s + Number(r.weight), 0)
  const factoryRows: FactoryInventoryRow[] = rows
    .filter((r) => r.warehouse.type === 'FACTORY')
    .map((r) => ({
      id: r.id,
      warehouseName: r.warehouse.name,
      yarnName: r.variant.yarn.name,
      spec: r.variant.spec,
      color: r.variant.color,
      unit: r.variant.unit,
      batchNo: r.batch.batchNo,
      weight: Number(r.weight),
      cost: Number(r.cost),
      feePerKg: r.processingFeePerKg ? Number(r.processingFeePerKg) : null,
      settled: r.processingFeeSettled,
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
        共 {rows.length} 条，总重量 {total.toFixed(2)} kg
      </p>
      <Table
        headers={[
          '仓库',
          '纱线',
          '规格',
          '色号',
          '单位',
          '批次',
          '重量 (kg)',
          '单位成本 (元/kg)',
          '单位运费 (元/kg)',
          '含运费合计 (元/kg)',
          '加工费状态',
        ]}
      >
        {rows.map((r) => {
          const w = Number(r.weight)
          const unitCost = w > 0 ? r.cost.div(r.weight).toFixed(2) : '-'
          const unitFreight = w > 0 ? r.freight.div(r.weight).toFixed(2) : '-'
          const totalUnit = w > 0 ? r.cost.plus(r.freight).div(r.weight).toFixed(2) : '-'
          const feeStatus =
            r.warehouse.type === 'FACTORY' ? (r.processingFeeSettled ? '已算' : '未算') : '-'
          return (
            <tr key={r.id}>
              <td>{r.warehouse.name}</td>
              <td>{r.variant.yarn.name}</td>
              <td>{r.variant.spec}</td>
              <td>{r.variant.color}</td>
              <td>{r.variant.unit}</td>
              <td>{r.batch.batchNo}</td>
              <td>{w.toFixed(2)}</td>
              <td>{unitCost}</td>
              <td>{unitFreight}</td>
              <td>{totalUnit}</td>
              <td>{feeStatus}</td>
            </tr>
          )
        })}
      </Table>
    </div>
  )
}
