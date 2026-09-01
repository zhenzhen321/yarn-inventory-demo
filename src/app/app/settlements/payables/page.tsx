import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Table } from '@/components/ui/Table'
import { SettlementPageHeader } from '@/components/settlements/SettlementPageHeader'
import { getPayableSummary, STATUS_LABEL } from '@/services/settlement'

export default async function SettlementPayablesPage() {
  const payables = await getPayableSummary(prisma)

  return (
    <div className="space-y-4">
      <SettlementPageHeader title="应付供应商" exportHref="/api/export?section=payables" />
      <Table headers={['供应商', '应付总额 (元)', '已付', '未付', '状态', '操作']}>
        {payables.map((payable) => {
          const params = new URLSearchParams({ side: 'PURCHASE', cp: payable.id })
          return (
            <tr key={payable.id}>
              <td>{payable.name}</td>
              <td>{payable.totalAmount.toString()}</td>
              <td>{payable.settledAmount.toString()}</td>
              <td>{payable.remainingAmount.toString()}</td>
              <td>{STATUS_LABEL[payable.status]}</td>
              <td>
                {payable.status !== 'PAID' ? (
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
