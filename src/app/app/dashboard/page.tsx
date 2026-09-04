import { prisma } from '@/lib/prisma'
import { Table } from '@/components/ui/Table'
import { getInventoryValuation } from '@/services/reports'
import { OrderTraceLink } from '@/components/orders/OrderTraceLink'

export default async function DashboardPage() {
  const [inventory, recent, valuation, stocktakes, warehouses] = await Promise.all([
    prisma.inventory.findMany({
      where: { archived: false, weight: { gt: 0 } },
      include: { warehouse: true, variant: { include: { yarn: true } }, batch: true },
      orderBy: [{ warehouse: { name: 'asc' } }, { variant: { yarn: { name: 'asc' } } }],
    }),
    prisma.purchaseOrder.findMany({
      where: { reversedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { supplier: true, warehouse: true },
    }),
    getInventoryValuation(prisma),
    prisma.stocktake.findMany({ select: { warehouseId: true, date: true } }),
    prisma.warehouse.findMany({ orderBy: { name: 'asc' } }),
  ])

  const byWarehouse = new Map<
    string,
    { id: string; name: string; weight: number; batches: Set<string> }
  >()
  for (const row of inventory) {
    const cur =
      byWarehouse.get(row.warehouseId) ??
      { id: row.warehouseId, name: row.warehouse.name, weight: 0, batches: new Set<string>() }
    cur.weight += Number(row.weight)
    cur.batches.add(row.batchId)
    byWarehouse.set(row.warehouseId, cur)
  }
  const totalWeight = [...byWarehouse.values()].reduce((s, w) => s + w.weight, 0)
  const totalValue = valuation.reduce((s, w) => s + Number(w.value), 0)

  const lastStocktake = new Map<string, Date>()
  for (const st of stocktakes) {
    const cur = lastStocktake.get(st.warehouseId)
    if (!cur || st.date > cur) lastStocktake.set(st.warehouseId, st.date)
  }
  const today = new Date()

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">仓库库存总览</h1>
      <p className="text-sm text-gray-600">
        当前库存总重量：{totalWeight.toFixed(2)} kg，库存金额约 ¥{totalValue.toFixed(2)}
      </p>
      <Table headers={['仓库', '库存重量 (kg)', '库存批次', '金额 (元)', '盘点提醒']}>
        {[...byWarehouse.values()].map((w) => {
          const wh = warehouses.find((x) => x.id === w.id)
          const last = wh ? lastStocktake.get(wh.id) : undefined
          const interval = wh?.stocktakeIntervalDays ?? 30
          const days = last ? Math.floor((today.getTime() - last.getTime()) / 86400000) : null
          const val = valuation.find((v) => v.name === w.name)
          const overdue = days !== null && days > interval
          return (
            <tr key={w.id}>
              <td>{w.name}</td>
              <td>{w.weight.toFixed(2)}</td>
              <td>{w.batches.size}</td>
              <td>{val ? val.value.toString() : '0'}</td>
              <td className={overdue ? 'text-red-600' : ''}>
                {days === null
                  ? '从未盘点'
                  : overdue
                    ? `已超 ${days} 天未盘点`
                    : `距上次盘点 ${days} 天`}
              </td>
            </tr>
          )
        })}
      </Table>

      <h2 className="text-lg font-bold">最近入库</h2>
      <Table headers={['单号', '日期', '供应商', '仓库', '经办人', '总额 (元)']}>
        {recent.map((o) => (
          <tr key={o.id}>
            <td><OrderTraceLink orderNo={o.orderNo} orderType="PURCHASE" /></td>
            <td>{o.date.toISOString().slice(0, 10)}</td>
            <td>{o.supplier.name}</td>
            <td>{o.warehouse.name}</td>
            <td>{o.handlerName}</td>
            <td>{o.totalAmount.toString()}</td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
