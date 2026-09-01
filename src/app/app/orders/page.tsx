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
  searchParams: Promise<{
    type?: string
    from?: string
    to?: string
    warehouseId?: string
    counterpartyId?: string
    q?: string
    yarnQ?: string
  }>
}) {
  const filters = await searchParams
  const [warehouses, counterparties, rows, user] = await Promise.all([
    prisma.warehouse.findMany({ orderBy: { name: 'asc' } }),
    prisma.counterparty.findMany({ orderBy: { name: 'asc' } }),
    getOrderRecords(prisma, {
      type: (filters.type as 'ALL' | 'PURCHASE' | 'SALE') ?? 'ALL',
      from: filters.from,
      to: filters.to,
      warehouseId: filters.warehouseId,
      counterpartyId: filters.counterpartyId,
      q: filters.q,
      yarnQ: filters.yarnQ,
    }),
    getSessionUser(),
  ])

  const params = new URLSearchParams()
  if (filters.type && filters.type !== 'ALL') params.set('type', filters.type)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.warehouseId) params.set('warehouseId', filters.warehouseId)
  if (filters.counterpartyId) params.set('counterpartyId', filters.counterpartyId)
  if (filters.q) params.set('q', filters.q)
  if (filters.yarnQ) params.set('yarnQ', filters.yarnQ)
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
      <OrderTable
        currentUserName={user?.name}
        orders={rows.map((order) => ({
          id: order.id,
          orderType: order.orderType,
          orderNo: order.orderNo,
          date: order.date.toISOString().slice(0, 10),
          counterpartyName: order.counterpartyName,
          warehouseName: order.warehouseName,
          handlerName: order.handlerName,
          totalAmount: order.totalAmount.toString(),
          freight: order.freight.toString(),
          note: order.note,
          items: order.items.map((item) => ({
            yarnName: item.yarnName,
            spec: item.spec,
            color: item.color,
            unit: item.unit,
            batchNo: item.batchNo,
            weight: item.weight.toString(),
            price: item.price.toString(),
            amount: item.amount.toString(),
            packages: item.packages,
          })),
        }))}
      />
    </div>
  )
}
