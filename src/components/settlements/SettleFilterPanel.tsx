'use client'

import { FormEvent, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

interface Option {
  id: string
  name: string
}

export function SettleFilterPanel({
  prefix,
  entityLabel,
  warehouses,
  counterparties,
}: {
  prefix: 'buy' | 'sale'
  entityLabel: string
  warehouses: Option[]
  counterparties: Option[]
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const p = (k: string) => sp.get(`${prefix}${k}`) ?? ''
  const [from, setFrom] = useState(p('From'))
  const [to, setTo] = useState(p('To'))
  const [warehouseId, setWarehouseId] = useState(p('WarehouseId'))
  const [counterpartyId, setCounterpartyId] = useState(
    p(prefix === 'buy' ? 'SupplierId' : 'CustomerId'),
  )

  function counterpartyKey() {
    return prefix === 'buy' ? 'SupplierId' : 'CustomerId'
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const params = new URLSearchParams(sp.toString())
    if (from) params.set(`${prefix}From`, from)
    else params.delete(`${prefix}From`)
    if (to) params.set(`${prefix}To`, to)
    else params.delete(`${prefix}To`)
    if (warehouseId) params.set(`${prefix}WarehouseId`, warehouseId)
    else params.delete(`${prefix}WarehouseId`)
    if (counterpartyId) params.set(`${prefix}${counterpartyKey()}`, counterpartyId)
    else params.delete(`${prefix}${counterpartyKey()}`)
    router.push(`/app/settlements?${params.toString()}`)
  }

  function reset() {
    const params = new URLSearchParams(sp.toString())
    for (const k of [
      `${prefix}From`,
      `${prefix}To`,
      `${prefix}WarehouseId`,
      `${prefix}${counterpartyKey()}`,
    ]) {
      params.delete(k)
    }
    router.push(`/app/settlements?${params.toString()}`)
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded border bg-white p-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      <label className="text-sm">
        日期起
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="text-sm">
        日期止
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label className="text-sm">
        仓库
        <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">全部</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-sm">
        {entityLabel}
        <Select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
          <option value="">全部</option>
          {counterparties.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex items-end gap-2">
        <Button type="submit">筛选</Button>
        <Button type="button" onClick={reset} className="bg-gray-500 hover:bg-gray-600">
          重置
        </Button>
      </div>
    </form>
  )
}
