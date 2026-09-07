'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QuickChoices } from '@/components/ui/QuickChoices'
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
import { LabelPrintButton, type LabelPrintOrder } from '@/components/labels/LabelPrintButton'
import { OrderTraceLink } from '@/components/orders/OrderTraceLink'

interface VariantOption {
  id: string
  spec: string
  color: string
  unit: string
}

interface ProductOption {
  id: string
  name: string
  variants: VariantOption[]
}

interface Row {
  productId: string
  spec: string
  color: string
  unit: string
  batchNo: string
  weight: string
  price: string
  packages: string
}

export function PurchaseForm({
  products,
  warehouses,
  suppliers,
  defaultHandler,
}: {
  products: ProductOption[]
  warehouses: { id: string; name: string; type?: string }[]
  suppliers: { id: string; name: string }[]
  defaultHandler?: string
}) {
  const router = useRouter()
  const { markDirty, markSaved, confirmDiscard } = useUnsavedChanges()
  const { submit, submitting } = useIdempotentSubmit()
  const [rows, setRows] = useState<Row[]>(() => {
    const first = products[0]
    return [
      {
        productId: first?.id ?? '',
        spec: first?.variants[0]?.spec ?? '',
        color: '',
        unit: 'kg',
        batchNo: '',
        weight: '',
        price: '',
        packages: '',
      },
    ]
  })
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [message, setMessage] = useState('')
  const [savedOrderNo, setSavedOrderNo] = useState('')
  const [savedLabelOrder, setSavedLabelOrder] = useState<LabelPrintOrder | null>(null)

  function updateRow(idx: number, key: keyof Row, value: string) {
    markDirty()
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r
        const next = { ...r, [key]: value }
        if (key === 'productId') {
          const product = products.find((p) => p.id === value)
          next.spec = product?.variants[0]?.spec ?? ''
          next.color = ''
          next.unit = 'kg'
        }
        return next
      }),
    )
  }

  const total = rows.reduce(
    (sum, r) => sum + (resolveNumeric(r.weight) ?? 0) * (Number(r.price) || 0),
    0,
  )

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage('')
    const form = new FormData(e.currentTarget)
    const body = {
      date: String(form.get('date') ?? businessDateToday()),
      supplierId: String(form.get('supplierId')),
      warehouseId: String(form.get('warehouseId')),
      handlerName: String(form.get('handlerName')),
      note: String(form.get('note') ?? '') || null,
      freight: Number(form.get('freight') ?? 0),
      items: rows.map((r) => ({
        yarnId: r.productId,
        spec: r.spec,
        color: r.color,
        unit: r.unit,
        batchNo: r.batchNo || null,
        weight: resolveNumeric(r.weight) ?? Number(r.weight),
        price: Number(r.price),
        packages: r.packages ? Number(r.packages) : null,
      })),
    }
    const res = await submit((idempotencyKey) =>
      fetch('/api/purchases', {
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
      setSavedLabelOrder({ orderNo: data.orderNo, items: data.items })
      const first = products.find((product) => product.id === rows[rows.length - 1]?.productId) ?? products[0]
      setRows([
        {
          productId: first?.id ?? '',
          spec: first?.variants[0]?.spec ?? '',
          color: '',
          unit: 'kg',
          batchNo: '',
          weight: '',
          price: '',
          packages: '',
        },
      ])
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
<ChoiceField label="供应商" name="supplierId" options={suppliers} value={supplierId} onChange={(value) => { markDirty(); setSupplierId(value) }} memoryKey={"purchase:supplier:" + defaultHandler} />
<ChoiceField label="入库/直送地点" name="warehouseId" options={warehouses.map((row) => ({ id: row.id, name: row.name + (row.type === "FACTORY" ? "（加工厂）" : "") }))} value={warehouseId} onChange={(value) => { markDirty(); setWarehouseId(value) }} memoryKey={"purchase:warehouse:" + defaultHandler} />
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
      </div>

      {rows.map((row, idx) => {
        const product = products.find((p) => p.id === row.productId)
        const variants = product?.variants ?? []
        const specs = [...new Set(variants.map((v) => v.spec))]
        const colors = [
          ...new Set(
            variants
              .filter((v) => !row.spec || v.spec === row.spec)
              .map((v) => v.color),
          ),
        ]
        return (
          <div
            key={idx}
            className="form-section space-y-4"
          >
<div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">第 {idx + 1} 批货</h2><div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => { markDirty(); setRows((current) => [...current, { ...row, batchNo: "", weight: "", packages: "" }]) }}>复制品种</Button><Button type="button" variant="secondary" disabled={rows.length === 1} onClick={() => { markDirty(); setRows((current) => current.filter((_, index) => index !== idx)) }}>移除</Button></div></div>
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="field-label">品名<Select aria-label="品名" value={row.productId} onChange={(event) => updateRow(idx, "productId", event.target.value)} required><option value="">选择产品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></label><div className="space-y-2"><label className="field-label">支数<Input aria-label="支数" value={row.spec} onChange={(event) => updateRow(idx, "spec", event.target.value)} placeholder="如 32支" list={"specs-" + idx} required /></label><datalist id={"specs-" + idx}>{specs.map((value) => <option key={value} value={value} />)}</datalist><QuickChoices label="已有支数" values={specs} value={row.spec} onChange={(value) => updateRow(idx, "spec", value)} /></div><div className="space-y-2"><label className="field-label">色号<Input aria-label="色号" value={row.color} onChange={(event) => updateRow(idx, "color", event.target.value)} placeholder="可填写新色号" list={"colors-" + idx} required /></label><datalist id={"colors-" + idx}>{colors.map((value) => <option key={value} value={value} />)}</datalist><QuickChoices label="已有色号" values={colors} value={row.color} onChange={(value) => updateRow(idx, "color", value)} /></div><label className="field-label">单位<Input value={row.unit} onChange={(event) => updateRow(idx, "unit", event.target.value)} required /></label><label className="field-label">批次 / 缸号（选填）<Input value={row.batchNo} onChange={(event) => updateRow(idx, "batchNo", event.target.value)} /></label><label className="field-label">重量 (kg)<ExpressionInput value={row.weight} onChange={(value) => updateRow(idx, "weight", value)} placeholder="填写本批实际重量" required /></label><label className="field-label">单价 (元/kg)<Input type="number" step="0.01" min="0" value={row.price} onChange={(event) => updateRow(idx, "price", event.target.value)} required /></label><label className="field-label">件数（选填）<Input type="number" step="1" min="0" value={row.packages} onChange={(event) => updateRow(idx, "packages", event.target.value)} /></label></div><p className="text-sm text-slate-600">本批货款 <strong className="text-slate-900">¥{formatNumber((resolveNumeric(row.weight) ?? 0) * (Number(row.price) || 0))}</strong> · 复制品种后，请填写新批的重量和批号。</p>
          </div>
        )
      })}
      <Button
        type="button"
        onClick={() => {
          markDirty()
          const first = products[0]
          setRows((prev) => [
            ...prev,
            {
              productId: first?.id ?? '',
              spec: first?.variants[0]?.spec ?? '',
              color: '',
              unit: 'kg',
              batchNo: '',
              weight: '',
              price: '',
              packages: '',
            },
          ])
        }}
      >
        加一行
      </Button>

      <div className="form-footer">
        <p className="text-base font-semibold">{rows.length} 批 · {formatNumber(rows.reduce((sum, row) => sum + (resolveNumeric(row.weight) ?? 0), 0))} kg · 货款合计 ¥{formatNumber(total)}</p><p className="text-sm text-slate-600">{suppliers.find((row) => row.id === supplierId)?.name} → {warehouses.find((row) => row.id === warehouseId)?.name}</p>
        {savedOrderNo && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
            <p className="text-sm font-medium text-green-700">
              保存成功，单号：<OrderTraceLink orderNo={savedOrderNo} orderType="PURCHASE" />
            </p>
            {savedLabelOrder ? (
              <LabelPrintButton order={savedLabelOrder} label="打印本单标签" />
            ) : null}
          </div>
        )}
        <Notice>{message}</Notice>
        <div className="flex justify-end">
          <Button type="submit" disabled={submitting} className="w-full sm:w-auto sm:min-w-40">
            {submitting ? '保存中…' : '保存入库单'}
          </Button>
        </div>
      </div>
    </form>
  )
}
