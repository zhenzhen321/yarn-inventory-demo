'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { OrderTraceLink } from '@/components/orders/OrderTraceLink'
import type { CounterpartySummary } from '@/services/settlement'

interface SettlementDetailRow {
  date: string
  type: string
  orderNo: string | null
  yarnName: string
  spec: string
  color: string
  unit: string
  batchNo: string
  lots: { id: string; lotNo: string }[]
  weight: string | null
  inputWeight: string | null
  outputWeight: string | null
  price: string | null
  feePerKg: string | null
  amount: string
  balance: string
  detail: string
}

interface SettlementDetailResponse {
  name: string
  side: 'PURCHASE' | 'SALE' | 'PROCESSING_FEE'
  rows: SettlementDetailRow[]
}

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
  const [details, setDetails] = useState<SettlementDetailResponse | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsMessage, setDetailsMessage] = useState('')
  const [detailsVersion, setDetailsVersion] = useState(0)
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

  function replaceSettlementQuery(
    nextSide: 'PURCHASE' | 'SALE' | 'PROCESSING_FEE',
    nextCounterpartyId: string,
  ) {
    const params = new URLSearchParams()
    params.set('side', nextSide)
    if (nextCounterpartyId) params.set('cp', nextCounterpartyId)
    router.replace(`/app/settlements/new?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    if (initialSide === 'SALE' || initialSide === 'PURCHASE' || initialSide === 'PROCESSING_FEE') {
      setSide(initialSide)
    }
    if (initialCounterpartyId) {
      setCounterpartyId(initialCounterpartyId)
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [initialSide, initialCounterpartyId])

  useEffect(() => {
    if (!counterpartyId) {
      setDetails(null)
      setDetailsMessage('')
      setDetailsLoading(false)
      return
    }

    const controller = new AbortController()
    const params = new URLSearchParams({ side, counterpartyId })
    setDetails(null)
    setDetailsMessage('')
    setDetailsLoading(true)

    async function loadDetails() {
      try {
        const response = await fetch(`/api/settlement-details?${params.toString()}`, {
          signal: controller.signal,
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || '明细加载失败')
        setDetails(data as SettlementDetailResponse)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setDetailsMessage(error instanceof Error ? error.message : '明细加载失败')
      } finally {
        if (!controller.signal.aborted) setDetailsLoading(false)
      }
    }

    void loadDetails()
    return () => controller.abort()
  }, [side, counterpartyId, detailsVersion])

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
      e.currentTarget.reset()
      setDetailsVersion((version) => version + 1)
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
            const nextSide = e.target.value as 'PURCHASE' | 'SALE' | 'PROCESSING_FEE'
            setSide(nextSide)
            setCounterpartyId('')
            replaceSettlementQuery(nextSide, '')
          }}
        >
          <option value="PURCHASE">应付给供应商</option>
          <option value="SALE">应收自客户</option>
          <option value="PROCESSING_FEE">付加工费给加工厂</option>
        </Select>
      </label>
      <label className="text-sm">
        往来单位
        <Select
          value={counterpartyId}
          onChange={(e) => {
            const nextCounterpartyId = e.target.value
            setCounterpartyId(nextCounterpartyId)
            replaceSettlementQuery(side, nextCounterpartyId)
          }}
          required
        >
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

      {counterpartyId ? (
        <section className="space-y-3 border-t pt-4 sm:col-span-2 lg:col-span-6">
          <div>
            <h2 className="font-bold">
              结算对象明细{details ? ` · ${details.name}` : ''}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              正数为新增应付/应收或加工费，负数为付款/收款；余额按业务日期顺序累计。
            </p>
          </div>

          {detailsLoading ? <p className="text-sm text-gray-500">正在加载明细...</p> : null}
          {detailsMessage ? <p className="text-sm text-red-600">{detailsMessage}</p> : null}
          {details && details.rows.length === 0 ? (
            <p className="rounded border bg-gray-50 p-3 text-sm text-gray-500">该对象暂无相关明细</p>
          ) : null}
          {details && details.rows.length > 0 ? (
            <div className="overflow-x-auto rounded border bg-white">
              <table className="w-full min-w-[1080px] text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-gray-600">
                    {[
                      '日期',
                      '类型',
                      '单号',
                      '品名 / 规格 / 色号',
                      '批次 / 内部批次',
                      side === 'PROCESSING_FEE' ? '投入 / 产出' : '重量',
                      side === 'PROCESSING_FEE' ? '加工单价' : '单价',
                      '本笔金额',
                      '累计余额',
                      '说明',
                    ].map((header) => (
                      <th key={header} className="px-3 py-2 font-medium">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {details.rows.map((row, index) => (
                    <tr key={`${row.date}-${row.type}-${row.orderNo ?? 'record'}-${index}`} className="border-b last:border-b-0">
                      <td className="px-3 py-2">{row.date}</td>
                      <td className="px-3 py-2">{row.type}</td>
                      <td className="px-3 py-2">
                        {row.orderNo && details.side !== 'PROCESSING_FEE' ? (
                          <OrderTraceLink orderNo={row.orderNo} orderType={details.side} />
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2">
                        {[row.yarnName, row.spec, row.color].filter(Boolean).join(' / ') || '-'}
                      </td>
                      <td className="px-3 py-2">
                        <div>{row.batchNo || '-'}</div>
                        {row.lots.length ? (
                          <div className="mt-1">
                            {row.lots.map((lot, lotIndex) => (
                              <span key={lot.id}>
                                {lotIndex > 0 ? '、' : ''}
                                <Link href={`/app/lots/${lot.id}`} className="text-blue-700 hover:underline">
                                  {lot.lotNo}
                                </Link>
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {side === 'PROCESSING_FEE'
                          ? row.inputWeight && row.outputWeight
                            ? `${row.inputWeight} → ${row.outputWeight} ${row.unit || 'kg'}`
                            : '-'
                          : row.weight
                            ? `${row.weight} ${row.unit}`
                            : '-'}
                      </td>
                      <td className="px-3 py-2">{row.feePerKg ?? row.price ?? '-'}</td>
                      <td className="px-3 py-2">{row.amount}</td>
                      <td className="px-3 py-2 font-medium">{row.balance}</td>
                      <td className="max-w-64 px-3 py-2 text-gray-600">{row.detail || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </form>
  )
}
