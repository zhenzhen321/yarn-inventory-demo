import { prisma } from '@/lib/prisma'
import { ReportPageHeader } from '@/components/reports/ReportPageHeader'
import { Table } from '@/components/ui/Table'
import { getPayableSummary } from '@/services/settlement'

export default async function PayablesReportPage() {
  const payables = await getPayableSummary(prisma)

  return (
    <div className="space-y-4">
      <ReportPageHeader
        title="应付供应商"
        exportHref="/api/export?section=payables"
      />
      <Table headers={['供应商', '应付总额 (元)', '已付', '未付']}>
        {payables.map((payable) => (
          <tr key={payable.id}>
            <td>{payable.name}</td>
            <td>{payable.totalAmount.toString()}</td>
            <td>{payable.settledAmount.toString()}</td>
            <td>{payable.remainingAmount.toString()}</td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
