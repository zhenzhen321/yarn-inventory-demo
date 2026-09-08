import { prisma } from '@/lib/prisma'
import { OrderQueryPanel } from '@/components/reports/OrderQueryPanel'
import { ReportPageHeader } from '@/components/reports/ReportPageHeader'
import { ReportOrderTable } from '@/components/reports/ReportOrderTable'
import { Pager } from '@/components/ui/Pager'
import { getSupplierOrders } from '@/services/reports'
import { formatBusinessDate } from '@/lib/business-date'

const PAGE_SIZE = 20

export default async function SupplierOrdersReportPage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string; page?: string }>
}) {
  const filters = await searchParams
  const supplierId = filters.supplierId ?? ''
  const page = Math.max(1, Number.parseInt(filters.page ?? '1', 10) || 1)
  const where = { supplierId, reversedAt: null }
  const [suppliers, total, orders] = await Promise.all([
    prisma.counterparty.findMany({
      where: { active: true, type: { in: ['SUPPLIER', 'BOTH'] } },
      orderBy: { name: 'asc' },
    }),
    supplierId ? prisma.purchaseOrder.count({ where }) : Promise.resolve(0),
    supplierId
      ? getSupplierOrders(prisma, supplierId, {
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        })
      : Promise.resolve([]),
  ])
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const exportHref = supplierId
    ? '/api/export?section=supplier-orders&supplierId=' + encodeURIComponent(supplierId)
    : undefined

  return (
    <div className="space-y-4">
      <ReportPageHeader title="供应商订单查询" exportHref={exportHref} />
      <OrderQueryPanel
        entityLabel="供应商"
        idParam="supplierId"
        selectedId={supplierId}
        options={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        baseParams={{ supplierId }}
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
      {supplierId && (
        <Pager
          page={page}
          totalPages={totalPages}
          label="供应商订单翻页"
          buildHref={(p) =>
            `/app/reports/supplier-orders?supplierId=${encodeURIComponent(supplierId)}&page=${p}`
          }
          basePath="/app/reports/supplier-orders"
          params={{ supplierId }}
        />
      )}
    </div>
  )
}
