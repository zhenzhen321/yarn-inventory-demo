'use client'

import { FormEvent, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

export function SettlementRecordsFilter({
  counterparties,
}: {
  counterparties: { id: string; name: string }[]
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [side, setSide] = useState(sp.get('recSide') ?? '')
  const [counterpartyId, setCounterpartyId] = useState(sp.get('recCounterpartyId') ?? '')
  const [from, setFrom] = useState(sp.get('recFrom') ?? '')
  const [to, setTo] = useState(sp.get('recTo') ?? '')

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const params = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries({
      recSide: side,
      recCounterpartyId: counterpartyId,
      recFrom: from,
      recTo: to,
    })) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    router.push(`/app/settlements/records?${params.toString()}`)
  }

  function reset() {
    const params = new URLSearchParams(sp.toString())
    for (const k of ['recSide', 'recCounterpartyId', 'recFrom', 'recTo']) params.delete(k)
    router.push(`/app/settlements/records?${params.toString()}`)
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded border bg-white p-3 sm:grid-cols-2 lg:grid-cols-6"
    >
      <label className="text-sm">
        类型
        <Select value={side} onChange={(e) => setSide(e.target.value)}>
          <option value="">全部</option>
          <option value="PURCHASE">买入应付</option>
          <option value="SALE">卖出应收</option>
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
        日期起
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="text-sm">
        日期止
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
