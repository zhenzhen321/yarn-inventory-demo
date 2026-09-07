import { ReactNode } from 'react'

export function Notice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' | 'info' }) {
  if (!children) return null
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`notice notice-${tone}`}>{children}</div>
}
