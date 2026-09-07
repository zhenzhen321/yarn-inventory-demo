'use client'

import { ReactNode, useEffect, useId, useRef } from 'react'
import { Button } from './Button'

export function Dialog({ title, children, footer, onClose, busy = false, wide = false, scrollKey }: {
  title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; scrollKey?: number
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => { ref.current?.scrollTo({ top: 0 }) }, [scrollKey])
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement as HTMLElement | null
    dialog?.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])
  return (
    <dialog ref={ref} aria-labelledby={titleId} className={`app-dialog ${wide ? 'app-dialog-wide' : ''}`}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
      <div className="dialog-heading">
        <h2 id={titleId} className="text-xl font-bold">{title}</h2>
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy} aria-label="关闭弹窗">关闭</Button>
      </div>
      <div className="dialog-content">{children}</div>
      {footer && <div className="dialog-footer">{footer}</div>}
    </dialog>
  )
}
