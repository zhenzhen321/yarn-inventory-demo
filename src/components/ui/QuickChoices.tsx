'use client'

import { quickValues } from '@/lib/display'
import { Select } from './Select'

export function QuickChoices({ values, value, onChange, label }: {
  values: string[]; value: string; onChange: (value: string) => void; label: string
}) {
  if (!values.length) return null
  return <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
    {quickValues(values, value).map((option) => <button key={option} type="button"
      className="choice-chip" aria-pressed={option === value} onClick={() => onChange(option)}>{option}</button>)}
    {new Set(values.filter(Boolean)).size > 5 && <Select aria-label={label + '全部选项'} value="" onChange={(event) => onChange(event.target.value)}>
      <option value="" disabled>点这里查看全部已有选项</option>
      {[...new Set(values.filter(Boolean))].map((option) => <option key={option} value={option}>{option}</option>)}
    </Select>}
  </div>
}
