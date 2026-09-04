'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ExpressionInput } from '@/components/ui/ExpressionInput'
import { Select } from '@/components/ui/Select'
import { OrderTraceLink } from '@/components/orders/OrderTraceLink'
import { resolveNumeric } from '@/lib/expression'
import { getSaleInventoryChoices } from '@/lib/inventory-presentation'

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
  lotNo: string | null
  scanCode: string | null
  weight: string
  packages: number | null
  processingFeeSettled: boolean
}

interface Row {
  yarnName: string
  color: string
  inventoryId: string
  weight: string
  price: string
  packages: string
}

function emptyRow(): Row {
  return { yarnName: '', color: '', inventoryId: '', weight: '', price: '', packages: '' }
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
  const [rows, setRows] = useState<Row[]>([emptyRow()])
  const [message, setMessage] = useState('')
  const [savedOrderNo, setSavedOrderNo] = useState('')
  const [scanCode, setScanCode] = useState('')
  const [scanMessage, setScanMessage] = useState('')

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
  const choices = useMemo(
    () => getSaleInventoryChoices(available, warehouseId),
    [available, warehouseId],
  )
  const total = rows.reduce(
    (sum, r) => sum + (resolveNumeric(r.weight) ?? 0) * (Number(r.price) || 0),
    0,
  )

  function updateRow(idx: number, key: keyof Row, value: string) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r
        if (key === 'yarnName') {
          return { ...emptyRow(), yarnName: value, price: r.price }
        }
        if (key === 'color') {
          return { ...r, color: value, inventoryId: '', weight: '', packages: '' }
        }
        if (key !== 'inventoryId') return { ...r, [key]: value }
        const selected = available.find((candidate) => candidate.id === value)
        return {
          ...r,
          inventoryId: value,
          weight: selected?.weight ?? '',
          packages: selected?.packages?.toString() ?? '',
        }
      }),
    )
  }

  function addScannedLot() {
    const code = scanCode.trim()
    if (!code) return
    const matched = inventoryRows.find(
      (row) =>
        row.scanCode?.toUpperCase() === code.toUpperCase() ||
        row.lotNo?.toUpperCase() === code.toUpperCase(),
    )
    if (!matched) {
      setScanMessage('未找到该批次，请确认标签或改用手工选择')
      return
    }
    if (!available.some((row) => row.id === matched.id)) {
      setScanMessage(
        matched.warehouseId !== warehouseId
          ? `该批次当前在 ${matched.warehouseName}，不在所选仓库`
          : '该加工厂批次尚未完成加工核算，不能销售',
      )
      return
    }
    if (rows.some((row) => row.inventoryId === matched.id)) {
      setScanMessage('该批次已在本单中，无需重复扫描')
      setScanCode('')
      return
    }
    const nextRow: Row = {
      yarnName: matched.yarnName,
      color: matched.color ?? '未填色号',
      inventoryId: matched.id,
      weight: matched.weight,
      price: '',
      packages: matched.packages?.toString() ?? '',
    }
    setRows((current) => {
      const emptyIndex = current.findIndex(
        (row) =>
          !row.yarnName &&
          !row.color &&
          !row.inventoryId &&
          !row.weight &&
          !row.price &&
          !row.packages,
      )
      if (emptyIndex < 0) return [...current, nextRow]
      return current.map((row, index) => (index === emptyIndex ? nextRow : row))
    })
    setScanCode('')
    setScanMessage(
      `已加入 ${matched.yarnName} · ${matched.lotNo ?? matched.batchNo}，默认全部 ${Number(matched.weight).toFixed(2)} kg`,
    )
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
      setRows([emptyRow()])
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
              setRows([emptyRow()])
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

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <label className="block text-sm font-medium text-blue-950">
          扫码枪快速出库
          <div className="mt-1 flex gap-2">
            <Input
              autoFocus
              value={scanCode}
              onChange={(event) => setScanCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addScannedLot()
                }
              }}
              placeholder="扫描标签二维码后按回车"
              autoComplete="off"
            />
            <Button type="button" onClick={addScannedLot}>
              加入
            </Button>
          </div>
        </label>
        <p className="mt-1 text-xs text-blue-800">
          扫码默认卖出该批全部余量和件数；部分卖出时，直接修改下方重量和件数。
        </p>
        {scanMessage && <p className="mt-1 text-sm text-blue-900">{scanMessage}</p>}
      </div>

      {rows.map((row, idx) => (
        <div
          key={idx}
          className="grid gap-3 rounded border bg-white p-3 sm:grid-cols-2 xl:grid-cols-7"
        >
          <Select
            aria-label="选择品名"
            value={row.yarnName}
            onChange={(e) => updateRow(idx, 'yarnName', e.target.value)}
            required
          >
            <option value="">选择品名</option>
            {choices.yarnNames.map((yarnName) => (
              <option key={yarnName} value={yarnName}>
                {yarnName}
              </option>
            ))}
          </Select>
          <Select
            aria-label="选择色号"
            value={row.color}
            onChange={(e) => updateRow(idx, 'color', e.target.value)}
            disabled={!row.yarnName}
            required
          >
            <option value="">选择色号</option>
            {choices.colorsFor(row.yarnName).map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </Select>
          <Select
            aria-label="选择具体批次"
            value={row.inventoryId}
            onChange={(e) => updateRow(idx, 'inventoryId', e.target.value)}
            disabled={!row.yarnName || !row.color}
            required
          >
            <option value="">选择具体批次</option>
            {choices.rowsFor(row.yarnName, row.color).map((r) => (
              <option key={r.id} value={r.id}>
                {r.spec} {r.unit} · {r.lotNo ?? '历史批次'} · 批次{r.batchNo}（可用{' '}
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
          setRows((prev) => [...prev, emptyRow()])
        }
      >
        加一行
      </Button>

      <div className="mt-8 space-y-3 border-t pt-6">
        <p className="text-sm">合计：¥{total.toFixed(2)}</p>
        {savedOrderNo && (
          <p className="text-sm text-green-600">
            保存成功，单号：<OrderTraceLink orderNo={savedOrderNo} orderType="SALE" />
          </p>
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
