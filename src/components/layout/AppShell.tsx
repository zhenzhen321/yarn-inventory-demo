'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/app/dashboard', label: '首页' },
  { href: '/app/inventory', label: '库存' },
  { href: '/app/purchases/new', label: '买入入库' },
  { href: '/app/sales/new', label: '卖出出库' },
  { href: '/app/transfers/new', label: '调拨' },
  { href: '/app/stocktakes/new', label: '盘库' },
  { href: '/app/settlements', label: '结算' },
  { href: '/app/reports', label: '报表' },
  { href: '/app/audit', label: '日志' },
  { href: '/app/orders', label: '出入库记录' },
  { href: '/app/yarns', label: '纱线' },
  { href: '/app/warehouses', label: '仓库' },
  { href: '/app/counterparties', label: '往来单位' },
]

export function AppShell({ userName, children }: { userName: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const active = nav.reduce<(typeof nav)[number] | null>((best, item) => {
    const matches = pathname === item.href || pathname.startsWith(item.href + '/')
    return matches && (!best || item.href.length > best.href.length) ? item : best
  }, null)

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/app/dashboard" className="text-lg font-bold">
            纱线进销存
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span>{userName}</span>
            <form action="/api/auth/logout" method="post">
              <button className="text-blue-600">退出</button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 pb-2 text-sm">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={
                active?.href === n.href
                  ? 'whitespace-nowrap rounded-md bg-blue-600 px-3 py-1.5 text-white'
                  : 'whitespace-nowrap rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-100'
              }
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  )
}
