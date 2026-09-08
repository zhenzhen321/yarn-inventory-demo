import Link from 'next/link'

export function Pager({
  page,
  totalPages,
  buildHref,
  basePath,
  params = {},
  label = '翻页',
}: {
  page: number
  totalPages: number
  buildHref: (page: number) => string
  /** 传入后显示"第 [输入框] / n 页"跳转表单（无脚本也能用） */
  basePath?: string
  /** 跳转时需要保留的其他查询参数 */
  params?: Record<string, string | undefined>
  label?: string
}) {
  const current = Math.min(Math.max(1, page), totalPages)
  if (totalPages <= 1) return null
  const chip = 'choice-chip min-w-20'
  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label={label}>
      {current > 1 ? (
        <Link className={chip} href={buildHref(current - 1)}>
          上一页
        </Link>
      ) : (
        <span className={`${chip} pointer-events-none opacity-50`}>上一页</span>
      )}
      {basePath ? (
        <form action={basePath} method="get" className="flex items-center gap-1 text-sm text-slate-600">
          {Object.entries(params)
            .filter(([, value]) => value)
            .map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
          <label className="flex items-center gap-1">
            第
            <input
              type="number"
              name="page"
              min={1}
              max={totalPages}
              defaultValue={current}
              aria-label="跳转到页"
              className="h-9 w-16 rounded-lg border border-slate-300 bg-white px-1 text-center text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            / {totalPages} 页
          </label>
          <button type="submit" className="choice-chip">
            跳转
          </button>
        </form>
      ) : (
        <span className="text-sm text-slate-600">
          第 {current} / {totalPages} 页
        </span>
      )}
      {current < totalPages ? (
        <Link className={chip} href={buildHref(current + 1)}>
          下一页
        </Link>
      ) : (
        <span className={`${chip} pointer-events-none opacity-50`}>下一页</span>
      )}
    </nav>
  )
}
