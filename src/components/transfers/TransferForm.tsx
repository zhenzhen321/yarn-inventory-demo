'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ExpressionInput } from '@/components/ui/ExpressionInput'
import { Select } from '@/components/ui/Select'
import { resolveNumeric } from '@/lib/expression'

interface Option {
  id: string
  name: string
  type: string
}

interface InventoryRow {
  id: string
  warehouseId: string
  yarnName: string
  spec: string
  color: string | null
  unit: string
  batchNo: string
  weight: string
  processingFeeSettled: boolean
}

export function TransferForm({
  warehouses,
  destinations,
  inventoryRows,
  defaultHandler,
}: {
  warehouses: Option[]
  destinations: Option[]
  inventoryRows: InventoryRow[]
  defaultHandler?: string
}) {
  const router = useRouter()
  const [fromWarehouseId, setFromWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [toWarehouseId, setToWarehouseId] = useState(
    destinations[1]?.id ?? destinations[0]?.id ?? '',
  )
  const [rows, setRows] = useState<{ inventoryId: string; weight: string }[]>([
    { inventoryId: '', weight: '' },
  ])
  const [message, setMessage] = useState('')
  const [savedOrderNo, setSavedOrderNo] = useState('')

  const fromType = warehouses.find((w) => w.id === fromWarehouseId)?.type ?? 'WAREHOUSE'
  const available = useMemo(
    () =>
      inventoryRows.filter(
        (r) =>
          r.warehouseId === fromWarehouseId &&
          (fromType !== 'FACTORY' || r.processingFeeSettled),
      ),
    [fromWarehouseId, fromType, inventoryRows],
  )

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage('')
    const form = new FormData(e.currentTarget)
    const body = {
      date: String(form.get('date') ?? new Date().toISOString().slice(0, 10)),
      fromWarehouseId,
      toWarehouseId,
      handlerName: String(form.get('handlerName')),
      note: String(form.get('note') ?? '') || null,
      freight: Number(form.get('freight') ?? 0),
      items: rows.map((r) => ({
        inventoryId: r.inventoryId,
        weight: resolveNumeric(r.weight) ?? Number(r.weight),
      })),
    }
    const res = await fetch('/api/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const data = await res.json()
      setSavedOrderNo(data.orderNo)
      setRows([{ inventoryId: '', weight: '' }])
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
          来源
          <Select
            value={fromWarehouseId}
            onChange={(e) => {
              setFromWarehouseId(e.target.value)
              setRows([{ inventoryId: '', weight: '' }])
            }}
            required
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.type === 'FACTORY' ? '（加工厂）' : ''}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          目标
          <Select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} required>
            {destinations.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.type === 'FACTORY' ? '（加工厂）' : ''}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          经办人
          <Select name="handlerName" defaultValue={defaultHandler ?? '刚'} required>
            <option value="刚">刚</option>
            <option value="萍">萍</option>
          </Select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          运费 (元)
          <Input type="number" step="0.01" min="0" name="freight" defaultValue="0" />
        </label>
        <label className="text-sm">
          备注
          <Input name="note" placeholder="选填" />
        </label>
      </div>

      {rows.map((row, idx) => (
        <div
          key={idx}
          className="grid gap-3 rounded border bg-white p-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Select
            value={row.inventoryId}
            onChange={(e) =>
              setRows((prev) =>
                prev.map((r, i) => (i === idx ? { ...r, inventoryId: e.target.value } : r)),
              )
            }
            required
          >
            <option value="">选择库存</option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>
                {r.yarnName} {r.spec} {r.color ?? ''} {r.unit} 批次{r.batchNo}（可用{' '}
                {Number(r.weight).toFixed(2)} kg）
              </option>
            ))}
          </Select>
          <ExpressionInput
            value={row.weight}
            onChange={(v) =>
              setRows((prev) =>
                prev.map((r, i) => (i === idx ? { ...r, weight: v } : r)),
              )
            }
            placeholder="重量 kg*"
            required
          />
          <Button
            type="button"
            onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
            className="bg-red-600 hover:bg-red-700"
          >
            删除
          </Button>
        </div>
      ))}
      <Button
        type="button"
        onClick={() => setRows((prev) => [...prev, { inventoryId: '', weight: '' }])}
      >
        加一行
      </Button>
      {savedOrderNo && <p className="text-sm text-green-600">保存成功，单号：{savedOrderNo}</p>}
      {message && <p className="text-sm text-red-600">{message}</p>}
      <Button type="submit">保存调拨单</Button>
    </form>
  )
}
