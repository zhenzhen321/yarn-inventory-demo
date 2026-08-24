import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Table } from '@/components/ui/Table'
import { OrderQueryPanel } from '@/components/reports/OrderQueryPanel'
import { ExportLink } from '@/components/reports/ExportLink'
import {
  getCustomerOrders,
  getInventoryValuation,
  getProfitEstimate,
  getRecentFlow,
  getSupplierOrders,
} from '@/services/reports'
import {
  getPayableSummary,
  getReceivableSummary,
  getSettlementRecords,
  STATUS_LABEL,
} from '@/services/settlement'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: {
    customerId?: string
    supplierId?: string
  }
}) {
  const customerId = searchParams.customerId ?? ''
  const supplierId = searchParams.supplierId ?? ''

  const [
    valuation,
    payables,
    receivables,
    flow,
    customers,
    suppliers,
    customerOrders,
    supplierOrders,
    profit,
    settlementRecords,
  ] = await Promise.all([
      getInventoryValuation(prisma),
      getPayableSummary(prisma),
      getReceivableSummary(prisma),
      getRecentFlow(prisma, 30),
      prisma.counterparty.findMany({
        where: { active: true, type: { in: ['CUSTOMER', 'BOTH'] } },
        orderBy: { name: 'asc' },
      }),
      prisma.counterparty.findMany({
        where: { active: true, type: { in: ['SUPPLIER', 'BOTH'] } },
        orderBy: { name: 'asc' },
      }),
      getCustomerOrders(prisma, customerId),
      getSupplierOrders(prisma, supplierId),
      getProfitEstimate(prisma),
      getSettlementRecords(prisma),
    ])

  const totalWeight = valuation.reduce((s, w) => s + w.weight, 0)
  const totalValue = valuation.reduce((s, w) => s.plus(w.value), new Prisma.Decimal(0))
  const baseParams: Record<string, string> = {
    customerId,
    supplierId,
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">报表</h1>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">客户订单查询</h2>
          {customerId && (
            <ExportLink
              href={`/api/export?section=customer-orders&customerId=${encodeURIComponent(customerId)}`}
            />
          )}
        </div>
        <OrderQueryPanel
          entityLabel="客户"
          idParam="customerId"
          selectedId={customerId}
          options={customers.map((c) => ({ id: c.id, name: c.name }))}
          baseParams={baseParams}
        />
        <Table headers={['单号', '日期', '仓库', '经办人', '总额 (元)', '运费 (元)']}>
          {customerOrders.map((o) => (
            <tr key={`c-${o.id}`}>
              <td>{o.orderNo}</td>
              <td>{o.date.toISOString().slice(0, 10)}</td>
              <td>{o.warehouseName}</td>
              <td>{o.handlerName}</td>
              <td>{o.totalAmount.toString()}</td>
              <td>{o.freight.toString()}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">供应商订单查询</h2>
          {supplierId && (
            <ExportLink
              href={`/api/export?section=supplier-orders&supplierId=${encodeURIComponent(supplierId)}`}
            />
          )}
        </div>
        <OrderQueryPanel
          entityLabel="供应商"
          idParam="supplierId"
          selectedId={supplierId}
          options={suppliers.map((s) => ({ id: s.id, name: s.name }))}
          baseParams={baseParams}
        />
        <Table headers={['单号', '日期', '仓库', '经办人', '总额 (元)', '运费 (元)']}>
          {supplierOrders.map((o) => (
            <tr key={`s-${o.id}`}>
              <td>{o.orderNo}</td>
              <td>{o.date.toISOString().slice(0, 10)}</td>
              <td>{o.warehouseName}</td>
              <td>{o.handlerName}</td>
              <td>{o.totalAmount.toString()}</td>
              <td>{o.freight.toString()}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">结算记录</h2>
          <ExportLink href="/api/export?section=settlements" />
        </div>
        <Table headers={['类型', '客户/供应商', '日期', '金额 (元)', '方式', '经手人']}>
          {settlementRecords.slice(0, 50).map((r) => (
            <tr key={r.id}>
              <td>{r.side === 'PURCHASE' ? '买入应付' : '卖出应收'}</td>
              <td>{r.counterpartyName}</td>
              <td>{r.date.toISOString().slice(0, 10)}</td>
              <td>{r.amount.toString()}</td>
              <td>{r.method ?? '-'}</td>
              <td>{r.handlerName}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">毛利估算（含运费）</h2>
        <Table headers={['项目', '金额 (元)']}>
          <tr>
            <td>卖出货款合计</td>
            <td>{profit.saleGoodsTotal.toString()}</td>
          </tr>
          <tr>
            <td>估算销售成本（按库存单位成本）</td>
            <td>{profit.estimatedCost.toString()}</td>
          </tr>
          <tr>
            <td>估算运费（按库存单位运费）</td>
            <td>{profit.estimatedFreight.toString()}</td>
          </tr>
          <tr>
            <td>卖货运费合计</td>
            <td>{profit.saleFreightTotal.toString()}</td>
          </tr>
          <tr>
            <td>估算毛利</td>
            <td>{profit.estimatedProfit.toString()}</td>
          </tr>
        </Table>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">库存金额（按库存成本）</h2>
          <ExportLink href="/api/export?section=inventory" />
        </div>
        <p className="text-sm text-gray-600">
          总重量 {totalWeight.toFixed(2)} kg，总金额 {totalValue.toFixed(2)} 元
        </p>
        <Table headers={['仓库', '重量 (kg)', '金额 (元)']}>
          {valuation.map((w) => (
            <tr key={w.name}>
              <td>{w.name}</td>
              <td>{w.weight.toFixed(2)}</td>
              <td>{w.value.toString()}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">应付供应商</h2>
          <ExportLink href="/api/export?section=payables" />
        </div>
        <Table headers={['供应商', '应付总额 (元)', '已付', '未付']}>
          {payables.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td>{p.totalAmount.toString()}</td>
              <td>{p.settledAmount.toString()}</td>
              <td>{p.remainingAmount.toString()}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">应收客户</h2>
          <ExportLink href="/api/export?section=receivables" />
        </div>
        <Table headers={['客户', '应收总额 (元)', '已收', '未收']}>
          {receivables.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.totalAmount.toString()}</td>
              <td>{r.settledAmount.toString()}</td>
              <td>{r.remainingAmount.toString()}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">近 30 天进出流水</h2>
          <ExportLink href="/api/export?section=flow" />
        </div>
        <Table headers={['类型', '单号', '日期', '对方', '仓库', '金额 (元)']}>
          {flow.map((f) => (
            <tr key={`${f.type}-${f.orderNo}`}>
              <td>{f.type === 'PURCHASE' ? '买入' : '卖出'}</td>
              <td>{f.orderNo}</td>
              <td>{f.date.toISOString().slice(0, 10)}</td>
              <td>{f.counterpartyName}</td>
              <td>{f.warehouseName}</td>
              <td>{f.amount.toString()}</td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  )
}
