'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Notice } from '@/components/ui/Notice'
export function RevertButton({ href, label = '撤回', subject }: { href: string; label?: string; subject?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    setBusy(true); setError('')
    try {
      const response = await fetch(href, { method: 'DELETE' })
      if (!response.ok) { const data = await response.json().catch(() => ({})); setError(data.error || '撤回失败，请刷新后核对记录。'); return }
      setOpen(false); router.refresh()
    } catch { setError('网络中断，请刷新核对记录状态后再操作。') }
    finally { setBusy(false) }
  }
  const inventoryOrder = /\/api\/(purchases|sales)\//.test(href)
  return <>
    <Button type="button" variant="danger" onClick={() => { setError(''); setOpen(true) }}>{label}</Button>
    {open && <Dialog title="确认撤回记录" onClose={() => setOpen(false)} busy={busy} footer={<>
      <Button type="button" variant="secondary" autoFocus disabled={busy} onClick={() => setOpen(false)}>保留记录</Button>
      <Button type="button" variant="danger" disabled={busy} onClick={confirm}>{busy ? '撤回中…' : '确认撤回'}</Button>
    </>}>
      <p className="font-semibold">{subject ?? '当前选中的记录'}</p>
      <p className="leading-relaxed text-slate-600">{inventoryOrder
        ? '撤回会反向调整本单对应的库存及应收应付，原单保留为已撤回。请确认选中了正确的单号。'
        : '撤回会取消这笔结算，使对应的未结金额增加。请核对对象和金额。'}</p>
      <Notice>{error}</Notice>
    </Dialog>}
  </>
}
