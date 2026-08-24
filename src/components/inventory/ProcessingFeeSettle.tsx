'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'
import { CollapseToggle } from '@/components/ui/CollapseToggle'

export interface FactoryInventoryRow {
  id: string
  warehouseName: string
  yarnName: string
  spec: string
  color: string | null
  unit: string
  batchNo: string
  weight: number
  cost: number
  feePerKg: number | null
  settled: boolean
}

export function ProcessingFeeSettle({ rows }: { rows: FactoryInventoryRow[] }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<FactoryInventoryRow | null>(null)

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <CollapseToggle
          expanded={open}
          onClick={() => setOpen((v) => !v)}
          label="展开/收起加工费结算"
        />
        <h2 className="text-lg font-bold">加工厂 · 加工费结算</h2>
      </div>
      {open && (
        <>
          <p className="text-sm text-gray-600">
            只有已结算加工费的库存才能调拨出加工厂或直接卖出；点击“结算加工费”确认加工后信息并结算。
          </p>
          <Table
            headers={[
              '仓库',
              '纱线',
              '规格/色号',
              '批次',
              '重量 (kg)',
              '单位成本 (元/kg)',
              '加工费 (元/kg)',
              '状态',
              '操作',
            ]}
          >
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-gray-400">
                  加工厂暂无库存
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const w = r.weight
              const unitCost = w > 0 ? (r.cost / w).toFixed(2) : '-'
              return (
                <tr key={r.id}>
                  <td>{r.warehouseName}</td>
                  <td>{r.yarnName}</td>
                  <td>
                    {r.spec} {r.color ?? ''} {r.unit}
                  </td>
                  <td>{r.batchNo}</td>
                  <td>{w.toFixed(2)}</td>
                  <td>{unitCost}</td>
                  <td>{r.settled ? r.feePerKg?.toString() ?? '-' : '-'}</td>
                  <td>{r.settled ? '已算' : '未算'}</td>
                  <td>
                    {!r.settled && (
                      <Button
                        type="button"
                        onClick={() => setActive(r)}
                        className="bg-blue-600 text-xs hover:bg-blue-700"
                      >
                        结算加工费
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </Table>
        </>
      )}
      {active && (
        <ProcessingFeeModal
          row={active}
          existingSettledKg={rows
            .filter(
              (r) =>
                r.settled &&
                r.warehouseName === active.warehouseName &&
                r.yarnName === active.yarnName &&
                r.spec === active.spec &&
                r.color === active.color &&
                r.unit === active.unit &&
                r.batchNo === active.batchNo,
            )
            .reduce((s, r) => s + r.weight, 0)}
          onClose={() => setActive(null)}
        />
      )}
    </section>
  )
}

function ProcessingFeeModal({
  row,
  existingSettledKg,
  onClose,
}: {
  row: FactoryInventoryRow
  existingSettledKg: number
  onClose: () => void
}) {
  const router = useRouter()
  const [fee, setFee] = useState('')
  const [inputWeight, setInputWeight] = useState(String(row.weight))
  const [outputWeight, setOutputWeight] = useState(String(row.weight))
  const [outputTouched, setOutputTouched] = useState(false)
  const [spec, setSpec] = useState(row.spec)
  const [color, setColor] = useState(row.color ?? '')
  const [unit, setUnit] = useState(row.unit)
  const [batchNo, setBatchNo] = useState(row.batchNo)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const wIn = Number(inputWeight) || 0
  const wOut = Number(outputWeight) || 0
  const feeNum = Number(fee) || 0
  const remaining = row.weight - wIn
  const inputOk = wIn > 0 && wIn <= row.weight
  const movedCost = row.weight > 0 && wIn > 0 ? (row.cost * wIn) / row.weight : 0
  const newUnitCost = inputOk && wOut > 0 ? (movedCost + feeNum * wOut) / wOut : null
  const identityChanged =
    spec !== row.spec || color !== (row.color ?? '') || unit !== row.unit || batchNo !== row.batchNo

  function onInputWeightChange(v: string) {
    setInputWeight(v)
    if (!outputTouched) setOutputWeight(v)
  }

  async function submit() {
    setBusy(true)
    setMessage('')
    const res = await fetch(`/api/inventory/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        processingFeePerKg: Number(fee),
        inputWeight: Number(inputWeight),
        spec,
        color,
        unit,
        batchNo,
        outputWeight: Number(outputWeight),
      }),
    })
    if (res.ok) {
      router.refresh()
      onClose()
      return
    }
    const data = await res.json().catch(() => ({}))
    setMessage(data.error || '结算失败')
    setBusy(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4"
    >
      <div
        className="mx-auto my-4 w-full max-w-lg space-y-3 rounded border bg-white p-5 shadow-lg sm:my-8"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold">结算加工费 · 加工后信息确认</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-1 text-2xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            ×
          </button>
        </div>
        <p className="text-sm text-gray-600">
          {row.warehouseName} · {row.yarnName} {row.spec} {row.color ?? ''} {row.unit} 批次
          {row.batchNo}（当前 {row.weight.toFixed(2)} kg，单位成本{' '}
          {row.weight > 0 ? (row.cost / row.weight).toFixed(2) : '-'} 元/kg）
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm">
            本次加工重量 (kg)
            <Input
              type="number"
              step="0.01"
              min="0"
              value={inputWeight}
              onChange={(e) => onInputWeightChange(e.target.value)}
            />
          </label>
          <label className="text-sm">
            加工费 (元/kg)
            <Input
              type="number"
              step="0.01"
              min="0"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="必填"
            />
          </label>
          <label className="text-sm">
            加工后重量 (kg)
            <Input
              type="number"
              step="0.01"
              min="0"
              value={outputWeight}
              onChange={(e) => {
                setOutputWeight(e.target.value)
                setOutputTouched(true)
              }}
            />
          </label>
          <label className="text-sm">
            支数
            <Input value={spec} onChange={(e) => setSpec(e.target.value)} />
          </label>
          <label className="text-sm">
            色号
            <Input value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label className="text-sm">
            单位
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
          <label className="text-sm">
            批次/缸号
            <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
          </label>
        </div>
        <p className="text-sm text-gray-600">
          本次加工重量小于当前库存即为部分结算，剩余继续留在加工厂（未算）；默认保持原信息，如需登记加工后变化直接修改对应字段。
          {identityChanged && (
            <span className="text-amber-600">（检测到信息变化，将按新信息登记）</span>
          )}
        </p>
        {!inputOk && wIn > 0 && (
          <p className="text-sm text-red-600">
            本次加工重量不能超过当前库存（{row.weight.toFixed(2)} kg）
          </p>
        )}
        <p className="text-sm text-gray-700">
          {remaining > 0
            ? `结算后剩余 ${remaining.toFixed(2)} kg（未算，可继续结算）`
            : '本次全部结算，原行归零（已算）'}
          {' · '}已算行累计（含本次）：{(existingSettledKg + wOut).toFixed(2)} kg
        </p>
        {newUnitCost !== null && (
          <p className="text-sm text-gray-700">
            本次产出单位成本预估：¥{newUnitCost.toFixed(2)} / kg
          </p>
        )}
        {message && <p className="text-sm text-red-600">{message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose} className="bg-gray-500 hover:bg-gray-600">
            取消
          </Button>
          <Button type="button" disabled={busy || !inputOk || wOut <= 0} onClick={submit}>
            {busy ? '结算中…' : '确认结算'}
          </Button>
        </div>
      </div>
    </div>
  )
}
