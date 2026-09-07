'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Notice } from '@/components/ui/Notice'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ExpressionInput } from '@/components/ui/ExpressionInput'
import { Select } from '@/components/ui/Select'
import { resolveNumeric } from '@/lib/expression'
import { businessDateToday } from '@/lib/business-date'
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit'

interface WarehouseOption {
  id: string
  name: string
}

interface FactoryRow {
  id: string
  warehouseId: string
  yarnName: string
  spec: string
  color: string
  unit: string
  batchNo: string
  lotNo: string | null
  weight: string
  packages: number | null
  cost: string
  freight: string
  processingFeeSettled: boolean
}

interface Row {
  inventoryId: string
  weight: string
  packages: string
}

const emptyRow = (): Row => ({ inventoryId: '', weight: '', packages: '' })

export function ProcessingReturnForm({
  factories,
  warehouses,
  factoryRows,
  defaultHandler,
}: {
  factories: WarehouseOption[]
  warehouses: WarehouseOption[]
  factoryRows: FactoryRow[]
  defaultHandler?: string
}) {
  const router = useRouter()
  const { markDirty, markSaved } = useUnsavedChanges()
  const { submit, submitting } = useIdempotentSubmit()
  const [factoryId, setFactoryId] = useState(factories[0]?.id ?? '')
  const [rows, setRows] = useState<Row[]>([emptyRow()])
  const [expectedSellPrice, setExpectedSellPrice] = useState('')
  const [message, setMessage] = useState('')
  const [savedOrderNo, setSavedOrderNo] = useState('')

  const available = factoryRows.filter(
    (row) => row.warehouseId === factoryId && row.processingFeeSettled,
  )

  function updateRow(index: number, key: keyof Row, value: string) {
    setRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) return row
        if (key !== 'inventoryId') return { ...row, [key]: value }
        const source = available.find((candidate) => candidate.id === value)
        return {
          inventoryId: value,
          weight: source?.weight ?? '',
          packages: source?.packages?.toString() ?? '',
        }
      }),
    )
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    const form = new FormData(event.currentTarget)
    const body = {
      date: String(form.get('date') ?? businessDateToday()),
      factoryId,
      warehouseId: String(form.get('warehouseId')),
      handlerName: String(form.get('handlerName')),
      note: String(form.get('note') ?? '') || null,
      processingFeePerKg: 0,
      freight: Number(form.get('freight') ?? 0),
      expectedSellPricePerKg: expectedSellPrice ? Number(expectedSellPrice) : null,
      items: rows.map((row) => {
        const source = factoryRows.find((candidate) => candidate.id === row.inventoryId)
        const weight = resolveNumeric(row.weight) ?? Number(row.weight)
        return {
          inventoryId: row.inventoryId,
          weight,
          spec: source?.spec ?? '',
          color: source?.color ?? '',
          unit: source?.unit ?? 'kg',
          batchNo: source?.batchNo ?? '',
          outputWeight: weight,
          packages: row.packages ? Number(row.packages) : null,
        }
      }),
    }
    const res = await submit((idempotencyKey) =>
      fetch('/api/processing-returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body),
      }),
    ).catch(() => { setMessage('网络中断，填写内容已保留，请再次点击保存重试。'); return null })
    if (!res) return
    if (res.ok) {
      const data = await res.json()
      markSaved()
      setSavedOrderNo(data.orderNo)
      setRows([emptyRow()])
      setExpectedSellPrice('')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setMessage(data.error || '保存失败')
    }
  }

  return (
    <form onSubmit={onSubmit} onChange={markDirty} className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
        这里仅把已经完工核算的成品批次从加工厂移回仓库，不再重新称重或重复计加工费。
        如果加工完直接卖出，请到“卖出出库”选择加工厂并扫描成品标签。
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          日期
          <Input type="date" name="date" required defaultValue={businessDateToday()} />
        </label>
        <label className="text-sm">
          来源加工厂
          <Select
            value={factoryId}
            onChange={(event) => {
              setFactoryId(event.target.value)
              setRows([emptyRow()])
            }}
            required
          >
            {factories.map((factory) => <option key={factory.id} value={factory.id}>{factory.name}（加工厂）</option>)}
          </Select>
        </label>
        <label className="text-sm">
          目标仓库
          <Select name="warehouseId" required>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </Select>
        </label>
        <label className="text-sm">
          经办人
          <Select name="handlerName" defaultValue={defaultHandler ?? '刚'} required>
            <option value="刚">刚</option>
            <option value="萍">萍</option>
          </Select>
        </label>
        <label className="text-sm">
          回程运费 (元)
          <Input type="number" step="0.01" min="0" name="freight" defaultValue="0" />
        </label>
        <label className="text-sm">
          预计卖价 (元/kg，选填)
          <Input type="number" step="0.01" min="0" value={expectedSellPrice} onChange={(event) => setExpectedSellPrice(event.target.value)} />
        </label>
        <label className="text-sm">
          备注
          <Input name="note" placeholder="选填" />
        </label>
      </div>

      {rows.map((row, index) => {
        const source = available.find((candidate) => candidate.id === row.inventoryId)
        const weight = resolveNumeric(row.weight) ?? 0
        const unitCost = source && weight > 0 ? Number(source.cost) / Number(source.weight) : null
        return (
          <div key={index} className="grid gap-3 rounded border bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select value={row.inventoryId} onChange={(event) => updateRow(index, 'inventoryId', event.target.value)} required>
              <option value="">选择已完工成品批次</option>
              {available.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.yarnName} {candidate.spec} {candidate.color} · {candidate.lotNo ?? '历史批次'} · {Number(candidate.weight).toFixed(2)} kg / {candidate.packages ?? '-'} 件
                </option>
              ))}
            </Select>
            <ExpressionInput value={row.weight} onChange={(value) => updateRow(index, 'weight', value)} placeholder="返仓重量 kg*" required />
            <Input type="number" step="1" min="0" value={row.packages} onChange={(event) => updateRow(index, 'packages', event.target.value)} placeholder="返仓件数" />
            <div className="self-center text-sm text-gray-600">
              {source ? `批次/缸号 ${source.batchNo}` : '选择后自动保持原批次'}
              {unitCost !== null ? ` · 成本 ¥${unitCost.toFixed(2)}/kg` : ''}
            </div>
            <Button type="button" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="bg-red-600 hover:bg-red-700">删除</Button>
          </div>
        )
      })}
      <Button type="button" onClick={() => setRows((current) => [...current, emptyRow()])}>加一行</Button>
      {savedOrderNo && <p className="text-sm text-green-600">保存成功，单号：{savedOrderNo}</p>}
      <Notice>{message}</Notice>
      <Button type="submit" disabled={submitting}>
        {submitting ? '保存中…' : '保存成品返仓单'}
      </Button>
    </form>
  )
}
