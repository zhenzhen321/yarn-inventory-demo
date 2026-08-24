import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { OrderFilterPanel } from '@/components/orders/OrderFilterPanel'
import { OrderTable } from '@/components/orders/OrderTable'
import { PrintButton } from '@/components/orders/PrintButton'
import { ExportLink } from '@/components/reports/ExportLink'
import { getOrderRecords } from '@/services/orders'

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: {
    type?: string
    from?: string
    to?: string
    warehouseId?: string
    counterpartyId?: string
    q?: string
    yarnQ?: string
  }
}) {
  const [warehouses, counterparties, rows, user] = await Promise.all([
    prisma.warehouse.findMany({ orderBy: { name: 'asc' } }),
    prisma.counterparty.findMany({ orderBy: { name: 'asc' } }),
    getOrderRecords(prisma, {
      type: (searchParams.type as 'ALL' | 'PURCHASE' | 'SALE') ?? 'ALL',
      from: searchParams.from,
      to: searchParams.to,
      warehouseId: searchParams.warehouseId,
      counterpartyId: searchParams.counterpartyId,
      q: searchParams.q,
      yarnQ: searchParams.yarnQ,
    }),
    getSessionUser(),
  ])

  const params = new URLSearchParams()
  if (searchParams.type && searchParams.type !== 'ALL') params.set('type', searchParams.type)
  if (searchParams.from) params.set('from', searchParams.from)
  if (searchParams.to) params.set('to', searchParams.to)
  if (searchParams.warehouseId) params.set('warehouseId', searchParams.warehouseId)
  if (searchParams.counterpartyId) params.set('counterpartyId', searchParams.counterpartyId)
  if (searchParams.q) params.set('q', searchParams.q)
  if (searchParams.yarnQ) params.set('yarnQ', searchParams.yarnQ)
  const exportHref = `/api/export?section=orders&${params.toString()}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">出入库记录</h1>
        <div className="flex gap-2">
          <ExportLink href={exportHref} />
          <PrintButton />
        </div>
      </div>
      <OrderFilterPanel warehouses={warehouses} counterparties={counterparties} />
      <p className="text-sm text-gray-600">共 {rows.length} 条记录</p>
      <OrderTable orders={rows} currentUserName={user?.name} />
    </div>
  )
}
