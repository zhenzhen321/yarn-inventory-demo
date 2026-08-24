'use client'

import { useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { Input } from '@/components/ui/Input'
import { evaluateExpression } from '@/lib/expression'

export function ExpressionInput({
  value,
  onChange,
  onBlur,
  ...rest
}: {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'onBlur' | 'type'>) {
  const [focused, setFocused] = useState(false)
  const preview = evaluateExpression(value)

  function handleBlur() {
    setFocused(false)
    if (preview !== null && value.trim() !== String(preview)) {
      onChange(String(preview))
    }
    onBlur?.()
  }

  return (
    <div className="relative">
      <Input
        {...rest}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
      />
      {focused && preview !== null && value.trim() !== String(preview) && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
          = {preview}
        </span>
      )}
    </div>
  )
}
