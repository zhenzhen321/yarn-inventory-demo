'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { Table } from '@/components/ui/Table'
import { RevertButton } from '@/components/common/RevertButton'
import { LabelPrintButton } from '@/components/labels/LabelPrintButton'

export interface OrderTableItem {
  yarnName: string
  spec: string
  color: string
  unit: string
  batchNo: string
  weight: string
  price: string
  amount: string
  packages: number | null
  lotId: string | null
  lotNo: string | null
  scanCode: string | null
}

export interface OrderTableRecord {
  id: string
  orderType: 'PURCHASE' | 'SALE'
  orderNo: string
  date: string
  counterpartyName: string
  warehouseName: string
  handlerName: string
  totalAmount: string
  freight: string
  note: string | null
  reversedAt: string | null
  reversedBy: string | null
  items: OrderTableItem[]
}

function summarize(values: string[]) {
  const unique = [...new Set(values.filter(Boolean))]
  if (unique.length <= 2) return unique.join('、') || '-'
  return `${unique.slice(0, 2).join('、')} 等${unique.length}种`
}

export function OrderTable({
  orders,
  currentUserName,
  initialExpandedOrderNo,
}: {
  orders: OrderTableRecord[]
  currentUserName?: string
  initialExpandedOrderNo?: string
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const focused = orders.find((order) => order.orderNo === initialExpandedOrderNo)
    return new Set(focused ? [focused.id] : [])
  })

  useEffect(() => {
    if (!initialExpandedOrderNo) return
    const focused = orders.find((order) => order.orderNo === initialExpandedOrderNo)
    if (!focused) return
    setExpandedIds((current) => new Set(current).add(focused.id))
    requestAnimationFrame(() => {
      document.getElementById(`order-record-${focused.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }, [initialExpandedOrderNo, orders])

  function toggle(orderId: string) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  return (
    <Table headers={['单号', '供应商/客户', '支数', '色号', '总额 (元)']}>
      {orders.length === 0 ? (
        <tr>
          <td colSpan={5} className="py-8 text-center text-gray-500">暂无记录</td>
        </tr>
      ) : null}
      {orders.map((order) => {
        const expanded = expandedIds.has(order.id)
        const detailsId = `order-record-details-${order.id}`
        const canRevert = Boolean(
          !order.reversedAt && currentUserName && currentUserName === order.handlerName,
        )
        const revertHref =
          order.orderType === 'PURCHASE'
            ? `/api/purchases/${order.id}`
            : `/api/sales/${order.id}`

        return (
          <Fragment key={order.id}>
            <tr id={`order-record-${order.id}`} className="scroll-mt-24 border-b last:border-b-0">
              <td>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  onClick={() => toggle(order.id)}
                  className="inline-flex items-center gap-1 rounded font-medium text-blue-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <span aria-hidden="true" className="w-3 text-xs">
                    {expanded ? '▼' : '▶'}
                  </span>
                  {order.orderNo}
                  {order.reversedAt ? '（已撤回）' : ''}
                </button>
              </td>
              <td>{order.counterpartyName}</td>
              <td title={[...new Set(order.items.map((item) => item.spec))].join('、')}>
                {summarize(order.items.map((item) => item.spec))}
              </td>
              <td title={[...new Set(order.items.map((item) => item.color))].join('、')}>
                {summarize(order.items.map((item) => item.color))}
              </td>
              <td>{order.totalAmount}</td>
            </tr>

            {expanded ? (
              <tr id={detailsId} className="border-b bg-slate-50">
                <td colSpan={5} className="p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="grid flex-1 gap-x-6 gap-y-1 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <span className="text-gray-500">类型：</span>
                        {order.orderType === 'PURCHASE' ? '买入' : '卖出'}
                      </div>
                      <div><span className="text-gray-500">日期：</span>{order.date}</div>
                      <div><span className="text-gray-500">往来单位：</span>{order.counterpartyName}</div>
                      <div><span className="text-gray-500">仓库：</span>{order.warehouseName}</div>
                      <div><span className="text-gray-500">经办人：</span>{order.handlerName}</div>
                      <div><span className="text-gray-500">货款：</span>{order.totalAmount} 元</div>
                      <div><span className="text-gray-500">运费：</span>{order.freight} 元</div>
                      <div><span className="text-gray-500">备注：</span>{order.note || '无'}</div>
                      <div>
                        <span className="text-gray-500">状态：</span>
                        {order.reversedAt
                          ? `已由 ${order.reversedBy ?? '未知'} 撤回（原单保留）`
                          : '有效'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {order.orderType === 'PURCHASE' && !order.reversedAt ? (
                        <LabelPrintButton
                          order={{
                            orderNo: order.orderNo,
                            items: order.items.map((item) => ({
                              yarnName: item.yarnName,
                              spec: item.spec,
                              color: item.color,
                              weight: item.weight,
                              unit: item.unit,
                              packages: item.packages,
                              batchNo: item.batchNo,
                              lotNo: item.lotNo,
                              scanCode: item.scanCode,
                            })),
                          }}
                          label="补打标签"
                          className="px-2 py-1 text-xs"
                        />
                      ) : null}
                      {canRevert ? <RevertButton href={revertHref} label="撤回本单" subject={order.orderNo + " · " + order.counterpartyName + " · ¥" + order.totalAmount} /> : null}
                    </div>
                  </div>

                  <div className="detail-table-shell overflow-x-auto rounded border bg-white">
                    <table className="detail-table w-full min-w-[780px] text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50 text-left text-gray-600">
                          {['品名', '支数', '色号', '单位', '批次', '内部批次', '重量', '单价', '金额', '件数'].map(
                            (header) => (
                              <th key={header} className="px-3 py-2 font-medium">{header}</th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {order.items.map((item, index) => (
                          <tr key={`${order.id}-${index}`} className="border-b last:border-b-0">
                            <td data-label="品名" className="px-3 py-2">{item.yarnName}</td>
                            <td data-label="支数" className="px-3 py-2">{item.spec}</td>
                            <td data-label="色号" className="px-3 py-2">{item.color}</td>
                            <td data-label="单位" className="px-3 py-2">{item.unit}</td>
                            <td data-label="批次" className="px-3 py-2">{item.batchNo}</td>
                            <td data-label="内部批次" className="px-3 py-2">
                              {item.lotId ? (
                                <Link href={`/app/lots/${item.lotId}`} className="text-blue-700 hover:underline">
                                  {item.lotNo}
                                </Link>
                              ) : '-'}
                            </td>
                            <td data-label="重量" className="px-3 py-2">{item.weight}</td>
                            <td data-label="单价" className="px-3 py-2">{item.price}</td>
                            <td data-label="金额" className="px-3 py-2">{item.amount}</td>
                            <td data-label="件数" className="px-3 py-2">{item.packages ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            ) : null}
          </Fragment>
        )
      })}
    </Table>
  )
}
