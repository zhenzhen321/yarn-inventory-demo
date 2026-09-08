import { prisma } from '@/lib/prisma'
import { OrderQueryPanel } from '@/components/reports/OrderQueryPanel'
import { ReportPageHeader } from '@/components/reports/ReportPageHeader'
import { ReportOrderTable } from '@/components/reports/ReportOrderTable'
import { Pager } from '@/components/ui/Pager'
import { getCustomerOrders } from '@/services/reports'
import { formatBusinessDate } from '@/lib/business-date'

const PAGE_SIZE = 20

export default async function CustomerOrdersReportPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; page?: string }>
}) {
  const filters = await searchParams
  const customerId = filters.customerId ?? ''
  const page = Math.max(1, Number.parseInt(filters.page ?? '1', 10) || 1)
  const where = { customerId, reversedAt: null }
  const [customers, total, orders] = await Promise.all([
    prisma.counterparty.findMany({
      where: { active: true, type: { in: ['CUSTOMER', 'BOTH'] } },
      orderBy: { name: 'asc' },
    }),
    customerId ? prisma.saleOrder.count({ where }) : Promise.resolve(0),
    customerId
      ? getCustomerOrders(prisma, customerId, {
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        })
      : Promise.resolve([]),
  ])
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const exportHref = customerId
    ? '/api/export?section=customer-orders&customerId=' + encodeURIComponent(customerId)
    : undefined

  return (
    <div className="space-y-4">
      <ReportPageHeader title="客户订单查询" exportHref={exportHref} />
      <OrderQueryPanel
        entityLabel="客户"
        idParam="customerId"
        selectedId={customerId}
        options={customers.map((customer) => ({ id: customer.id, name: customer.name }))}
        baseParams={{ customerId }}
      />
      <ReportOrderTable
        orders={orders.map((order) => ({
          id: order.id,
          orderNo: order.orderNo,
          date: formatBusinessDate(order.date),
          warehouseName: order.warehouseName,
          handlerName: order.handlerName,
          counterpartyName: order.counterpartyName,
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
      {customerId && (
        <Pager
          page={page}
          totalPages={totalPages}
          label="客户订单翻页"
          buildHref={(p) =>
            `/app/reports/customer-orders?customerId=${encodeURIComponent(customerId)}&page=${p}`
          }
          basePath="/app/reports/customer-orders"
          params={{ customerId }}
        />
      )}
    </div>
  )
}
