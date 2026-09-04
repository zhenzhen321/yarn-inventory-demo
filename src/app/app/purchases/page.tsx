import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Table } from '@/components/ui/Table'
import { OrderTraceLink } from '@/components/orders/OrderTraceLink'

export default async function PurchasesPage() {
  const orders = await prisma.purchaseOrder.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { supplier: true, warehouse: true },
  })
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">入库记录</h1>
        <Link
          href="/app/purchases/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          新建入库
        </Link>
      </div>
      <Table headers={['单号', '日期', '供应商', '仓库', '经办人', '货款 (元)', '运费 (元)', '状态', '备注']}>
        {orders.map((o) => (
          <tr key={o.id}>
            <td><OrderTraceLink orderNo={o.orderNo} orderType="PURCHASE" /></td>
            <td>{o.date.toISOString().slice(0, 10)}</td>
            <td>{o.supplier.name}</td>
            <td>{o.warehouse.name}</td>
            <td>{o.handlerName}</td>
            <td>{o.totalAmount.toString()}</td>
            <td>{o.freight.toString()}</td>
            <td>{o.reversedAt ? `已撤回（${o.reversedBy ?? '未知'}）` : '有效'}</td>
            <td>{o.note ?? '-'}</td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
