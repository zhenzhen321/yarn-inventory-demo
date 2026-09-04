'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import {
  LabelPrintButton,
  type LabelPrintOrder,
} from '@/components/labels/LabelPrintButton'

export interface FactoryInventoryRow {
  id: string
  warehouseName: string
  yarnName: string
  spec: string
  color: string | null
  unit: string
  batchNo: string
  lotNo: string | null
  weight: number
  packages: number | null
  cost: number
  feePerKg: number | null
  settled: boolean
}

export function ProcessingFeeSettle({ rows }: { rows: FactoryInventoryRow[] }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<FactoryInventoryRow | null>(null)
  const [completedLabel, setCompletedLabel] = useState<LabelPrintOrder | null>(null)

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <CollapseToggle
          expanded={open}
          onClick={() => setOpen((value) => !value)}
          label="展开/收起加工完工核算"
        />
        <h2 className="text-lg font-bold">加工厂 · 完工核算</h2>
      </div>
      {completedLabel && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-medium text-green-800">
            加工完工已生成新成品批次，请给这一批贴上新标签。
          </p>
          <LabelPrintButton order={completedLabel} label="打印成品批次标签" />
        </div>
      )}
      {open && (
        <>
          <p className="text-sm text-gray-600">
            完工时填写实际成品重量、件数和加工费。系统会消耗原批次并建立新的成品批次；
            加工费在此时计入成本和应付，是否已经转账付款另行登记。
          </p>
          <Table
            headers={[
              '加工厂',
              '纱线',
              '规格/色号',
              '内部批次',
              '批次/缸号',
              '重量/件数',
              '单位成本',
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
            {rows.map((row) => {
              const unitCost = row.weight > 0 ? (row.cost / row.weight).toFixed(2) : '-'
              return (
                <tr key={row.id}>
                  <td>{row.warehouseName}</td>
                  <td>{row.yarnName}</td>
                  <td>{row.spec} {row.color ?? ''} {row.unit}</td>
                  <td>{row.lotNo ?? '历史汇总批次'}</td>
                  <td>{row.batchNo}</td>
                  <td>{row.weight.toFixed(2)} kg / {row.packages ?? '-'} 件</td>
                  <td>{unitCost} 元/kg</td>
                  <td>{row.settled ? '成品（已核算）' : '待加工核算'}</td>
                  <td>
                    {!row.settled && (
                      <Button
                        type="button"
                        onClick={() => setActive(row)}
                        className="bg-blue-600 text-xs hover:bg-blue-700"
                      >
                        登记完工
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
        <ProcessingCompletionModal
          row={active}
          onClose={() => setActive(null)}
          onCompleted={(labelOrder) => {
            setCompletedLabel(labelOrder)
            setActive(null)
          }}
        />
      )}
    </section>
  )
}

function ProcessingCompletionModal({
  row,
  onClose,
  onCompleted,
}: {
  row: FactoryInventoryRow
  onClose: () => void
  onCompleted: (labelOrder: LabelPrintOrder) => void
}) {
  const router = useRouter()
  const [fee, setFee] = useState('')
  const [inputWeight, setInputWeight] = useState(String(row.weight))
  const [inputPackages, setInputPackages] = useState(row.packages?.toString() ?? '')
  const [outputWeight, setOutputWeight] = useState(String(row.weight))
  const [outputPackages, setOutputPackages] = useState(row.packages?.toString() ?? '')
  const [outputTouched, setOutputTouched] = useState(false)
  const [spec, setSpec] = useState(row.spec)
  const [color, setColor] = useState(row.color ?? '')
  const [unit, setUnit] = useState(row.unit)
  const [batchNo, setBatchNo] = useState(row.batchNo)
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const wIn = Number(inputWeight) || 0
  const wOut = Number(outputWeight) || 0
  const feeNum = Number(fee) || 0
  const remaining = row.weight - wIn
  const inputOk = wIn > 0 && wIn <= row.weight
  const movedCost = row.weight > 0 && wIn > 0 ? (row.cost * wIn) / row.weight : 0
  const newUnitCost = inputOk && wOut > 0 ? (movedCost + feeNum * wOut) / wOut : null
  const weightDiff = wIn - wOut
  const identityChanged =
    spec !== row.spec ||
    color !== (row.color ?? '') ||
    unit !== row.unit ||
    batchNo !== row.batchNo

  function onInputWeightChange(value: string) {
    setInputWeight(value)
    if (!outputTouched) setOutputWeight(value)
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
        inputPackages: inputPackages === '' ? null : Number(inputPackages),
        spec,
        color,
        unit,
        batchNo,
        outputWeight: Number(outputWeight),
        outputPackages: outputPackages === '' ? null : Number(outputPackages),
        note: note || null,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      onCompleted({
        orderNo: data.orderNo,
        items: [
          {
            yarnName: data.yarnName,
            spec: data.spec,
            color: data.color,
            unit: data.unit,
            batchNo: data.batchNo,
            lotNo: data.lotNo,
            scanCode: data.scanCode,
            weight: data.outputWeight,
            packages: data.outputPackages ?? null,
          },
        ],
      })
      router.refresh()
      return
    }
    const data = await res.json().catch(() => ({}))
    setMessage(data.error || '完工登记失败')
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
      <div className="mx-auto my-4 w-full max-w-2xl space-y-3 rounded border bg-white p-5 shadow-lg sm:my-8">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold">登记加工完工 · 生成新批次</h3>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded p-1 text-2xl leading-none text-gray-500 hover:bg-gray-100">×</button>
        </div>
        <p className="text-sm text-gray-600">
          {row.warehouseName} · {row.yarnName} {row.spec} {row.color ?? ''} {row.unit} ·
          {row.lotNo ?? '历史汇总批次'} · 当前 {row.weight.toFixed(2)} kg / {row.packages ?? '-'} 件
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">
            本次投入重量 (kg)
            <Input type="number" step="0.01" min="0" value={inputWeight} onChange={(event) => onInputWeightChange(event.target.value)} />
          </label>
          <label className="text-sm">
            本次投入件数
            <Input type="number" step="1" min="0" value={inputPackages} onChange={(event) => setInputPackages(event.target.value)} placeholder="部分加工时必填" />
          </label>
          <label className="text-sm">
            加工费 (元/kg 成品)
            <Input type="number" step="0.01" min="0" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="必填" />
          </label>
          <label className="text-sm">
            加工后实际重量 (kg)
            <Input
              type="number"
              step="0.01"
              min="0"
              value={outputWeight}
              onChange={(event) => {
                setOutputWeight(event.target.value)
                setOutputTouched(true)
              }}
            />
          </label>
          <label className="text-sm">
            加工后件数
            <Input type="number" step="1" min="0" value={outputPackages} onChange={(event) => setOutputPackages(event.target.value)} />
          </label>
          <label className="text-sm">
            成品批次/缸号
            <Input value={batchNo} onChange={(event) => setBatchNo(event.target.value)} />
          </label>
          <label className="text-sm">
            成品支数
            <Input value={spec} onChange={(event) => setSpec(event.target.value)} />
          </label>
          <label className="text-sm">
            成品色号
            <Input value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
          <label className="text-sm">
            单位
            <Input value={unit} onChange={(event) => setUnit(event.target.value)} />
          </label>
          <label className="text-sm sm:col-span-2 lg:col-span-3">
            备注
            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如工艺、色差、异常情况" />
          </label>
        </div>
        <div className="rounded bg-slate-50 p-3 text-sm text-gray-700">
          <p>
            损耗：{weightDiff.toFixed(2)} kg
            {weightDiff < 0 ? '（成品增重）' : ''}；原批次剩余：{Math.max(0, remaining).toFixed(2)} kg。
          </p>
          <p>
            成品单位成本预估：{newUnitCost === null ? '-' : `¥${newUnitCost.toFixed(2)} / kg`}。
            加工费应付：¥{(feeNum * wOut).toFixed(2)}，可先欠款，付款在“结算”中另记。
          </p>
          {identityChanged && <p className="text-amber-700">成品信息有变化，将按上述信息建立全新的成品批次。</p>}
        </div>
        {!inputOk && wIn > 0 && <p className="text-sm text-red-600">投入重量不能超过当前库存（{row.weight.toFixed(2)} kg）</p>}
        {message && <p className="text-sm text-red-600">{message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose} className="bg-gray-500 hover:bg-gray-600">取消</Button>
          <Button type="button" disabled={busy || !inputOk || wOut <= 0 || fee === ''} onClick={submit}>
            {busy ? '登记中…' : '确认完工并生成新批次'}
          </Button>
        </div>
      </div>
    </div>
  )
}
