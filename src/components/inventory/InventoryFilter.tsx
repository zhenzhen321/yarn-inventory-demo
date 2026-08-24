'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

export function InventoryFilter({
  warehouses,
  includeZero,
}: {
  warehouses: { id: string; name: string }[]
  includeZero: boolean
}) {
  const router = useRouter()
  const [checked, setChecked] = useState(includeZero)

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const params = new URLSearchParams()
    const warehouseId = String(form.get('warehouseId') ?? '')
    const q = String(form.get('q') ?? '').trim()
    if (warehouseId) params.set('warehouseId', warehouseId)
    if (q) params.set('q', q)
    if (checked) params.set('includeZero', '1')
    router.push(`/app/inventory${params.toString() ? `?${params.toString()}` : ''}`)
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <Select name="warehouseId" defaultValue="" className="max-w-40">
        <option value="">全部仓库</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </Select>
      <Input name="q" placeholder="搜索纱线名称/色号/支数" className="max-w-xs" />
      <Button type="submit">查询</Button>
      <label className="flex items-center gap-1 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        显示 0kg 库存
      </label>
    </form>
  )
}
