export function ExportLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="rounded border border-blue-600 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50"
    >
      导出 Excel
    </a>
  )
}
