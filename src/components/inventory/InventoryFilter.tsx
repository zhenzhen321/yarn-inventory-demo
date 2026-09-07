'use client'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
export function InventoryFilter({ warehouses, includeZero }: { warehouses: { id: string; name: string }[]; includeZero: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const [warehouseId, setWarehouseId] = useState(params.get('warehouseId') ?? '')
  const [q, setQ] = useState(params.get('q') ?? '')
  const [checked, setChecked] = useState(includeZero)
  useEffect(() => { setWarehouseId(params.get('warehouseId') ?? ''); setQ(params.get('q') ?? ''); setChecked(params.get('includeZero') === '1') }, [params])
  function apply(warehouse = warehouseId, query = q, zero = checked) {
    const next = new URLSearchParams()
    if (warehouse) next.set('warehouseId', warehouse)
    if (query.trim()) next.set('q', query.trim())
    if (zero) next.set('includeZero', '1')
    router.push('/app/inventory' + (next.size ? '?' + next.toString() : ''), { scroll: false })
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); apply() }
  return <form onSubmit={submit} className="form-section space-y-4">
    <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.5fr_auto_auto]">
      <label className="field-label">所在仓库<Select aria-label="所在仓库" name="warehouseId" value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); apply(event.target.value) }}>
        <option value="">全部仓库</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
      </Select></label>
      <label className="field-label">纱线 / 色号 / 支数（选填）<Input name="q" value={q} onChange={(event) => setQ(event.target.value)} placeholder="需要时再输入关键词" /></label>
      <Button type="submit">查询</Button>
      <Button type="button" variant="secondary" onClick={() => { setWarehouseId(''); setQ(''); setChecked(false); apply('', '', false) }}>清空筛选</Button>
    </div>
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="库存仓库快捷选择">
      {[{ id: '', name: '全部仓库' }, ...warehouses.slice(0, 5)].map((warehouse) =>
        <button key={warehouse.id} type="button" className="choice-chip" aria-pressed={warehouseId === warehouse.id}
          onClick={() => { setWarehouseId(warehouse.id); apply(warehouse.id) }}>{warehouse.name}</button>)}
      <label className="ml-auto flex min-h-11 items-center gap-2 text-sm text-slate-600">
        <input className="h-5 w-5" type="checkbox" checked={checked} onChange={(event) => { setChecked(event.target.checked); apply(warehouseId, q, event.target.checked) }} />显示 0kg 库存
      </label>
    </div>
  </form>
}
