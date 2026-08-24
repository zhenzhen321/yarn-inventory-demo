'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function RevertButton({ href, label = '撤回' }: { href: string; label?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onClick() {
    if (!window.confirm('确定撤回这条记录吗？撤回后不可恢复。')) return
    setBusy(true)
    setError('')
    const res = await fetch(href, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      return
    }
    const data = await res.json().catch(() => ({}))
    setError(data.error || '撤回失败')
    setBusy(false)
  }

  return (
    <span>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
      >
        {busy ? '撤回中…' : label}
      </button>
      {error && <span className="ml-1 text-xs text-red-600">{error}</span>}
    </span>
  )
}
