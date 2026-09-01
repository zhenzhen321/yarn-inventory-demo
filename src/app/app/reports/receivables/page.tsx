import { prisma } from '@/lib/prisma'
import { ReportPageHeader } from '@/components/reports/ReportPageHeader'
import { Table } from '@/components/ui/Table'
import { getReceivableSummary } from '@/services/settlement'

export default async function ReceivablesReportPage() {
  const receivables = await getReceivableSummary(prisma)

  return (
    <div className="space-y-4">
      <ReportPageHeader
        title="应收客户"
        exportHref="/api/export?section=receivables"
      />
      <Table headers={['客户', '应收总额 (元)', '已收', '未收']}>
        {receivables.map((receivable) => (
          <tr key={receivable.id}>
            <td>{receivable.name}</td>
            <td>{receivable.totalAmount.toString()}</td>
            <td>{receivable.settledAmount.toString()}</td>
            <td>{receivable.remainingAmount.toString()}</td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
