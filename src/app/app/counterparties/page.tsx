'use client'

import { ResourcePage } from '@/components/resource/ResourcePage'

interface DiscountRow {
  id: string
  date: string
  amount: number
  handlerName: string
}

interface CounterpartyRow {
  id: string
  type: string
  discountTotal: number | null
  discountRecords: DiscountRow[]
}

export default function CounterpartiesPage() {
  return (
    <ResourcePage
      title="往来单位"
      apiPath="/api/counterparties"
      fields={[
        { key: 'name', label: '单位名称', required: true },
        {
          key: 'type',
          label: '类型',
          type: 'select',
          options: [
            { value: 'BOTH', label: '供应商+客户' },
            { value: 'SUPPLIER', label: '供应商' },
            { value: 'CUSTOMER', label: '客户' },
          ],
        },
        { key: 'contact', label: '联系人' },
        { key: 'phone', label: '电话' },
      ]}
      columns={[
        { key: 'name', label: '名称' },
        { key: 'type', label: '类型' },
        { key: 'contact', label: '联系人' },
        { key: 'phone', label: '电话' },
      ]}
      rowExportHrefPrefix="/api/export?section=statement&counterpartyId="
      extraColumns={[{ key: 'discountTotal', label: '折让金 (元)' }]}
      expandRowContent={(row) => {
        const r = row as unknown as CounterpartyRow
        if (!r.discountRecords || r.discountRecords.length === 0) return null
        return (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500">折让明细（按日期）</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-1 pr-3 font-medium">日期</th>
                  <th className="py-1 pr-3 font-medium">金额 (元)</th>
                  <th className="py-1 font-medium">经手人</th>
                </tr>
              </thead>
              <tbody>
                {r.discountRecords.map((rec) => (
                  <tr key={rec.id} className="border-b border-gray-100">
                    <td className="py-1 pr-3">{String(rec.date).slice(0, 10)}</td>
                    <td className="py-1 pr-3">{rec.amount}</td>
                    <td className="py-1">{rec.handlerName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }}
    />
  )
}
