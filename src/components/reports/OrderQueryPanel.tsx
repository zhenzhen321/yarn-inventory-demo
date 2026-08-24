'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Select } from '@/components/ui/Select'

export function OrderQueryPanel({
  entityLabel,
  idParam,
  selectedId,
  options,
  baseParams,
}: {
  entityLabel: string
  idParam: string
  selectedId: string
  options: { id: string; name: string }[]
  baseParams: Record<string, string>
}) {
  const router = useRouter()
  const pathname = usePathname()

  function go(id: string) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries({ ...baseParams, [idParam]: id })) {
      if (value) params.set(key, value)
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={selectedId} onChange={(e) => go(e.target.value)} className="max-w-64">
        <option value="">选择{entityLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </div>
  )
}
