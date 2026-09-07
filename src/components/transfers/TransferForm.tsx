'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChoiceField } from '@/components/ui/ChoiceField'
import { BusinessDateField } from '@/components/ui/BusinessDateField'
import { Notice } from '@/components/ui/Notice'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { formatNumber } from '@/lib/display'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ExpressionInput } from '@/components/ui/ExpressionInput'
import { Select } from '@/components/ui/Select'
import { resolveNumeric } from '@/lib/expression'
import { businessDateToday } from '@/lib/business-date'
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit'

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
  lotNo: string | null
  weight: string
  packages: number | null
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
  const { markDirty, markSaved, confirmDiscard } = useUnsavedChanges()
  const { submit, submitting } = useIdempotentSubmit()
  const [fromWarehouseId, setFromWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [toWarehouseId, setToWarehouseId] = useState(
    destinations[1]?.id ?? destinations[0]?.id ?? '',
  )
  const [rows, setRows] = useState<{ inventoryId: string; weight: string; packages: string }[]>([
    { inventoryId: '', weight: '', packages: '' },
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
      date: String(form.get('date') ?? businessDateToday()),
      fromWarehouseId,
      toWarehouseId,
      handlerName: String(form.get('handlerName')),
      note: String(form.get('note') ?? '') || null,
      freight: Number(form.get('freight') ?? 0),
      items: rows.map((r) => ({
        inventoryId: r.inventoryId,
        weight: resolveNumeric(r.weight) ?? Number(r.weight),
        packages: r.packages ? Number(r.packages) : null,
      })),
    }
    const res = await submit((idempotencyKey) =>
      fetch('/api/transfers', {
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
      setRows([{ inventoryId: '', weight: '', packages: '' }])
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setMessage(data.error || '保存失败')
    }
  }

  return (
    <form onSubmit={onSubmit} onChange={markDirty} className="space-y-5">
      <div className="form-section grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
<BusinessDateField onChange={markDirty} />
<ChoiceField label="来源" options={warehouses} value={fromWarehouseId} onChange={(value) => { if(value === fromWarehouseId) return; if(rows.some((row) => row.inventoryId) && !confirmDiscard()) return; markDirty(); setFromWarehouseId(value); setRows([{ inventoryId: "", weight: "", packages: "" }]) }} memoryKey={"transfer:from:" + defaultHandler} />
<ChoiceField label="目标" options={destinations.filter((row) => row.id !== fromWarehouseId)} value={toWarehouseId} onChange={(value) => { markDirty(); setToWarehouseId(value) }} memoryKey={"transfer:to:" + defaultHandler} />
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
          className="form-section grid gap-3 sm:grid-cols-2"
        >
          <Select
            value={row.inventoryId}
            onChange={(e) =>
              setRows((prev) =>
                prev.map((r, i) => {
                  if (i !== idx) return r
                  const source = available.find((candidate) => candidate.id === e.target.value)
                  return {
                    ...r,
                    inventoryId: e.target.value,
                    weight: source?.weight ?? '',
                    packages: source?.packages?.toString() ?? '',
                  }
                }),
              )
            }
            required
          >
            <option value="">选择库存</option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>
                {r.yarnName} {r.spec} {r.color ?? ''} {r.unit} · {r.lotNo ?? '历史批次'} · 批次{r.batchNo}（可用{' '}
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
          <Input
            type="number"
            step="1"
            min="0"
            value={row.packages}
            onChange={(event) =>
              setRows((current) =>
                current.map((candidate, rowIndex) =>
                  rowIndex === idx ? { ...candidate, packages: event.target.value } : candidate,
                ),
              )
            }
            placeholder="件数（部分调拨时填写）"
          />
          <Button
            type="button"
            disabled={rows.length === 1}
            onClick={() => { markDirty(); setRows((prev) => prev.filter((_, i) => i !== idx)) }}
            variant="secondary"
          >
            删除
          </Button>
        </div>
      ))}
      <Button
        type="button"
        onClick={() => setRows((prev) => [...prev, { inventoryId: '', weight: '', packages: '' }])}
      >
        加一行
      </Button>
      <div className="form-footer"><p className="font-semibold">调拨合计 {formatNumber(rows.reduce((sum, row) => sum + (resolveNumeric(row.weight) ?? 0), 0))} kg</p><p className="text-sm">{warehouses.find((row) => row.id === fromWarehouseId)?.name} → {destinations.find((row) => row.id === toWarehouseId)?.name}</p>
        {savedOrderNo && (
          <p className="text-sm text-green-600">保存成功，单号：{savedOrderNo}</p>
        )}
        <Notice>{message}</Notice>
        <div className="flex justify-end">
          <Button type="submit" disabled={submitting || fromWarehouseId === toWarehouseId} className="w-full sm:w-auto sm:min-w-40">
            {submitting ? '保存中…' : '保存调拨单'}
          </Button>
        </div>
      </div>
    </form>
  )
}
