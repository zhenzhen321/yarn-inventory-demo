import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ReportPageHeader } from '@/components/reports/ReportPageHeader'
import { Table } from '@/components/ui/Table'
import { getInventoryValuation } from '@/services/reports'

export default async function InventoryValueReportPage() {
  const valuation = await getInventoryValuation(prisma)
  const totalWeight = valuation.reduce((sum, warehouse) => sum + warehouse.weight, 0)
  const totalValue = valuation.reduce(
    (sum, warehouse) => sum.plus(warehouse.value),
    new Prisma.Decimal(0),
  )

  return (
    <div className="space-y-4">
      <ReportPageHeader
        title="库存金额（按库存成本）"
        exportHref="/api/export?section=inventory"
      />
      <p className="text-sm text-gray-600">
        总重量 {totalWeight.toFixed(2)} kg，总金额 {totalValue.toFixed(2)} 元
      </p>
      <Table headers={['仓库', '重量 (kg)', '金额 (元)']}>
        {valuation.map((warehouse) => (
          <tr key={warehouse.name}>
            <td>{warehouse.name}</td>
            <td>{warehouse.weight.toFixed(2)}</td>
            <td>{warehouse.value.toString()}</td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
