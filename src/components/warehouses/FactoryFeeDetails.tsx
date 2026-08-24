'use client'

import { Table } from '@/components/ui/Table'

export interface FactoryFeeRecord {
  id: string
  createdAt: string
  batchNo: string
  inputWeight: string
  outputWeight: string
  feePerKg: string
  feeTotal: string
  remainingWeight: string
  newUnitCost: string
  handlerName: string
  variant: { yarn: { name: string }; spec: string; color: string; unit: string }
}

export function FactoryFeeDetails({
  records,
  feeTotal,
  feePaid,
  feeOwed,
}: {
  records: FactoryFeeRecord[]
  feeTotal: number
  feePaid: number
  feeOwed: number
}) {
  return (
    <div className="space-y-2">
      <Table
        headers={[
          '日期',
          '纱线',
          '规格/色号',
          '批次',
          '本次加工 (kg)',
          '加工后 (kg)',
          '加工费 (元/kg)',
          '加工费合计 (元)',
          '剩余 (kg)',
          '新单位成本 (元/kg)',
          '经办人',
        ]}
      >
        {records.length === 0 && (
          <tr>
            <td colSpan={11} className="text-center text-gray-400">
              暂无加工费结算记录
            </td>
          </tr>
        )}
        {records.map((r) => (
          <tr key={r.id}>
            <td>{new Date(r.createdAt).toLocaleDateString('zh-CN')}</td>
            <td>{r.variant.yarn.name}</td>
            <td>
              {r.variant.spec} {r.variant.color} {r.variant.unit}
            </td>
            <td>{r.batchNo}</td>
            <td>{Number(r.inputWeight).toFixed(2)}</td>
            <td>{Number(r.outputWeight).toFixed(2)}</td>
            <td>{Number(r.feePerKg).toFixed(2)}</td>
            <td>{Number(r.feeTotal).toFixed(2)}</td>
            <td>{Number(r.remainingWeight).toFixed(2)}</td>
            <td>{Number(r.newUnitCost).toFixed(2)}</td>
            <td>{r.handlerName}</td>
          </tr>
        ))}
      </Table>
      <p className="text-sm text-gray-600">
        加工费总额 {feeTotal.toFixed(2)} 元 · 已付 {feePaid.toFixed(2)} 元 · 未付{' '}
        {feeOwed.toFixed(2)} 元
      </p>
    </div>
  )
}
