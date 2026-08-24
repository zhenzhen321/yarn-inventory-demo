'use client'

import { useState } from 'react'
import { Table } from '@/components/ui/Table'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import { RevertButton } from '@/components/common/RevertButton'
import type { OrderRecord } from '@/services/orders'

export function OrderTable({
  orders,
  currentUserName,
}: {
  orders: OrderRecord[]
  currentUserName?: string
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Table
      headers={[
        '',
        '日期',
        '供应商/客户',
        '名称',
        '支数',
        '色号',
        '单位',
        '数量',
        '金额 (元)',
        '备注',
        '操作',
      ]}
    >
      {orders.length === 0 && (
        <tr>
          <td colSpan={11} className="text-center text-gray-400">
            暂无记录
          </td>
        </tr>
      )}
      {orders.map((o) => (
        <OrderRows
          key={o.id}
          order={o}
          isOpen={expanded.has(o.id)}
          onToggle={() => toggle(o.id)}
          currentUserName={currentUserName}
        />
      ))}
    </Table>
  )
}

function OrderRows({
  order,
  isOpen,
  onToggle,
  currentUserName,
}: {
  order: OrderRecord
  isOpen: boolean
  onToggle: () => void
  currentUserName?: string
}) {
  const canRevert = !!currentUserName && currentUserName === order.handlerName
  const revertHref =
    order.orderType === 'PURCHASE' ? `/api/purchases/${order.id}` : `/api/sales/${order.id}`
  return (
    <>
      {order.items.map((it, idx) => (
        <tr key={`${order.id}-${idx}`} className="border-b border-gray-100">
          {idx === 0 && (
            <td rowSpan={order.items.length}>
              <div className="flex flex-col gap-1">
                <CollapseToggle
                  expanded={isOpen}
                  onClick={onToggle}
                  label="展开/收起明细"
                />
                {canRevert && <RevertButton href={revertHref} />}
              </div>
            </td>
          )}
          <td>{order.date.toISOString().slice(0, 10)}</td>
          <td>{order.counterpartyName}</td>
          <td>{it.yarnName}</td>
          <td>{it.spec}</td>
          <td>{it.color}</td>
          <td>{it.unit}</td>
          <td>{it.weight.toString()}</td>
          <td>{it.amount.toString()}</td>
          <td>{order.note ?? '-'}</td>
        </tr>
      ))}
      {isOpen && (
        <tr className="bg-gray-50">
          <td colSpan={11} className="text-xs text-gray-600">
            类型：{order.orderType === 'PURCHASE' ? '买入' : '卖出'} | 单号：{order.orderNo} |
            仓库：{order.warehouseName} | 经办人：{order.handlerName} |
            货款合计：{order.totalAmount.toString()} 元 | 运费：{order.freight.toString()} 元 |
            备注：{order.note ?? '-'}
          </td>
        </tr>
      )}
    </>
  )
}
