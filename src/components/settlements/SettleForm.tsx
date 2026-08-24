'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import type { CounterpartySummary } from '@/services/settlement'

export function SettleForm({
  suppliers,
  customers,
  factories,
  payables,
  receivables,
  factoryFees,
  defaultHandler,
  initialSide = '',
  initialCounterpartyId = '',
}: {
  suppliers: { id: string; name: string }[]
  customers: { id: string; name: string }[]
  factories: { id: string; name: string }[]
  payables: CounterpartySummary[]
  receivables: CounterpartySummary[]
  factoryFees: { id: string; owedAmount: { toString(): string } }[]
  defaultHandler?: string
  initialSide?: string
  initialCounterpartyId?: string
}) {
  const router = useRouter()
  const [side, setSide] = useState<'PURCHASE' | 'SALE' | 'PROCESSING_FEE'>(
    initialSide === 'SALE'
      ? 'SALE'
      : initialSide === 'PROCESSING_FEE'
        ? 'PROCESSING_FEE'
        : 'PURCHASE',
  )
  const [counterpartyId, setCounterpartyId] = useState(initialCounterpartyId)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const options =
    side === 'PURCHASE' ? suppliers : side === 'SALE' ? customers : factories
  const summaries =
    side === 'PURCHASE' ? payables : side === 'SALE' ? receivables : factoryFees
  const selected = summaries.find((s) => s.id === counterpartyId)
  const remaining = selected
    ? 'owedAmount' in selected
      ? String(selected.owedAmount)
      : String((selected as CounterpartySummary).remainingAmount)
    : ''

  useEffect(() => {
    if (initialSide === 'SALE' || initialSide === 'PURCHASE' || initialSide === 'PROCESSING_FEE') {
      setSide(initialSide)
    }
    if (initialCounterpartyId) {
      setCounterpartyId(initialCounterpartyId)
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [initialSide, initialCounterpartyId])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage('')
    setSaved(false)
    const form = new FormData(e.currentTarget)
    const body = {
      side,
      counterpartyId,
      amount: Number(form.get('amount')),
      date: String(form.get('date') ?? new Date().toISOString().slice(0, 10)),
      method: String(form.get('method') ?? '') || null,
      handlerName: String(form.get('handlerName')),
    }
    const res = await fetch(
      side === 'PROCESSING_FEE' ? '/api/processing-fee-payments' : '/api/settlements',
      {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      },
    )
    if (res.ok) {
      setSaved(true)
      setCounterpartyId('')
      e.currentTarget.reset()
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setMessage(data.error || '保存失败')
    }
  }

  return (
    <form
      id="settle-form"
      ref={formRef}
      onSubmit={onSubmit}
      className="grid scroll-mt-24 gap-3 rounded border bg-white p-4 sm:grid-cols-2 lg:grid-cols-6"
    >
      <label className="text-sm">
        方向
        <Select
          value={side}
          onChange={(e) => {
            setSide(e.target.value as 'PURCHASE' | 'SALE' | 'PROCESSING_FEE')
            setCounterpartyId('')
          }}
        >
          <option value="PURCHASE">应付给供应商</option>
          <option value="SALE">应收自客户</option>
          <option value="PROCESSING_FEE">付加工费给加工厂</option>
        </Select>
      </label>
      <label className="text-sm">
        往来单位
        <Select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} required>
          <option value="">选择往来单位</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-sm">
        未结金额 (元)
        <Input value={remaining} readOnly />
      </label>
      <label className="text-sm">
        结算金额 (元)
        <Input type="number" step="0.01" min="0" name="amount" required placeholder="金额" />
      </label>
      <label className="text-sm">
        结算日期
        <Input
          type="date"
          name="date"
          required
          defaultValue={new Date().toISOString().slice(0, 10)}
        />
      </label>
      <label className="text-sm">
        方式
        <Select name="method">
          <option value="">未指定</option>
          <option value="现金">现金</option>
          <option value="银行转账">银行转账</option>
          <option value="微信">微信</option>
          <option value="支付宝">支付宝</option>
          {side === 'SALE' && <option value="折让">折让</option>}
          <option value="其他">其他</option>
        </Select>
      </label>
      <label className="text-sm">
        经手人
        <Select name="handlerName" defaultValue={defaultHandler ?? 'admin'} required>
          <option value="admin">admin</option>
          <option value="clerk">clerk</option>
        </Select>
      </label>
      <div className="flex items-end">
        <Button type="submit" className="w-full">
          登记结算
        </Button>
      </div>
      {saved && <p className="text-sm text-green-600">结算已登记</p>}
      {message && <p className="text-sm text-red-600">{message}</p>}
    </form>
  )
}
