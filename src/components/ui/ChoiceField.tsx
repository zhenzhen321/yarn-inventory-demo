'use client'

import { useEffect, useId, useState } from 'react'
import { Select } from './Select'

export function ChoiceField({ label, name, options, value, onChange, memoryKey, required = true }: {
  label: string; name?: string; options: { id: string; name: string }[]; value: string
  onChange: (value: string) => void; memoryKey?: string; required?: boolean
}) {
  const id = useId()
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('yarn-ui:' + memoryKey) ?? '[]')
      setRecent(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string').slice(0, 4) : [])
    } catch { setRecent([]) }
  }, [memoryKey])
  function choose(next: string) {
    onChange(next)
    if (!memoryKey || !next) return
    const saved = [next, ...recent.filter((item) => item !== next)].slice(0, 4)
    setRecent(saved)
    try { localStorage.setItem('yarn-ui:' + memoryKey, JSON.stringify(saved)) } catch { /* 点选不依赖存储可用 */ }
  }
  const quick = [...new Set([...recent, ...options.map((option) => option.id)])]
    .map((key) => options.find((option) => option.id === key)).filter((option) => Boolean(option)).slice(0, 3)
  return <div className="space-y-2 min-w-0">
    <label htmlFor={id} className="field-label">{label}</label>
    <Select id={id} name={name} value={value} required={required} onChange={(event) => choose(event.target.value)}>
      <option value="">请选择{label}</option>
      {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </Select>
    <div className="flex flex-wrap gap-2" role="group" aria-label={label + '快捷选择'}>
      {quick.map((option) => option && <button type="button" className="choice-chip" key={option.id}
        aria-pressed={value === option.id} onClick={() => choose(option.id)}>{option.name}</button>)}
    </div>
  </div>
}
