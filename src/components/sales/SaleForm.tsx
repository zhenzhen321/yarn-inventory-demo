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
  warehouseName: string
  yarnName: string
  spec: string
  color: string | null
  unit: string
  batchNo: string
  weight: string
  processingFeeSettled: boolean
}

interface Row {
  inventoryId: string
  weight: string
  price: string
  packages: string
}

export function SaleForm({
  customers,
  warehouses,
  inventoryRows,
  defaultHandler,
}: {
  customers: Option[]
  warehouses: Option[]
  inventoryRows: InventoryRow[]
  defaultHandler?: string
}) {
  const router = useRouter()
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [rows, setRows] = useState<Row[]>([
    { inventoryId: '', weight: '', price: '', packages: '' },
  ])
  const [message, setMessage] = useState('')
  const [savedOrderNo, setSavedOrderNo] = useState('')

  const warehouseType = warehouses.find((w) => w.id === warehouseId)?.type ?? 'WAREHOUSE'
  const available = useMemo(
    () =>
      inventoryRows.filter(
        (r) =>
          r.warehouseId === warehouseId &&
          (warehouseType !== 'FACTORY' || r.processingFeeSettled),
      ),
    [warehouseId, warehouseType, inventoryRows],
  )
  const total = rows.reduce(
    (sum, r) => sum + (resolveNumeric(r.weight) ?? 0) * (Number(r.price) || 0),
    0,
  )

  function updateRow(idx: number, key: keyof Row, value: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)))
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage('')
    const form = new FormData(e.currentTarget)
    const body = {
      date: String(form.get('date') ?? new Date().toISOString().slice(0, 10)),
      customerId: String(form.get('customerId')),
      warehouseId,
      handlerName: String(form.get('handlerName')),
      note: String(form.get('note') ?? '') || null,
      freight: Number(form.get('freight') ?? 0),
      items: rows.map((r) => ({
        inventoryId: r.inventoryId,
        weight: resolveNumeric(r.weight) ?? Number(r.weight),
        price: Number(r.price),
        packages: r.packages ? Number(r.packages) : null,
      })),
    }
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const data = await res.json()
      setSavedOrderNo(data.orderNo)
      setRows([{ inventoryId: '', weight: '', price: '', packages: '' }])
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
          客户
          <Select name="customerId" required>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          仓库
          <Select
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value)
              setRows([{ inventoryId: '', weight: '', price: '', packages: '' }])
            }}
            required
          >
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
          className="grid gap-3 rounded border bg-white p-3 sm:grid-cols-2 lg:grid-cols-6"
        >
          <Select
            value={row.inventoryId}
            onChange={(e) => updateRow(idx, 'inventoryId', e.target.value)}
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
            onChange={(v) => updateRow(idx, 'weight', v)}
            placeholder="重量 kg*"
            required
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            value={row.price}
            onChange={(e) => updateRow(idx, 'price', e.target.value)}
            placeholder="单价 元/kg*"
            required
          />
          <Input
            type="number"
            step="1"
            min="0"
            value={row.packages}
            onChange={(e) => updateRow(idx, 'packages', e.target.value)}
            placeholder="包数（可选）"
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
        onClick={() =>
          setRows((prev) => [
            ...prev,
            { inventoryId: '', weight: '', price: '', packages: '' },
          ])
        }
      >
        加一行
      </Button>

      <div className="mt-8 space-y-3 border-t pt-6">
        <p className="text-sm">合计：¥{total.toFixed(2)}</p>
        {savedOrderNo && (
          <p className="text-sm text-green-600">保存成功，单号：{savedOrderNo}</p>
        )}
        {message && <p className="text-sm text-red-600">{message}</p>}
        <div className="flex justify-end">
          <Button type="submit" className="w-full sm:w-auto sm:min-w-40">
            保存出库单
          </Button>
        </div>
      </div>
    </form>
  )
}
