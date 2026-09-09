import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Table } from '@/components/ui/Table'
import { getDashboardInventory } from '@/services/dashboard'
import { getActiveWarehouses } from '@/lib/master-data-cache'
import { OrderTraceLink } from '@/components/orders/OrderTraceLink'
import { businessDateToday, formatBusinessDate } from '@/lib/business-date'
import { formatNumber } from '@/lib/display'

export default async function DashboardPage() {
  const [inventory, recent, lastStocktakes, warehouses] = await Promise.all([
    getDashboardInventory(prisma),
    prisma.purchaseOrder.findMany({
      where: { reversedAt: null }, orderBy: { createdAt: 'desc' }, take: 5,
      select: { id: true, orderNo: true, date: true, handlerName: true, totalAmount: true,
        supplier: { select: { name: true } }, warehouse: { select: { name: true } } },
    }),
    prisma.stocktake.groupBy({ by: ['warehouseId'], _max: { date: true } }),
    getActiveWarehouses(),
  ])
  const lastStocktakeByWarehouse = new Map(
    lastStocktakes.map((row) => [row.warehouseId, row._max.date]),
  )
  const totals = warehouses.map((warehouse) => {
    const summary = inventory.byWarehouse.get(warehouse.id)
    const last = lastStocktakeByWarehouse.get(warehouse.id) ?? null
    const days = last ? Math.floor((Date.parse(businessDateToday()) - Date.parse(formatBusinessDate(last))) / 86400000) : null
    return { ...warehouse, weight: summary?.weight ?? 0,
      batches: summary?.batches ?? 0,
      value: summary?.value ?? 0,
      days, overdue: days !== null && days > (warehouse.stocktakeIntervalDays ?? 30) }
  })
  const attention = totals.filter((row) => row.days === null || row.overdue)
  const shortcuts = [
    ['买入入库', '收到货，登记入库', '/app/purchases/new', 'bg-blue-50 text-blue-800'],
    ['卖出出库', '选批次，登记出库', '/app/sales/new', 'bg-emerald-50 text-emerald-800'],
    ['调拨 / 送加工', '从一个地点移到另一个', '/app/transfers/new', 'bg-violet-50 text-violet-800'],
    ['登记结算', '付款、收款、付加工费', '/app/settlements/new', 'bg-amber-50 text-amber-900'],
  ]
  return <div className="space-y-6">
    <div><p className="mb-1 text-sm font-medium text-slate-500">{businessDateToday()} · 北京时间</p>
      <h1 className="text-2xl font-bold">仓库库存总览</h1></div>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="库存摘要">
      {[['当前库存总重量', formatNumber(totals.reduce((sum, row) => sum + row.weight, 0)), 'kg'],
        ['库存金额约', formatNumber(totals.reduce((sum, row) => sum + row.value, 0)), '元'],
        ['在库批次余额', String(inventory.balanceCount), '条'], ['待关注盘点', String(attention.length), '个仓库']].map(([label, value, unit]) =>
        <div key={label} className="form-section"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 break-all text-2xl font-bold tabular-nums text-slate-900">{value}</p><p className="mt-1 text-sm text-slate-500">{unit}</p></div>)}
    </section>
    <section aria-label="快捷办理"><h2 className="mb-3 text-lg font-bold">今天要办什么？</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{shortcuts.map(([title, description, href, tone]) =>
        <Link key={href} href={href} className={`rounded-2xl border border-white p-4 shadow-sm transition hover:shadow-md ${tone}`}>
          <span className="block text-lg font-bold">{title} →</span><span className="mt-2 block text-sm">{description}</span>
        </Link>)}</div>
    </section>
    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">各仓库库存</h2><Link className="choice-chip" href="/app/inventory">查看全部库存</Link></div>
      <Table headers={['仓库', '库存重量 (kg)', '库存批次', '金额 (元)', '盘点提醒']}>
        {totals.length === 0 && <tr><td colSpan={5}>还没有仓库，请先在“更多功能 → 仓库”中添加。</td></tr>}
        {totals.map((row) => <tr key={row.id}>
          <td><Link className="font-semibold text-blue-700 hover:underline" href={`/app/inventory?warehouseId=${row.id}`}>{row.name} →</Link></td>
          <td>{row.weight}</td><td>{row.batches}</td><td>{row.value}</td>
          <td><span className={row.overdue || row.days === null ? 'font-medium text-amber-800' : 'text-slate-600'}>
            {row.days === null ? '从未盘点' : row.overdue ? `逾期 ${row.days - (row.stocktakeIntervalDays ?? 30)} 天（距上次 ${row.days} 天）` : `距上次盘点 ${row.days} 天`}
          </span><Link href="/app/stocktakes/new" className="ml-2 inline-block py-2 text-blue-700">去盘库</Link></td>
        </tr>)}
      </Table>
    </section>
    <section><h2 className="mb-3 text-lg font-bold">最近入库</h2>
      <Table headers={['单号', '日期', '供应商', '仓库', '经办人', '总额 (元)']}>
        {!recent.length && <tr><td colSpan={6}>暂无入库记录，可从上方“买入入库”开始登记。</td></tr>}
        {recent.map((order) => <tr key={order.id}>
          <td><OrderTraceLink orderNo={order.orderNo} orderType="PURCHASE" /></td>
          <td>{formatBusinessDate(order.date)}</td><td>{order.supplier.name}</td><td>{order.warehouse.name}</td><td>{order.handlerName}</td><td>{order.totalAmount.toString()}</td>
        </tr>)}
      </Table>
    </section>
  </div>
}
