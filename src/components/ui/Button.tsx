import { ButtonHTMLAttributes } from 'react'

export function Button({ className = '', variant = 'primary', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const colors = variant === 'secondary' ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
    : variant === 'danger' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-blue-600 text-white hover:bg-blue-700'
  return <button className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 font-semibold shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 ${colors} ${className}`} {...props} />
}
