'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ExpressionInput } from '@/components/ui/ExpressionInput'
import { Select } from '@/components/ui/Select'
import { resolveNumeric } from '@/lib/expression'

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
  weight: string
  cost: string
  freight: string
  processingFeeSettled: boolean
}

interface Row {
  inventoryId: string
  weight: string
  spec: string
  color: string
  unit: string
  batchNo: string
  outputWeight: string
  packages: string
}

const emptyRow = (): Row => ({
  inventoryId: '',
  weight: '',
  spec: '',
  color: '',
  unit: 'kg',
  batchNo: '',
  outputWeight: '',
  packages: '',
})

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
  const [factoryId, setFactoryId] = useState(factories[0]?.id ?? '')
  const [rows, setRows] = useState<Row[]>([emptyRow()])
  const [expectedSellPrice, setExpectedSellPrice] = useState('')
  const [message, setMessage] = useState('')
  const [savedOrderNo, setSavedOrderNo] = useState('')

  const available = factoryRows.filter(
    (r) => r.warehouseId === factoryId && r.processingFeeSettled,
  )

  function updateRow(idx: number, key: keyof Row, value: string) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r
        const next = { ...r, [key]: value }
        if (key === 'inventoryId') {
          const src = factoryRows.find((f) => f.id === value)
          if (src) next.weight = src.weight
        }
        return next
      }),
    )
  }

  function preview(idx: number): string | null {
    const r = rows[idx]
    const src = factoryRows.find((f) => f.id === r.inventoryId)
    const w = resolveNumeric(r.weight)
    const out = resolveNumeric(r.outputWeight)
    if (!src || w === null || out === null || w <= 0 || out <= 0) return null
    const movedCost = (Number(src.cost) * w) / Number(src.weight)
    const unitCost = movedCost / out
    return unitCost.toFixed(2)
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage('')
    const form = new FormData(e.currentTarget)
    const body = {
      date: String(form.get('date') ?? new Date().toISOString().slice(0, 10)),
      factoryId,
      warehouseId: String(form.get('warehouseId')),
      handlerName: String(form.get('handlerName')),
      note: String(form.get('note') ?? '') || null,
      freight: Number(form.get('freight') ?? 0),
      expectedSellPricePerKg: expectedSellPrice ? Number(expectedSellPrice) : null,
      items: rows.map((r) => ({
        inventoryId: r.inventoryId,
        weight: resolveNumeric(r.weight) ?? Number(r.weight),
        spec: r.spec,
        color: r.color,
        unit: r.unit,
        batchNo: r.batchNo,
        outputWeight: resolveNumeric(r.outputWeight) ?? Number(r.outputWeight),
        packages: r.packages ? Number(r.packages) : null,
      })),
    }
    const res = await fetch('/api/processing-returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const data = await res.json()
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
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          日期
          <Input
            type="date"
            name="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </label>
        <label className="text-sm">
          来源加工厂
          <Select
            value={factoryId}
            onChange={(e) => {
              setFactoryId(e.target.value)
              setRows([emptyRow()])
            }}
            required
          >
            {factories.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}（加工厂）
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          目标仓库
          <Select name="warehouseId" required>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          经办人
          <Select name="handlerName" defaultValue={defaultHandler ?? 'admin'} required>
            <option value="admin">admin</option>
            <option value="clerk">clerk</option>
          </Select>
        </label>
        <label className="text-sm">
          回程运费 (元)
          <Input type="number" step="0.01" min="0" name="freight" defaultValue="0" />
        </label>
        <label className="text-sm">
          预计卖价 (元/kg，选填)
          <Input
            type="number"
            step="0.01"
            min="0"
            value={expectedSellPrice}
            onChange={(e) => setExpectedSellPrice(e.target.value)}
            placeholder="用于预计毛利"
          />
        </label>
        <label className="text-sm">
          备注
          <Input name="note" placeholder="选填" />
        </label>
      </div>

      {rows.map((row, idx) => (
        <div
          key={idx}
          className="grid gap-3 rounded border bg-white p-3 sm:grid-cols-2 lg:grid-cols-8"
        >
          <Select
            value={row.inventoryId}
            onChange={(e) => updateRow(idx, 'inventoryId', e.target.value)}
            required
          >
            <option value="">选择加工厂库存</option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>
                {r.yarnName} {r.spec} {r.color} {r.unit} 批次{r.batchNo}（
                {Number(r.weight).toFixed(2)} kg）
              </option>
            ))}
          </Select>
          <ExpressionInput
            value={row.weight}
            onChange={(v) => updateRow(idx, 'weight', v)}
            placeholder="送厂重量 kg*"
            required
          />
          <Input
            value={row.spec}
            onChange={(e) => updateRow(idx, 'spec', e.target.value)}
            placeholder="新支数（如 20支）*"
            required
          />
          <Input
            value={row.color}
            onChange={(e) => updateRow(idx, 'color', e.target.value)}
            placeholder="新色号（如 紫色）*"
            required
          />
          <Input
            value={row.unit}
            onChange={(e) => updateRow(idx, 'unit', e.target.value)}
            placeholder="单位"
            required
          />
          <Input
            value={row.batchNo}
            onChange={(e) => updateRow(idx, 'batchNo', e.target.value)}
            placeholder="新批次/缸号*"
            required
          />
          <ExpressionInput
            value={row.outputWeight}
            onChange={(v) => updateRow(idx, 'outputWeight', v)}
            placeholder="收回重量 kg*"
            required
          />
          <Button
            type="button"
            onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
            className="bg-red-600 hover:bg-red-700"
          >
            删除
          </Button>
          {preview(idx) && (
            <p className="text-xs text-gray-600 sm:col-span-2 lg:col-span-8">
              该行预计新单位成本：¥{preview(idx)} / kg
            </p>
          )}
        </div>
      ))}
      <Button type="button" onClick={() => setRows((prev) => [...prev, emptyRow()])}>
        加一行
      </Button>
      {savedOrderNo && <p className="text-sm text-green-600">保存成功，单号：{savedOrderNo}</p>}
      {message && <p className="text-sm text-red-600">{message}</p>}
      <Button type="submit">保存加工收回单</Button>
    </form>
  )
}
