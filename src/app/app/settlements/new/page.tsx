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
        orderBy: { name: 'asc' },
      }),
      prisma.counterparty.findMany({
        where: { active: true, type: { in: ['CUSTOMER', 'BOTH'] } },
        orderBy: { name: 'asc' },
      }),
      prisma.warehouse.findMany({
        where: { active: true, type: 'FACTORY' },
        orderBy: { name: 'asc' },
      }),
      getPayableSummary(prisma),
      getReceivableSummary(prisma),
      getFactoryFeeSummary(prisma),
      getSessionUser(),
    ])

  return (
    <div className="space-y-4">
      <SettlementPageHeader
        title="登记结算"
        description="选择结算方向和往来单位，系统会显示当前未结金额及该对象的往来明细。"
      />
      <SettleForm
        defaultHandler={user?.name ?? '刚'}
        suppliers={suppliers}
        customers={customers}
        factories={factories}
        payables={payables}
        receivables={receivables}
        factoryFees={factoryFees}
        initialSide={filters.side ?? ''}
        initialCounterpartyId={filters.cp ?? ''}
      />
    </div>
  )
}
