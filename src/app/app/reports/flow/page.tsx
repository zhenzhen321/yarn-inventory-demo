import { prisma } from '@/lib/prisma'
import { ReportPageHeader } from '@/components/reports/ReportPageHeader'
import { Table } from '@/components/ui/Table'
import { getRecentFlow } from '@/services/reports'

export default async function RecentFlowReportPage() {
  const flow = await getRecentFlow(prisma, 30)

  return (
    <div className="space-y-4">
      <ReportPageHeader
        title="近 30 天进出流水"
        exportHref="/api/export?section=flow"
      />
      <Table headers={['类型', '单号', '日期', '对方', '仓库', '金额 (元)']}>
        {flow.map((record) => (
          <tr key={record.type + '-' + record.orderNo}>
            <td>{record.type === 'PURCHASE' ? '买入' : '卖出'}</td>
            <td>{record.orderNo}</td>
            <td>{record.date.toISOString().slice(0, 10)}</td>
            <td>{record.counterpartyName}</td>
            <td>{record.warehouseName}</td>
            <td>{record.amount.toString()}</td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
