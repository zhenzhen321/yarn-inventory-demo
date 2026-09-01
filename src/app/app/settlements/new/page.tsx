import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { SettleForm } from '@/components/settlements/SettleForm'
import { SettlementPageHeader } from '@/components/settlements/SettlementPageHeader'
import { getPayableSummary, getReceivableSummary } from '@/services/settlement'
import { getFactoryFeeSummary } from '@/services/factory-fee'

export default async function NewSettlementPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string; cp?: string }>
}) {
  const filters = await searchParams
  const [suppliers, customers, factories, payables, receivables, factoryFees, user] =
    await Promise.all([
      prisma.counterparty.findMany({
        where: { active: true, type: { in: ['SUPPLIER', 'BOTH'] } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.counterparty.findMany({
        where: { active: true, type: { in: ['CUSTOMER', 'BOTH'] } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.warehouse.findMany({
        where: { active: true, type: 'FACTORY' },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      getPayableSummary(prisma),
      getReceivableSummary(prisma),
      getFactoryFeeSummary(prisma),
      getSessionUser(),
    ])

  const payableOptions = payables.map((row) => ({
    id: row.id,
    remainingAmount: row.remainingAmount.toString(),
  }))
  const receivableOptions = receivables.map((row) => ({
    id: row.id,
    remainingAmount: row.remainingAmount.toString(),
  }))
  const factoryFeeOptions = factoryFees.map((row) => ({
    id: row.id,
    owedAmount: row.owedAmount.toString(),
  }))

  return (
    <div className="space-y-4">
      <SettlementPageHeader
        title="登记结算"
        description="选择结算方向和往来单位，系统会显示当前未结金额。"
      />
      <SettleForm
        defaultHandler={user?.name ?? 'admin'}
        suppliers={suppliers}
        customers={customers}
        factories={factories}
        payables={payableOptions}
        receivables={receivableOptions}
        factoryFees={factoryFeeOptions}
        initialSide={filters.side ?? ''}
        initialCounterpartyId={filters.cp ?? ''}
      />
    </div>
  )
}
