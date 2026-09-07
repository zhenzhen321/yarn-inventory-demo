'use client'

import { useId, useState } from 'react'
import { businessDateToday } from '@/lib/business-date'
import { Input } from './Input'

export function BusinessDateField({ name = 'date', label = '业务日期', value, onChange }: {
  name?: string; label?: string; value?: string; onChange?: (value: string) => void
}) {
  const id = useId()
  const [local, setLocal] = useState(businessDateToday())
  const current = value ?? local
  function change(next: string) { setLocal(next); onChange?.(next) }
  return <div className="space-y-2">
    <label htmlFor={id} className="field-label">{label}</label>
    <Input id={id} type="date" name={name} value={current} required onChange={(event) => change(event.target.value)} />
    <div className="flex gap-2">
      {[{ label: '今天', date: businessDateToday() }, { label: '昨天', date: businessDateToday(new Date(Date.now() - 86400000)) }].map((item) =>
        <button type="button" key={item.label} className="choice-chip" aria-pressed={current === item.date} onClick={() => change(item.date)}>{item.label}</button>)}
    </div>
  </div>
}
