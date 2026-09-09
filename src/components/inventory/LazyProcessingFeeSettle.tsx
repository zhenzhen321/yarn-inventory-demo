'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import type { FactoryInventoryRow } from './ProcessingFeeSettle'

const ProcessingFeeSettle = dynamic(
  () => import('./ProcessingFeeSettle').then((module) => module.ProcessingFeeSettle),
  { ssr: false },
)

export function LazyProcessingFeeSettle({
  warehouseId,
  q,
  includeZero,
}: {
  warehouseId?: string
  q?: string
  includeZero: boolean
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<FactoryInventoryRow[] | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const requestVersion = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)
  useEffect(() => () => {
    requestVersion.current += 1
    activeRequest.current?.abort()
  }, [])

  const load = useCallback(async () => {
    setError(false)
    setLoading(true)
    const version = ++requestVersion.current
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    const params = new URLSearchParams()
    if (warehouseId) params.set('warehouseId', warehouseId)
    if (q) params.set('q', q)
    if (includeZero) params.set('includeZero', '1')
    try {
      const response = await fetch(`/api/inventory/factory-rows?${params}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('factory inventory request failed')
      const data = await response.json()
      if (!controller.signal.aborted && version === requestVersion.current) setRows(data.rows)
    } catch {
      if (!controller.signal.aborted && version === requestVersion.current) setError(true)
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [warehouseId, q, includeZero])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) void load()
    else {
      requestVersion.current += 1
      activeRequest.current?.abort()
      setLoading(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <CollapseToggle expanded={open} onClick={toggle} label="展开/收起加工完工核算" />
        <h2 className="text-lg font-bold">加工厂 · 完工核算</h2>
      </div>
      {open && error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>加工库存加载失败。</span>
          <button type="button" className="underline" onClick={() => void load()}>重试</button>
        </div>
      )}
      {open && rows === null && !error && <p className="text-sm text-gray-500">正在加载加工库存…</p>}
      {rows !== null && <ProcessingFeeSettle rows={rows} expanded={open} busy={loading || error} hideToggle onCompleted={() => void load()} />}
    </section>
  )
}
