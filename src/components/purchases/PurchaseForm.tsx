'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ExpressionInput } from '@/components/ui/ExpressionInput'
import { Select } from '@/components/ui/Select'
import { resolveNumeric } from '@/lib/expression'
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
  const [message, setMessage] = useState('')
  const [savedOrderNo, setSavedOrderNo] = useState('')
  const [savedLabelOrder, setSavedLabelOrder] = useState<LabelPrintOrder | null>(null)

  function updateRow(idx: number, key: keyof Row, value: string) {
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
      date: String(form.get('date') ?? new Date().toISOString().slice(0, 10)),
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
    const res = await fetch('/api/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const data = await res.json()
      setSavedOrderNo(data.orderNo)
      setSavedLabelOrder({ orderNo: data.orderNo, items: data.items })
      const first = products[0]
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
          供应商
          <Select name="supplierId" required>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          入库/直送地点
          <Select name="warehouseId" required>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}{w.type === 'FACTORY' ? '（加工厂，供应商直送）' : ''}
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
            className="grid gap-3 rounded border bg-white p-3 sm:grid-cols-2 lg:grid-cols-9"
          >
            <Select
              value={row.productId}
              onChange={(e) => updateRow(idx, 'productId', e.target.value)}
              required
            >
              <option value="">选择产品</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Input
              value={row.spec}
              onChange={(e) => updateRow(idx, 'spec', e.target.value)}
              placeholder="支数（如 32支）"
              list={`specs-${idx}`}
              required
            />
            <datalist id={`specs-${idx}`}>
              {specs.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Input
              value={row.color}
              onChange={(e) => updateRow(idx, 'color', e.target.value)}
              placeholder="颜色（可填新色，自动建档）"
              list={`colors-${idx}`}
              required
            />
            <datalist id={`colors-${idx}`}>
              {colors.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Input
              value={row.unit}
              onChange={(e) => updateRow(idx, 'unit', e.target.value)}
              placeholder="单位"
              required
            />
            <Input
              value={row.batchNo}
              onChange={(e) => updateRow(idx, 'batchNo', e.target.value)}
              placeholder="批次/缸号（可选）"
            />
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
        )
      })}
      <Button
        type="button"
        onClick={() => {
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

      <div className="mt-8 space-y-3 border-t pt-6">
        <p className="text-sm">合计：¥{total.toFixed(2)}</p>
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
        {message && <p className="text-sm text-red-600">{message}</p>}
        <div className="flex justify-end">
          <Button type="submit" className="w-full sm:w-auto sm:min-w-40">
            保存入库单
          </Button>
        </div>
      </div>
    </form>
  )
}
