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
}

export function StocktakeForm({
  warehouses,
  inventoryRows,
  defaultHandler,
  zeroCountByWarehouse,
}: {
  warehouses: Option[]
  inventoryRows: InventoryRow[]
  defaultHandler?: string
  zeroCountByWarehouse: Record<string, number>
}) {
  const router = useRouter()
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [actual, setActual] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [savedOrderNo, setSavedOrderNo] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmingZero, setConfirmingZero] = useState(false)
  const [zeroBusy, setZeroBusy] = useState(false)
  const [zeroMessage, setZeroMessage] = useState('')

  const rows = useMemo(
    () => inventoryRows.filter((r) => r.warehouseId === warehouseId),
    [warehouseId, inventoryRows],
  )
  const zeroCount = zeroCountByWarehouse[warehouseId] ?? 0

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage('')
    setNotice('')
    const form = new FormData(e.currentTarget)
    const body = {
      date: String(form.get('date') ?? new Date().toISOString().slice(0, 10)),
      warehouseId,
      handlerName: String(form.get('handlerName')),
      note: String(form.get('note') ?? '') || null,
      items: rows.map((r) => ({
        inventoryId: r.id,
        actualWeight: resolveNumeric(actual[r.id] ?? r.weight) ?? Number(actual[r.id] ?? r.weight),
      })),
    }
    const res = await fetch('/api/stocktakes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const data = await res.json()
      setSavedOrderNo(data.orderNo)
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setMessage(data.error || '保存失败')
    }
  }

  async function archiveZero() {
    setZeroBusy(true)
    setZeroMessage('')
    const res = await fetch('/api/inventory/archive-zero', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warehouseId }),
    })
    if (res.ok) {
      const data = await res.json()
      setConfirmingZero(false)
      setNotice(`已盘掉 ${data.count} 条 0kg 库存`)
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setZeroMessage(data.error || '清理失败')
    }
    setZeroBusy(false)
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
          仓库
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
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
        <label className="text-sm">
          备注
          <Input name="note" placeholder="可选" />
        </label>
      </div>

      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left">
              <th className="px-3 py-2 font-medium text-gray-600">纱线</th>
              <th className="px-3 py-2 font-medium text-gray-600">批次</th>
              <th className="px-3 py-2 font-medium text-gray-600">账面重量 (kg)</th>
              <th className="px-3 py-2 font-medium text-gray-600">实盘重量 (kg)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  {r.yarnName} {r.spec} {r.color ?? ''} {r.unit}
                </td>
                <td className="px-3 py-2">{r.batchNo}</td>
                <td className="px-3 py-2">{Number(r.weight).toFixed(2)}</td>
                <td className="px-3 py-2">
                  <ExpressionInput
                    value={actual[r.id] ?? r.weight}
                    onChange={(v) => setActual((prev) => ({ ...prev, [r.id]: v }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">保存盘点单</Button>
        <Button
          type="button"
          className="bg-red-600 hover:bg-red-700"
          disabled={zeroCount === 0}
          onClick={() => setConfirmingZero(true)}
        >
          盘掉 0kg 库存{zeroCount > 0 ? ` (${zeroCount})` : ''}
        </Button>
      </div>
      {savedOrderNo && <p className="text-sm text-green-600">保存成功，单号：{savedOrderNo}</p>}
      {notice && <p className="text-sm text-green-600">{notice}</p>}
      {message && <p className="text-sm text-red-600">{message}</p>}

      {confirmingZero && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4"
          onClick={() => !zeroBusy && setConfirmingZero(false)}
        >
          <div
            className="mx-auto my-4 w-full max-w-lg space-y-3 rounded border bg-white p-5 shadow-lg sm:my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold">盘掉 0kg 库存</h3>
            <p className="text-sm text-gray-600">
              将把本仓库 {zeroCount} 条 0kg 库存记录从库存列表中盘掉（买卖、盘点历史保留），确认？
            </p>
            {zeroMessage && <p className="text-sm text-red-600">{zeroMessage}</p>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                className="bg-gray-500 hover:bg-gray-600"
                disabled={zeroBusy}
                onClick={() => setConfirmingZero(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-700"
                disabled={zeroBusy}
                onClick={archiveZero}
              >
                {zeroBusy ? '清理中…' : '确认盘掉'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </form>
  )
}
