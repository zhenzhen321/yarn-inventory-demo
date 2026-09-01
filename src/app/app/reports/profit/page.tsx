import { prisma } from '@/lib/prisma'
import { ReportPageHeader } from '@/components/reports/ReportPageHeader'
import { Table } from '@/components/ui/Table'
import { getProfitEstimate } from '@/services/reports'

export default async function ProfitReportPage() {
  const profit = await getProfitEstimate(prisma)

  return (
    <div className="space-y-4">
      <ReportPageHeader title="毛利估算（含运费）" />
      <Table headers={['项目', '金额 (元)']}>
        <tr>
          <td>卖出货款合计</td>
          <td>{profit.saleGoodsTotal.toString()}</td>
        </tr>
        <tr>
          <td>估算销售成本（按库存单位成本）</td>
          <td>{profit.estimatedCost.toString()}</td>
        </tr>
        <tr>
          <td>估算运费（按库存单位运费）</td>
          <td>{profit.estimatedFreight.toString()}</td>
        </tr>
        <tr>
          <td>卖货运费合计</td>
          <td>{profit.saleFreightTotal.toString()}</td>
        </tr>
        <tr>
          <td>估算毛利</td>
          <td>{profit.estimatedProfit.toString()}</td>
        </tr>
      </Table>
    </div>
  )
}
