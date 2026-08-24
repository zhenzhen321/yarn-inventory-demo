'use client'

import { ResourcePage } from '@/components/resource/ResourcePage'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import {
  FactoryFeeDetails,
  type FactoryFeeRecord,
} from '@/components/warehouses/FactoryFeeDetails'

export default function WarehousesPage() {
  return (
    <ResourcePage
      title="仓库管理"
      apiPath="/api/warehouses"
      fields={[
        { key: 'name', label: '仓库名称', required: true },
        {
          key: 'type',
          label: '类型',
          type: 'select',
          options: [
            { value: 'WAREHOUSE', label: '普通仓库' },
            { value: 'FACTORY', label: '加工厂' },
          ],
        },
        { key: 'address', label: '地址' },
        { key: 'manager', label: '负责人' },
      ]}
      columns={[
        { key: 'name', label: '名称' },
        { key: 'type', label: '类型', labelMap: { WAREHOUSE: '普通仓库', FACTORY: '加工厂' } },
        { key: 'address', label: '地址' },
        { key: 'manager', label: '负责人' },
      ]}
      extraColumns={[
        {
          key: 'feeOwed',
          label: '欠加工费 (元)',
          render: (row) =>
            row.type === 'FACTORY' ? Number(row.feeOwed ?? 0).toFixed(2) : '-',
        },
        {
          key: 'feeCount',
          label: '加工费明细',
          render: (row, { expanded, onToggle }) =>
            row.type === 'FACTORY' ? (
              <div className="flex items-center gap-1">
                <CollapseToggle expanded={expanded} onClick={onToggle} label="展开加工费明细" />
                <span>{String(row.feeCount ?? 0)} 条</span>
              </div>
            ) : (
              '-'
            ),
        },
        {
          key: 'statement',
          label: '对账单',
          render: (row) =>
            row.type === 'FACTORY' ? (
              <a
                href={`/api/export?section=factory-statement&warehouseId=${row.id}`}
                className="rounded border border-blue-600 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
              >
                导出对账单
              </a>
            ) : (
              '-'
            ),
        },
      ]}
      expandRowContent={(row) =>
        row.type === 'FACTORY' ? (
          <FactoryFeeDetails
            records={(row.processingFeeSettlements ?? []) as FactoryFeeRecord[]}
            feeTotal={Number(row.feeTotal ?? 0)}
            feePaid={Number(row.feePaid ?? 0)}
            feeOwed={Number(row.feeOwed ?? 0)}
          />
        ) : null
      }
    />
  )
}
