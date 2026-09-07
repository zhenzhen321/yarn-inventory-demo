import { InputHTMLAttributes } from 'react'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input inputMode={props.type === 'number' ? (props.step === '1' ? 'numeric' : 'decimal') : undefined}
    className={`min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 read-only:bg-slate-100 disabled:bg-slate-100 ${className}`} {...props} />
}
