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

export function OrderFilterPanel({
  warehouses,
  counterparties,
}: {
  warehouses: Option[]
  counterparties: Option[]
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [type, setType] = useState(sp.get('type') ?? 'ALL')
  const [from, setFrom] = useState(sp.get('from') ?? '')
  const [to, setTo] = useState(sp.get('to') ?? '')
  const [warehouseId, setWarehouseId] = useState(sp.get('warehouseId') ?? '')
  const [counterpartyId, setCounterpartyId] = useState(sp.get('counterpartyId') ?? '')
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [yarnQ, setYarnQ] = useState(sp.get('yarnQ') ?? '')

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (type !== 'ALL') params.set('type', type)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (warehouseId) params.set('warehouseId', warehouseId)
    if (counterpartyId) params.set('counterpartyId', counterpartyId)
    if (q.trim()) params.set('q', q.trim())
    if (yarnQ.trim()) params.set('yarnQ', yarnQ.trim())
    router.push(`/app/orders?${params.toString()}`)
  }

  function reset() {
    setType('ALL')
    setFrom('')
    setTo('')
    setWarehouseId('')
    setCounterpartyId('')
    setQ('')
    setYarnQ('')
    router.push('/app/orders')
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded border bg-white p-4 sm:grid-cols-2 lg:grid-cols-8"
    >
      <label className="text-sm">
        类型
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="ALL">全部</option>
          <option value="PURCHASE">买入</option>
          <option value="SALE">卖出</option>
        </Select>
      </label>
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
        往来单位
        <Select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
          <option value="">全部</option>
          {counterparties.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-sm">
        单号
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="模糊匹配" />
      </label>
      <label className="text-sm">
        纱线关键词
        <Input
          value={yarnQ}
          onChange={(e) => setYarnQ(e.target.value)}
          placeholder="名称/支数/色号"
        />
      </label>
      <div className="flex items-end gap-2">
        <Button type="submit">查询</Button>
        <Button type="button" onClick={reset} className="bg-gray-500 hover:bg-gray-600">
          重置
        </Button>
      </div>
    </form>
  )
}
