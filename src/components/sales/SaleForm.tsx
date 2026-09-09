'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
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
import { OrderTraceLink } from '@/components/orders/OrderTraceLink'
import { resolveNumeric } from '@/lib/expression'
import { businessDateToday } from '@/lib/business-date'
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit'
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
  initialWarehouseId,
  defaultHandler,
}: {
  customers: Option[]
  warehouses: Option[]
  inventoryRows: InventoryRow[]
  initialWarehouseId: string
  defaultHandler?: string
}) {
  const router = useRouter()
  const { markDirty, markSaved, confirmDiscard } = useUnsavedChanges()
  const { submit, submitting } = useIdempotentSubmit()
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '')
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId)
  const [loadedRows, setLoadedRows] = useState(inventoryRows)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [inventoryError, setInventoryError] = useState('')
  const [scanLoading, setScanLoading] = useState(false)
  const [rows, setRows] = useState<Row[]>([emptyRow()])
  const [message, setMessage] = useState('')
  const [savedOrderNo, setSavedOrderNo] = useState('')
  const [scanCode, setScanCode] = useState('')
  const [scanMessage, setScanMessage] = useState('')
  const scanInputRef = useRef<HTMLInputElement>(null)
  const inventoryRequest = useRef<AbortController | null>(null)
  const scanRequest = useRef<AbortController | null>(null)
  const scanSequence = useRef(0)
  const scanLock = useRef(false)

  const warehouseType = warehouses.find((w) => w.id === warehouseId)?.type ?? 'WAREHOUSE'
  const available = useMemo(
    () =>
      loadedRows.filter(
        (r) =>
          r.warehouseId === warehouseId &&
          (warehouseType !== 'FACTORY' || r.processingFeeSettled),
      ),
    [warehouseId, warehouseType, loadedRows],
  )
  const choices = useMemo(
    () => getSaleInventoryChoices(available, warehouseId),
    [available, warehouseId],
  )
  const total = rows.reduce(
    (sum, r) => sum + (resolveNumeric(r.weight) ?? 0) * (Number(r.price) || 0),
    0,
  )

  useEffect(() => () => {
    inventoryRequest.current?.abort()
    scanRequest.current?.abort()
  }, [])

  async function loadWarehouse(nextWarehouseId: string, preserveScan = false) {
    if (!preserveScan) {
      scanRequest.current?.abort()
      scanSequence.current += 1
      setScanLoading(false)
    }
    inventoryRequest.current?.abort()
    const controller = new AbortController()
    inventoryRequest.current = controller
    setInventoryLoading(true)
    setInventoryError('')
    setLoadedRows([])
    try {
      const response = await fetch(`/api/sale-inventory?warehouseId=${encodeURIComponent(nextWarehouseId)}`, { cache: 'no-store', signal: controller.signal })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '库存加载失败')
      if (controller.signal.aborted || inventoryRequest.current !== controller) return null
      setLoadedRows(data.rows as InventoryRow[])
      return data.rows as InventoryRow[]
    } catch (error) {
      if (controller.signal.aborted || inventoryRequest.current !== controller) return null
      setInventoryError(error instanceof Error ? error.message : '库存加载失败')
      setLoadedRows([])
      return null
    } finally {
      if (!controller.signal.aborted) setInventoryLoading(false)
    }
  }

  function updateRow(idx: number, key: keyof Row, value: string) {
    if (inventoryLoading || inventoryError || scanLoading || submitting) return
    markDirty()
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

  async function addScannedLot(rawCode?: string) {
    if (inventoryLoading || inventoryError || scanLock.current || submitting) return
    const code = (rawCode ?? scanCode).trim()
    if (!code) return
    scanLock.current = true
    setScanCode('')
    const controller = new AbortController()
    scanRequest.current = controller
    const sequence = ++scanSequence.current
    setScanLoading(true)
    setScanMessage('正在查找批次…')
    try {
      const response = await fetch(`/api/sale-inventory?warehouseId=${encodeURIComponent(warehouseId)}&code=${encodeURIComponent(code)}`, { cache: 'no-store', signal: controller.signal })
      const data = await response.json().catch(() => ({}))
      if (controller.signal.aborted || sequence !== scanSequence.current) return
      if (!response.ok) throw new Error(data.error || '批次查找失败')
      const matched = data.row as InventoryRow | null
      if (!matched) {
        setScanMessage('未找到该批次，请确认标签或改用手工选择')
        return
      }
      const targetWarehouse = warehouses.find(w => w.id === matched.warehouseId)
      if (!targetWarehouse) {
        setScanMessage('该批次所在仓库已停用或资料已变化，请刷新页面后重试')
        return
      }
      if (targetWarehouse.type === 'FACTORY' && !matched.processingFeeSettled) {
        setScanMessage('该加工厂批次尚未完成加工核算，不能销售')
        return
      }
      if (matched.warehouseId !== warehouseId) {
        if (rows.some(row => row.inventoryId)) {
          setScanMessage(`该批次在 ${matched.warehouseName}；本单已有所选仓库的货，一张出库单只能对应一个仓库，请先保存或删清明细再扫`)
          return
        }
        const targetRows = await loadWarehouse(matched.warehouseId, true)
        if (controller.signal.aborted || sequence !== scanSequence.current) return
        if (!targetRows) { setScanMessage('该仓库库存加载失败，请重试加载库存后再扫码'); return }
        setWarehouseId(matched.warehouseId)
      }
      if (rows.some(row => row.inventoryId === matched.id)) {
        setScanMessage('该批次已在本单中，无需重复扫描')
        return
      }
      setLoadedRows(current => [...current.filter(row => row.id !== matched.id), matched])
      markDirty()
      const nextRow: Row = {
        yarnName: matched.yarnName, color: matched.color ?? '未填色号', inventoryId: matched.id,
        weight: matched.weight, price: '', packages: matched.packages?.toString() ?? '',
      }
      setRows(current => {
        if (current.some(row => row.inventoryId === matched.id)) return current
        const emptyIndex = current.findIndex(row => !row.yarnName && !row.color && !row.inventoryId && !row.weight && !row.price && !row.packages)
        if (emptyIndex < 0) return [...current, nextRow]
        return current.map((row, index) => index === emptyIndex ? nextRow : row)
      })
      setScanMessage(matched.warehouseId !== warehouseId
        ? `已切换到 ${matched.warehouseName}，加入 ${matched.yarnName} · ${matched.lotNo ?? matched.batchNo}，默认全部 ${Number(matched.weight).toFixed(2)} kg`
        : `已加入 ${matched.yarnName} · ${matched.lotNo ?? matched.batchNo}，默认全部 ${Number(matched.weight).toFixed(2)} kg`)
    } catch (error) {
      if (!controller.signal.aborted && sequence === scanSequence.current) setScanMessage(error instanceof Error ? error.message : '批次查找失败')
    } finally {
      if (sequence === scanSequence.current) {
        scanLock.current = false
        setScanLoading(false)
        requestAnimationFrame(() => scanInputRef.current?.focus())
      }
    }
  }

  function handleScanChange(value: string) {
    setScanCode(value)
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (inventoryLoading || inventoryError || scanLock.current || submitting) {
      setMessage('库存仍在加载或扫码处理中，请稍候再保存。')
      return
    }
    setMessage('')
    const form = new FormData(e.currentTarget)
    const body = {
      date: String(form.get('date') ?? businessDateToday()),
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
    const res = await submit((idempotencyKey) =>
      fetch('/api/sales', {
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
      void loadWarehouse(warehouseId)
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setMessage(data.error || '保存失败')
    }
  }

  return (
    <form onSubmit={onSubmit} onChange={markDirty} className="space-y-5">
      <fieldset disabled={scanLoading || submitting} className="form-section grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
<BusinessDateField onChange={markDirty} />
<ChoiceField label="客户" name="customerId" options={customers} value={customerId} onChange={(value) => { markDirty(); setCustomerId(value) }} memoryKey={"sale:customer:" + defaultHandler} />
<ChoiceField label="仓库" options={warehouses} value={warehouseId} onChange={(value) => { if (scanLock.current || submitting || value === warehouseId) return; if (rows.some((row) => row.inventoryId) && !confirmDiscard()) return; markDirty(); setWarehouseId(value); setRows([emptyRow()]); void loadWarehouse(value) }} memoryKey={"sale:warehouse:" + defaultHandler} />
        <label className="text-sm">
          经办人
          <Select name="handlerName" defaultValue={defaultHandler ?? '刚'} required>
            <option value="刚">刚</option>
            <option value="萍">萍</option>
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
      </fieldset>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <label className="block text-sm font-medium text-blue-950">
          扫码枪快速出库
          <div className="mt-1 flex gap-2">
            <Input
              ref={scanInputRef}
              autoFocus
              disabled={inventoryLoading || !!inventoryError || scanLoading || submitting}
              aria-label="扫描标签二维码"
              value={scanCode}
              onChange={(event) => handleScanChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void addScannedLot()
                }
              }}
              placeholder="扫描 YMS-二维码或输入 LOT-内部批次号"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button type="button" disabled={inventoryLoading || !!inventoryError || scanLoading || submitting} onClick={() => void addScannedLot()}>
              加入
            </Button>
          </div>
        </label>
        <p className="mt-1 text-xs text-blue-800">
          扫码、输入或粘贴后，按回车或点击“加入”；批次在其他仓库时自动切换仓库（本单已有明细时除外）；
          默认卖出全部余量和件数，部分卖出时直接修改下方重量和件数。
        </p>
        {scanMessage && <Notice tone={scanMessage.startsWith("已加入") ? "success" : "info"}>{scanMessage}</Notice>}
      </div>

      {inventoryLoading && <Notice>正在加载该仓库库存…</Notice>}
      {inventoryError && <div><Notice>{inventoryError}</Notice><Button type="button" variant="secondary" onClick={() => void loadWarehouse(warehouseId)}>重试加载库存</Button></div>}

      <fieldset disabled={inventoryLoading || !!inventoryError || scanLoading || submitting} className="min-w-0 space-y-5">
      {rows.map((row, idx) => (
        <div
          key={idx}
          className="form-section grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
<h2 className="font-bold sm:col-span-2 xl:col-span-3">第 {idx + 1} 批货</h2>
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
            aria-label="卖出重量 (kg)"
            placeholder="重量 kg*"
            required
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            value={row.price}
            onChange={(e) => updateRow(idx, 'price', e.target.value)}
            aria-label="卖出单价 (元/kg)"
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
            disabled={rows.length === 1 || scanLoading || submitting}
            onClick={() => { markDirty(); setRows((prev) => prev.filter((_, i) => i !== idx)) }}
            variant="secondary"
          >
            删除
          </Button>
          <p className="text-sm text-slate-600 sm:col-span-2 xl:col-span-3">本批可用 {formatNumber(available.find((item) => item.id === row.inventoryId)?.weight ?? 0)} kg · 本批货款 ¥{formatNumber((resolveNumeric(row.weight) ?? 0) * (Number(row.price) || 0))}</p>
          {row.inventoryId && (resolveNumeric(row.weight) ?? 0) > Number(available.find((item) => item.id === row.inventoryId)?.weight ?? 0) && <div className="sm:col-span-2 xl:col-span-3"><Notice>卖出重量超过本批库存，请减少重量。</Notice></div>}
        </div>
      ))}
      <Button
        type="button"
        disabled={scanLoading || submitting}
        onClick={() =>
          setRows((prev) => [...prev, emptyRow()])
        }
      >
        加一行
      </Button>

      </fieldset>
      <div className="form-footer">
        <p className="text-base font-semibold">货款合计：¥{formatNumber(total)}</p><p className="text-sm text-slate-600">{warehouses.find((row) => row.id === warehouseId)?.name} → {customers.find((row) => row.id === customerId)?.name}</p>
        {savedOrderNo && (
          <p className="text-sm text-green-600">
            保存成功，单号：<OrderTraceLink orderNo={savedOrderNo} orderType="SALE" />
          </p>
        )}
        <Notice>{message}</Notice>
        <div className="flex justify-end">
          <Button type="submit" disabled={submitting || scanLoading || inventoryLoading || !!inventoryError} className="w-full sm:w-auto sm:min-w-40">
            {submitting ? '保存中…' : '保存出库单'}
          </Button>
        </div>
      </div>
    </form>
  )
}
