import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Table } from '@/components/ui/Table'
import { SettlementPageHeader } from '@/components/settlements/SettlementPageHeader'
import { getReceivableSummary, STATUS_LABEL } from '@/services/settlement'

export default async function SettlementReceivablesPage() {
  const receivables = await getReceivableSummary(prisma)

  return (
    <div className="space-y-4">
      <SettlementPageHeader title="应收客户" exportHref="/api/export?section=receivables" />
      <Table headers={['客户', '应收总额 (元)', '已收', '未收', '状态', '操作']}>
        {receivables.map((receivable) => {
          const params = new URLSearchParams({ side: 'SALE', cp: receivable.id })
          return (
            <tr key={receivable.id}>
              <td>{receivable.name}</td>
              <td>{receivable.totalAmount.toString()}</td>
              <td>{receivable.settledAmount.toString()}</td>
              <td>{receivable.remainingAmount.toString()}</td>
              <td>{STATUS_LABEL[receivable.status]}</td>
              <td>
                {receivable.status !== 'PAID' ? (
                  <Link
                    href={`/app/settlements/new?${params.toString()}`}
                    className="inline-flex rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                  >
                    去结算
                  </Link>
                ) : (
                  <span className="text-xs text-gray-400">已结清</span>
                )}
              </td>
            </tr>
          )
        })}
      </Table>
    </div>
  )
}
