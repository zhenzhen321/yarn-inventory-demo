import Link from 'next/link'
import { ExportLink } from '@/components/reports/ExportLink'

export function ReportPageHeader({
  title,
  exportHref,
}: {
  title: string
  exportHref?: string
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Link href="/app/reports" className="text-sm text-blue-600 hover:underline">
          ← 返回报表导航
        </Link>
        <h1 className="mt-1 text-xl font-bold">{title}</h1>
      </div>
      {exportHref && <ExportLink href={exportHref} />}
    </div>
  )
}
