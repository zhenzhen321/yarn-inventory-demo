'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@/components/ui/Dialog'
import { Notice } from '@/components/ui/Notice'
import { BusinessDateField } from '@/components/ui/BusinessDateField'
import { QuickChoices } from '@/components/ui/QuickChoices'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { formatNumber } from '@/lib/display'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Table } from '@/components/ui/Table'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import { businessDateToday } from '@/lib/business-date'
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit'
import {
  LabelPrintButton,
  type LabelPrintOrder,
} from '@/components/labels/LabelPrintButton'

export interface FactoryInventoryRow {
  id: string
  warehouseId: string
  warehouseName: string
  yarnId: string
  yarnName: string
  spec: string
  color: string | null
  unit: string
  batchNo: string
  lotNo: string | null
  weight: number
  packages: number | null
  cost: number
  freight: number
  feePerKg: number | null
  settled: boolean
}

interface InputDraft {
  inventoryId: string
  weight: string
  packages: string
}

interface OutputDraft {
  yarnId: string
  spec: string
  color: string
  unit: string
  batchNo: string
  weight: string
  packages: string
}

function inputFromRow(row: FactoryInventoryRow): InputDraft {
  return {
    inventoryId: row.id,
    weight: String(row.weight),
    packages: row.packages?.toString() ?? '',
  }
}

