'use client'

import { useRouter } from 'next/navigation'

export function SettleScrollLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => {
        router.push(href)
        requestAnimationFrame(() => {
          document
            .getElementById('settle-form')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }}
      className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
    >
      {children}
    </button>
  )
}
