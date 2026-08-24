import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Table } from '@/components/ui/Table'

export default async function StocktakesPage() {
  const rows = await prisma.stocktake.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { warehouse: true, items: true },
  })
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">盘点记录</h1>
        <Link
          href="/app/stocktakes/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          新建盘点
        </Link>
      </div>
      <Table headers={['单号', '日期', '仓库', '经办人', '条目数', '盘差合计 (kg)']}>
        {rows.map((o) => {
          const diff = o.items.reduce((s, it) => s + Number(it.diff), 0)
          return (
            <tr key={o.id}>
              <td>{o.orderNo}</td>
              <td>{o.date.toISOString().slice(0, 10)}</td>
              <td>{o.warehouse.name}</td>
              <td>{o.handlerName}</td>
              <td>{o.items.length}</td>
              <td>{diff.toFixed(2)}</td>
            </tr>
          )
        })}
      </Table>
    </div>
  )
}
