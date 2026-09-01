import Link from 'next/link'
import { ExportLink } from '@/components/reports/ExportLink'

export function SettlementPageHeader({
  title,
  description,
  exportHref,
}: {
  title: string
  description?: string
  exportHref?: string
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Link href="/app/settlements" className="text-sm text-blue-600 hover:underline">
          ← 返回结算导航
        </Link>
        <h1 className="mt-1 text-xl font-bold">{title}</h1>
        {description ? <p className="mt-1 text-sm text-gray-600">{description}</p> : null}
      </div>
      {exportHref ? <ExportLink href={exportHref} /> : null}
    </div>
  )
}
