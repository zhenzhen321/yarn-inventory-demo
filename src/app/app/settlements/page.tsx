import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { Table } from '@/components/ui/Table'
import { SettleForm } from '@/components/settlements/SettleForm'
import { SettleScrollLink } from '@/components/settlements/SettleScrollLink'
import { SettlementRecordsFilter } from '@/components/settlements/SettlementRecordsFilter'
import { ExportLink } from '@/components/reports/ExportLink'
import { RevertButton } from '@/components/common/RevertButton'
import {
  getPayableSummary,
  getReceivableSummary,
  getSettlementRecords,
  STATUS_LABEL,
} from '@/services/settlement'
import { getFactoryFeeSummary, getFactoryFeePayments } from '@/services/factory-fee'

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: {
    side?: string
    cp?: string
    recSide?: string
    recCounterpartyId?: string
    recFrom?: string
    recTo?: string
  }
}) {
  const [
    payables,
    receivables,
    suppliers,
    customers,
    allCounterparties,
    records,
    factoryFees,
    factoryPayments,
    factories,
  ] = await Promise.all([
    getPayableSummary(prisma),
    getReceivableSummary(prisma),
    prisma.counterparty.findMany({
      where: { active: true, type: { in: ['SUPPLIER', 'BOTH'] } },
      orderBy: { name: 'asc' },
    }),
    prisma.counterparty.findMany({
      where: { active: true, type: { in: ['CUSTOMER', 'BOTH'] } },
      orderBy: { name: 'asc' },
    }),
    prisma.counterparty.findMany({ orderBy: { name: 'asc' } }),
    getSettlementRecords(prisma, {
      side: (searchParams.recSide as 'PURCHASE' | 'SALE') || undefined,
      counterpartyId: searchParams.recCounterpartyId,
      from: searchParams.recFrom ? new Date(searchParams.recFrom) : undefined,
      to: searchParams.recTo ? new Date(searchParams.recTo) : undefined,
    }),
    getFactoryFeeSummary(prisma),
    getFactoryFeePayments(prisma),
    prisma.warehouse.findMany({
      where: { active: true, type: 'FACTORY' },
      orderBy: { name: 'asc' },
    }),
  ])
  const user = await getSessionUser()

  const recParams = new URLSearchParams()
  if (searchParams.recSide) recParams.set('side', searchParams.recSide)
  if (searchParams.recCounterpartyId) recParams.set('counterpartyId', searchParams.recCounterpartyId)
  if (searchParams.recFrom) recParams.set('from', searchParams.recFrom)
  if (searchParams.recTo) recParams.set('to', searchParams.recTo)
  const recExportHref = `/api/export?section=settlements&${recParams.toString()}`

  const settleHref = (side: string, id: string) => {
    const params = new URLSearchParams()
    const entries = Object.entries(searchParams).filter(([k]) => k !== 'side' && k !== 'cp')
    for (const [k, v] of entries) if (v) params.set(k, v)
    params.set('side', side)
    params.set('cp', id)
    return `/app/settlements?${params.toString()}`
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">资金结算</h1>
      <SettleForm
        defaultHandler={user?.name ?? 'admin'}
        suppliers={suppliers}
        customers={customers}
        factories={factories}
        payables={payables}
        receivables={receivables}
        factoryFees={factoryFees}
        initialSide={searchParams.side ?? ''}
        initialCounterpartyId={searchParams.cp ?? ''}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-bold">加工厂欠款清单</h2>
        <Table headers={['加工厂', '加工费总额 (元)', '已付', '未付', '状态', '操作']}>
          {factoryFees.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.totalAmount.toString()}</td>
              <td>{f.paidAmount.toString()}</td>
              <td>{f.owedAmount.toString()}</td>
              <td>{STATUS_LABEL[f.status]}</td>
              <td>
                {f.status !== 'PAID' && (
                  <SettleScrollLink href={settleHref('PROCESSING_FEE', f.id)}>
                    去结算
                  </SettleScrollLink>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">加工厂付款记录</h2>
        <Table headers={['加工厂', '日期', '金额 (元)', '方式', '经手人', '操作']}>
          {factoryPayments.map((p) => (
            <tr key={p.id}>
              <td>{p.factoryName}</td>
              <td>{p.date.toISOString().slice(0, 10)}</td>
              <td>{p.amount.toString()}</td>
              <td>{p.method ?? '-'}</td>
              <td>{p.handlerName}</td>
              <td>
                {user && user.name === p.handlerName && (
                  <RevertButton href={`/api/processing-fee-payments/${p.id}`} />
                )}
              </td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">应付供应商清单</h2>
        <Table headers={['供应商', '应付总额 (元)', '已付', '未付', '状态', '操作']}>
          {payables.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.totalAmount.toString()}</td>
              <td>{p.settledAmount.toString()}</td>
              <td>{p.remainingAmount.toString()}</td>
              <td>{STATUS_LABEL[p.status]}</td>
              <td>
                {p.status !== 'PAID' && (
                  <SettleScrollLink href={settleHref('PURCHASE', p.id)}>去结算</SettleScrollLink>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">应收客户清单</h2>
        <Table headers={['客户', '应收总额 (元)', '已收', '未收', '状态', '操作']}>
          {receivables.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.totalAmount.toString()}</td>
              <td>{r.settledAmount.toString()}</td>
              <td>{r.remainingAmount.toString()}</td>
              <td>{STATUS_LABEL[r.status]}</td>
              <td>
                {r.status !== 'PAID' && (
                  <SettleScrollLink href={settleHref('SALE', r.id)}>去结算</SettleScrollLink>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">结算记录</h2>
          <ExportLink href={recExportHref} />
        </div>
        <SettlementRecordsFilter counterparties={allCounterparties} />
        <Table headers={['类型', '客户/供应商', '日期', '金额 (元)', '方式', '经手人', '操作']}>
          {records.map((r) => (
            <tr key={r.id}>
              <td>{r.side === 'PURCHASE' ? '买入应付' : '卖出应收'}</td>
              <td>{r.counterpartyName}</td>
              <td>{r.date.toISOString().slice(0, 10)}</td>
              <td>{r.amount.toString()}</td>
              <td>{r.method ?? '-'}</td>
              <td>{r.handlerName}</td>
              <td>
                {user && user.name === r.handlerName && (
                  <RevertButton href={`/api/settlements/${r.id}`} />
                )}
              </td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  )
}
