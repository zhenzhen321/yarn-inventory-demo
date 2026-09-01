'use client'

import { Fragment, useState } from 'react'
import { Table } from '@/components/ui/Table'

export interface ReportOrderItem {
  yarnName: string
  spec: string
  color: string
  unit: string
  batchNo: string
  weight: string
  price: string
  amount: string
  packages: number | null
}

export interface ReportOrder {
  id: string
  orderNo: string
  date: string
  warehouseName: string
  handlerName: string
  counterpartyName: string
  totalAmount: string
  freight: string
  note: string | null
  items: ReportOrderItem[]
}

export function ReportOrderTable({ orders }: { orders: ReportOrder[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  function toggle(orderId: string) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  return (
    <Table headers={['单号', '日期', '仓库', '经办人', '总额 (元)', '运费 (元)']}>
      {orders.length === 0 ? (
        <tr>
          <td colSpan={6} className="py-8 text-center text-gray-500">暂无订单</td>
        </tr>
      ) : null}
      {orders.map((order) => {
        const expanded = expandedIds.has(order.id)
        const detailsId = `report-order-details-${order.id}`
        return (
          <Fragment key={order.id}>
            <tr className="border-b last:border-b-0">
              <td>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  onClick={() => toggle(order.id)}
                  className="inline-flex items-center gap-1 rounded font-medium text-blue-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <span aria-hidden="true" className="w-3 text-xs">{expanded ? '▼' : '▶'}</span>
                  {order.orderNo}
                </button>
              </td>
              <td>{order.date}</td>
              <td>{order.warehouseName}</td>
              <td>{order.handlerName}</td>
              <td>{order.totalAmount}</td>
              <td>{order.freight}</td>
            </tr>
            {expanded ? (
              <tr id={detailsId} className="border-b bg-slate-50">
                <td colSpan={6} className="p-4">
                  <div className="mb-3 grid gap-x-6 gap-y-1 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
                    <div><span className="text-gray-500">往来单位：</span>{order.counterpartyName}</div>
                    <div><span className="text-gray-500">日期：</span>{order.date}</div>
                    <div><span className="text-gray-500">仓库：</span>{order.warehouseName}</div>
                    <div><span className="text-gray-500">经办人：</span>{order.handlerName}</div>
                    <div><span className="text-gray-500">货款：</span>{order.totalAmount} 元</div>
                    <div><span className="text-gray-500">运费：</span>{order.freight} 元</div>
                    <div className="sm:col-span-2"><span className="text-gray-500">备注：</span>{order.note || '无'}</div>
                  </div>
                  <div className="overflow-x-auto rounded border bg-white">
                    <table className="w-full min-w-[780px] text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50 text-left text-gray-600">
                          {['品名', '支数', '颜色', '单位', '批次', '重量', '单价', '金额', '包数'].map((header) => (
                            <th key={header} className="px-3 py-2 font-medium">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {order.items.map((item, index) => (
                          <tr key={`${order.id}-${index}`} className="border-b last:border-b-0">
                            <td className="px-3 py-2">{item.yarnName}</td>
                            <td className="px-3 py-2">{item.spec}</td>
                            <td className="px-3 py-2">{item.color}</td>
                            <td className="px-3 py-2">{item.unit}</td>
                            <td className="px-3 py-2">{item.batchNo}</td>
                            <td className="px-3 py-2">{item.weight}</td>
                            <td className="px-3 py-2">{item.price}</td>
                            <td className="px-3 py-2">{item.amount}</td>
                            <td className="px-3 py-2">{item.packages ?? '-'}</td>
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
