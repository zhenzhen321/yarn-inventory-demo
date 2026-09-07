import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { Table } from '@/components/ui/Table'
import { RevertButton } from '@/components/common/RevertButton'
import { SettlementPageHeader } from '@/components/settlements/SettlementPageHeader'
import { SettlementRecordsFilter } from '@/components/settlements/SettlementRecordsFilter'
import { getSettlementRecords } from '@/services/settlement'
import { businessDateFromInput, formatBusinessDate } from '@/lib/business-date'

export default async function SettlementRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{
    recSide?: string
    recCounterpartyId?: string
    recFrom?: string
    recTo?: string
  }>
}) {
  const filters = await searchParams
  const [counterparties, records, user] = await Promise.all([
    prisma.counterparty.findMany({ orderBy: { name: 'asc' } }),
    getSettlementRecords(prisma, {
      side: (filters.recSide as 'PURCHASE' | 'SALE') || undefined,
      counterpartyId: filters.recCounterpartyId,
      from: filters.recFrom ? businessDateFromInput(filters.recFrom) : undefined,
      to: filters.recTo ? businessDateFromInput(filters.recTo) : undefined,
    }),
    getSessionUser(),
  ])

  const exportParams = new URLSearchParams()
  if (filters.recSide) exportParams.set('side', filters.recSide)
  if (filters.recCounterpartyId) {
    exportParams.set('counterpartyId', filters.recCounterpartyId)
  }
  if (filters.recFrom) exportParams.set('from', filters.recFrom)
  if (filters.recTo) exportParams.set('to', filters.recTo)
  const query = exportParams.toString()
  const exportHref = `/api/export?section=settlements${query ? `&${query}` : ''}`

  return (
    <div className="space-y-4">
      <SettlementPageHeader title="结算记录" exportHref={exportHref} />
      <SettlementRecordsFilter counterparties={counterparties} />
      <Table headers={['类型', '客户/供应商', '日期', '金额 (元)', '方式', '经手人', '操作']}>
        {records.map((record) => (
          <tr key={record.id}>
            <td>{record.side === 'PURCHASE' ? '买入应付' : '卖出应收'}</td>
            <td>{record.counterpartyName}</td>
            <td>{formatBusinessDate(record.date)}</td>
            <td>{record.amount.toString()}</td>
            <td>{record.method ?? '-'}</td>
            <td>{record.handlerName}</td>
            <td>
              {user && user.name === record.handlerName ? (
                <RevertButton href={`/api/settlements/${record.id}`} />
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
