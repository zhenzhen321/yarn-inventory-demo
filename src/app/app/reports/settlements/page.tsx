import { prisma } from '@/lib/prisma'
import { ReportPageHeader } from '@/components/reports/ReportPageHeader'
import { Table } from '@/components/ui/Table'
import { getSettlementRecords } from '@/services/settlement'

export default async function SettlementRecordsReportPage() {
  const records = await getSettlementRecords(prisma)

  return (
    <div className="space-y-4">
      <ReportPageHeader
        title="结算记录"
        exportHref="/api/export?section=settlements"
      />
      <Table headers={['类型', '客户/供应商', '日期', '金额 (元)', '方式', '经手人']}>
        {records.slice(0, 50).map((record) => (
          <tr key={record.id}>
            <td>{record.side === 'PURCHASE' ? '买入应付' : '卖出应收'}</td>
            <td>{record.counterpartyName}</td>
            <td>{record.date.toISOString().slice(0, 10)}</td>
            <td>{record.amount.toString()}</td>
            <td>{record.method ?? '-'}</td>
            <td>{record.handlerName}</td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