function outputFromRow(row: FactoryInventoryRow): OutputDraft {
  return {
    yarnId: row.yarnId,
    spec: row.spec,
    color: row.color ?? '',
    unit: row.unit,
    batchNo: row.batchNo,
    weight: String(row.weight),
    packages: row.packages?.toString() ?? '',
  }
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
            加工完工已生成 {completedLabel.items.length} 个成品批次，请分别贴上新标签。
          </p>
          <LabelPrintButton order={completedLabel} label="打印全部成品标签" />
        </div>
      )}
      {open && (
        <>
          <p className="text-sm text-gray-600">
            一张完工单可合并多个原料批次，也可拆成多个成品批次。系统按成品重量分摊投入货值、
            运费、加工费和其他费用，最后一批自动承接分币尾差。
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
                    {!row.settled && row.weight > 0 && (
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
          initialRow={active}
          allRows={rows}
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
  initialRow,
  allRows,
  onClose,
  onCompleted,
}: {
  initialRow: FactoryInventoryRow
  allRows: FactoryInventoryRow[]
  onClose: () => void
  onCompleted: (labelOrder: LabelPrintOrder) => void
}) {
  const router = useRouter()
  const { submit, submitting } = useIdempotentSubmit()
  const available = useMemo(
    () =>
      allRows.filter(
        (row) =>
          row.warehouseId === initialRow.warehouseId &&
          !row.settled &&
          row.weight > 0,
      ),
    [allRows, initialRow.warehouseId],
  )
  const yarnOptions = useMemo(
    () =>
      Array.from(
        new Map(available.map((row) => [row.yarnId, { id: row.yarnId, name: row.yarnName }])).values(),
      ),
    [available],
  )
  const [date, setDate] = useState(businessDateToday())
  const [fee, setFee] = useState('')
  const [additionalFreight, setAdditionalFreight] = useState('0')
  const [otherCost, setOtherCost] = useState('0')
  const [inputs, setInputs] = useState<InputDraft[]>([inputFromRow(initialRow)])
  const [outputs, setOutputs] = useState<OutputDraft[]>([outputFromRow(initialRow)])
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')

  const inputTotals = inputs.reduce(
    (totals, input) => {
      const source = available.find((row) => row.id === input.inventoryId)
      const weight = Number(input.weight) || 0
      if (!source || weight <= 0 || weight > source.weight) return totals
      return {
        weight: totals.weight + weight,
        cost: totals.cost + source.cost * weight / source.weight,
        freight: totals.freight + source.freight * weight / source.weight,
      }
    },
    { weight: 0, cost: 0, freight: 0 },
  )
  const outputWeight = outputs.reduce((total, output) => total + (Number(output.weight) || 0), 0)
  const feeTotal = (Number(fee) || 0) * outputWeight
  const allocatedTotal =
    inputTotals.cost +
    inputTotals.freight +
    (Number(additionalFreight) || 0) +
    feeTotal +
    (Number(otherCost) || 0)
  const valid =
    fee !== '' &&
    inputs.length > 0 &&
    outputs.length > 0 &&
    inputs.every((input) => {
      const source = available.find((row) => row.id === input.inventoryId)
      const weight = Number(input.weight)
      return Boolean(source && weight > 0 && weight <= source.weight)
    }) &&
    new Set(inputs.map((input) => input.inventoryId)).size === inputs.length &&
    outputs.every(
      (output) =>
        output.yarnId &&
        output.spec.trim() &&
        output.color.trim() &&
        output.unit.trim() &&
        output.batchNo.trim() &&
        Number(output.weight) > 0,
    )

  function changeInput(index: number, key: keyof InputDraft, value: string) {
    setInputs((current) =>
      current.map((input, rowIndex) => {
        if (rowIndex !== index) return input
        if (key !== 'inventoryId') return { ...input, [key]: value }
        const source = available.find((row) => row.id === value)
        return source ? inputFromRow(source) : { inventoryId: '', weight: '', packages: '' }
      }),
    )
  }

  function changeOutput(index: number, key: keyof OutputDraft, value: string) {
    setOutputs((current) =>
      current.map((output, rowIndex) =>
        rowIndex === index ? { ...output, [key]: value } : output,
      ),
    )
  }

  async function complete() {
    setMessage('')
    try {
      const response = await submit((idempotencyKey) =>
        fetch('/api/processing-jobs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            date,
            factoryId: initialRow.warehouseId,
            feePerKg: Number(fee),
            additionalFreight: Number(additionalFreight) || 0,
            otherCost: Number(otherCost) || 0,
            note: note || null,
            inputs: inputs.map((input) => ({
              inventoryId: input.inventoryId,
              weight: Number(input.weight),
              packages: input.packages === '' ? null : Number(input.packages),
            })),
            outputs: outputs.map((output) => ({
              yarnId: output.yarnId,
              spec: output.spec,
              color: output.color,
              unit: output.unit,
              batchNo: output.batchNo,
              weight: Number(output.weight),
              packages: output.packages === '' ? null : Number(output.packages),
            })),
          }),
        }),
      )
      if (!response) return
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(data.error || '完工登记失败')
        return
      }
      markSaved()
      onCompleted({ orderNo: data.orderNo, items: data.outputs })
      router.refresh()
    } catch {
      setMessage('网络中断，原请求标识已保留；请再次点击以安全重试')
    }
  }


  const [step, setStep] = useState(0)
  const [discard, setDiscard] = useState(false)
  const { markDirty, markSaved } = useUnsavedChanges()
  const steps = ['选择投入', '填写产出', '核对费用']
  const inputValid = inputs.length > 0 && new Set(inputs.map((item) => item.inventoryId)).size === inputs.length &&
    inputs.every((item) => {
      const source = available.find((row) => row.id === item.inventoryId)
      return source && Number(item.weight) > 0 && Number(item.weight) <= source.weight &&
        (item.packages === '' || (Number.isInteger(Number(item.packages)) && Number(item.packages) >= 0 &&
          (source.packages === null || Number(item.packages) <= source.packages)))
    })
  const outputValid = outputs.length > 0 && outputs.every((item) => item.yarnId && item.spec.trim() &&
    item.color.trim() && item.unit.trim() && item.batchNo.trim() && Number(item.weight) > 0 &&
    (item.packages === '' || (Number.isInteger(Number(item.packages)) && Number(item.packages) >= 0)))
  const feesValid = fee !== '' && [fee, additionalFreight, otherCost].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)
  const loss = inputTotals.weight - outputWeight
  const lossRate = inputTotals.weight > 0 ? loss / inputTotals.weight * 100 : 0
  function close() {
    if (submitting) return
    setDiscard(true)
  }

  return <>
    <Dialog wide scrollKey={step} title="登记加工完工 · 多投入多产出" busy={submitting} onClose={close} footer={<>
      <Button type="button" variant="secondary" onClick={close} disabled={submitting}>取消</Button>
      {step > 0 && <Button type="button" variant="secondary" disabled={submitting} onClick={() => { setMessage(''); setStep(step - 1) }}>上一步</Button>}
      {step < 2
        ? <Button type="button" disabled={step === 0 ? !inputValid : !outputValid} onClick={() => { setMessage(''); setStep(step + 1) }}>下一步：{steps[step + 1]}</Button>
        : <Button type="button" disabled={submitting || !valid || !inputValid || !outputValid || !feesValid || !date}
            onClick={async () => { await complete() }}>{submitting ? '登记中…' : '确认完工并生成成品批次'}</Button>}
    </>}>
      <p className="font-medium text-slate-600">{initialRow.warehouseName}</p>
      <ol className="grid grid-cols-3 gap-2" aria-label="加工完工步骤">
        {steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}
          className={`rounded-xl border px-2 py-3 text-center text-sm font-semibold ${step === index ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-500'}`}>{index + 1}. {label}</li>)}
      </ol>
      <fieldset disabled={submitting} className="min-w-0 space-y-4" onChange={markDirty}>
        {step === 0 && <section className="space-y-4">
          <div><h3 className="text-lg font-bold">这次用了哪些原料？</h3><p className="mt-1 text-sm text-slate-600">只选本次实际投入的批次，部分加工时修改重量。</p></div>
          {inputs.map((input, index) => {
            const source = available.find((row) => row.id === input.inventoryId)
            return <div key={index} className="form-section space-y-3">
              <div className="flex items-center justify-between"><h4 className="font-semibold">投入 {index + 1}</h4>
                <Button type="button" variant="secondary" disabled={inputs.length === 1} onClick={() => { markDirty(); setInputs((current) => current.filter((_, rowIndex) => rowIndex !== index)) }}>移除投入</Button></div>
              <label className="field-label">原料批次<Select aria-label="原料批次" value={input.inventoryId} onChange={(event) => changeInput(index, 'inventoryId', event.target.value)}>
                <option value="">选择待加工批次</option>
                {available.map((row) => <option key={row.id} value={row.id} disabled={inputs.some((candidate, rowIndex) => rowIndex !== index && candidate.inventoryId === row.id)}>
                  {row.yarnName} {row.spec}/{row.color} · {row.batchNo} · {formatNumber(row.weight)}kg
                </option>)}
              </Select></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="field-label">本次投入重量 (kg)<Input type="number" step="0.01" min="0.01" max={source?.weight} value={input.weight} onChange={(event) => changeInput(index, 'weight', event.target.value)} /></label>
                <label className="field-label">本次投入件数（选填）<Input type="number" step="1" min="0" value={input.packages} onChange={(event) => changeInput(index, 'packages', event.target.value)} /></label>
              </div>
              {source && <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-slate-600">可用 {formatNumber(source.weight)} kg / {source.packages ?? '—'} 件</span>
                <Button type="button" variant="secondary" onClick={() => { markDirty(); setInputs((current) => current.map((item, rowIndex) => rowIndex === index ? inputFromRow(source) : item)) }}>全部投入</Button></div>}
              {source && Number(input.weight) > source.weight && <Notice>投入重量不能超过库存 {formatNumber(source.weight)} kg。</Notice>}
            </div>
          })}
          <Button type="button" variant="secondary" disabled={inputs.length >= available.length}
            onClick={() => { markDirty(); setInputs((current) => [...current, { inventoryId: '', weight: '', packages: '' }]) }}>＋ 添加投入批次</Button>
          {!inputValid && <Notice tone="info">请为每条投入选择不同批次，并填写不超过库存的重量和件数。</Notice>}
        </section>}
        {step === 1 && <section className="space-y-4">
          <div><h3 className="text-lg font-bold">这次产出了哪些成品？</h3><p className="mt-1 text-sm text-slate-600">填写成品实际重量；相近成品可以复制属性，再修改色号和批号。</p></div>
          {outputs.map((output, index) => <div key={index} className="form-section space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">成品 {index + 1}</h4><div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => { markDirty(); setOutputs((current) => [...current, { ...output, batchNo: '', weight: '', packages: '' }]) }}>复制产出属性</Button>
              <Button type="button" variant="secondary" disabled={outputs.length === 1} onClick={() => { markDirty(); setOutputs((current) => current.filter((_, rowIndex) => rowIndex !== index)) }}>移除产出</Button>
            </div></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="field-label">成品品名<Select aria-label="成品品名" value={output.yarnId} onChange={(event) => changeOutput(index, 'yarnId', event.target.value)}>{yarnOptions.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></label>
              <div className="space-y-2"><label className="field-label">成品支数<Input value={output.spec} onChange={(event) => changeOutput(index, 'spec', event.target.value)} /></label>
                <QuickChoices label="原料支数" values={available.filter((row) => row.yarnId === output.yarnId).map((row) => row.spec)} value={output.spec} onChange={(value) => { markDirty(); changeOutput(index, 'spec', value) }} /></div>
              <div className="space-y-2"><label className="field-label">成品色号<Input value={output.color} onChange={(event) => changeOutput(index, 'color', event.target.value)} /></label>
                <QuickChoices label="已有色号" values={allRows.filter((row) => row.yarnId === output.yarnId).map((row) => row.color ?? '')} value={output.color} onChange={(value) => { markDirty(); changeOutput(index, 'color', value) }} /></div>
              <label className="field-label">单位<Input value={output.unit} onChange={(event) => changeOutput(index, 'unit', event.target.value)} /></label>
              <div className="space-y-2"><label className="field-label">成品批次 / 缸号<Input value={output.batchNo} onChange={(event) => changeOutput(index, 'batchNo', event.target.value)} /></label>
                <Button type="button" variant="secondary" onClick={() => { markDirty(); changeOutput(index, 'batchNo', 'CP-' + date.replaceAll('-', '') + '-' + (index + 1)) }}>使用建议批号</Button></div>
              <label className="field-label">成品重量 (kg)<Input type="number" step="0.01" min="0.01" value={output.weight} onChange={(event) => changeOutput(index, 'weight', event.target.value)} /></label>
              <label className="field-label">成品件数（选填）<Input type="number" step="1" min="0" value={output.packages} onChange={(event) => changeOutput(index, 'packages', event.target.value)} /></label>
            </div>
          </div>)}
          {!outputValid && <Notice tone="info">请填写每个成品的支数、色号、批号和实际重量。</Notice>}
        </section>}
        {step === 2 && <section className="space-y-4">
          <h3 className="text-lg font-bold">最后核对日期和费用</h3>
          <div className="form-section grid gap-4 sm:grid-cols-2">
            <BusinessDateField label="完工业务日期" value={date} onChange={(value) => { markDirty(); setDate(value) }} />
            <label className="field-label">加工费 (元/kg 成品)<Input type="number" step="0.01" min="0" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="填写本次单价，免费填 0" /></label>
            <label className="field-label">本次附加运费 (元)<Input type="number" step="0.01" min="0" value={additionalFreight} onChange={(event) => setAdditionalFreight(event.target.value)} /></label>
            <label className="field-label">其他费用 (元)<Input type="number" step="0.01" min="0" value={otherCost} onChange={(event) => setOtherCost(event.target.value)} /></label>
            <label className="field-label sm:col-span-2">备注（选填）<Input value={note} onChange={(event) => setNote(event.target.value)} /></label>
          </div>
          <Table headers={['成品', '色号 / 批号', '重量 (kg)', '预计总成本 (元)', '预计单价 (元/kg)']}>
            {outputs.map((output, index) => <tr key={index}><td>{yarnOptions.find((row) => row.id === output.yarnId)?.name} {output.spec}</td><td>{output.color} / {output.batchNo}</td><td>{output.weight}</td>
              <td>{outputWeight > 0 ? allocatedTotal * Number(output.weight) / outputWeight : 0}</td><td>{outputWeight > 0 ? allocatedTotal / outputWeight : 0}</td></tr>)}
          </Table>
          <p className="text-sm text-slate-600">以上为费用预览。保存时按成品实际重量分摊到分，最后一个成品补齐尾差。</p>
          {!feesValid && <Notice tone="info">请填写加工单价，费用不能为负数。</Notice>}
        </section>}
      </fieldset>
      <div className="rounded-xl bg-slate-100 p-4">
        <p className="font-semibold">投入 {formatNumber(inputTotals.weight)} kg → 产出 {formatNumber(outputWeight)} kg</p>
        <p className="mt-1 text-sm">{loss >= 0 ? '损耗' : '增重'} {formatNumber(Math.abs(loss))} kg（{formatNumber(Math.abs(lossRate))}%）</p>
        {step === 2 && <p className="mt-2 font-semibold">预计总成本 ¥{formatNumber(allocatedTotal)} · 加工费 ¥{formatNumber(feeTotal)}</p>}
      </div>
      {(loss < 0 || lossRate > 10) && <Notice tone="info">产出与投入相差较大，请核对实际称重；若符合实际加工情况，可继续登记。</Notice>}
      <Notice>{message}</Notice>
    </Dialog>
    {discard && <Dialog title="放弃这次完工填写？" onClose={() => setDiscard(false)} footer={<>
      <Button type="button" variant="secondary" autoFocus onClick={() => setDiscard(false)}>继续填写</Button>
      <Button type="button" variant="danger" onClick={() => { markSaved(); onClose() }}>放弃填写</Button>
    </>}><p>尚未登记的内容将被清除，原料库存不会因取消而变化。</p></Dialog>}
  </>
}
