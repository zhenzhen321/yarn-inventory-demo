'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'

const nav = [
  { href: '/app/dashboard', label: '首页' },
  { href: '/app/inventory', label: '库存' },
  { href: '/app/purchases/new', label: '买入入库' },
  { href: '/app/sales/new', label: '卖出出库' },
  { href: '/app/transfers/new', label: '调拨' },
  { href: '/app/settlements', label: '结算' },
]
const more = [
  { title: '其他业务', items: [
    { href: '/app/stocktakes/new', label: '盘库' }, { href: '/app/transfers/return', label: '加工返仓' },
    { href: '/app/orders', label: '出入库记录' }, { href: '/app/reports', label: '报表' },
  ] },
  { title: '基础资料', items: [
    { href: '/app/yarns', label: '纱线' }, { href: '/app/warehouses', label: '仓库' },
    { href: '/app/counterparties', label: '往来单位' }, { href: '/app/audit', label: '日志' },
  ] },
]
const mobile = [nav[0], nav[1], nav[2], nav[3]]
export function AppShell({ userName, children }: { userName: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const [menu, setMenu] = useState(false)
  const [large, setLarge] = useState(false)
  useEffect(() => {
    try { setLarge(localStorage.getItem('yarn-ui:large-text:' + userName) === '1') } catch {}
  }, [userName])
  function toggleTextSize() {
    const next = !large
    setLarge(next)
    try { localStorage.setItem('yarn-ui:large-text:' + userName, next ? '1' : '0') } catch {}
  }
  const active = [...nav, ...more.flatMap((group) => group.items)].reduce<(typeof nav)[number] | null>((best, item) => {
    const root = item.href.endsWith('/new') ? item.href.slice(0, -4) : item.href
    const matches = pathname === item.href || pathname === root || pathname.startsWith(root + '/')
    return matches && (!best || item.href.length > best.href.length) ? item : best
  }, null)
  const navClass = (href: string) => active?.href === href ? 'nav-link nav-active' : 'nav-link'
  return <div className={`app-shell flex min-h-screen flex-col ${large ? 'large-text' : ''}`}>
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/app/dashboard" className="flex items-center gap-3 font-bold">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-700 text-lg text-white" aria-hidden="true">纱</span>
          <span className="text-lg">纱线进销存<span className="block text-xs font-normal text-slate-500 sm:hidden">{active?.label ?? '业务管理'}</span></span>
        </Link>
        <div className="flex items-center gap-3">
          <button type="button" className="choice-chip" aria-pressed={large} onClick={toggleTextSize}>{large ? '标准字' : '大字'}</button>
          <span className="hidden text-sm text-slate-600 sm:inline">{userName}</span>
          <form action="/api/auth/logout" method="post"><button className="min-h-11 text-sm text-slate-600">退出</button></form>
        </div>
      </div>
      <nav aria-label="主导航" className="mx-auto hidden max-w-7xl gap-2 px-4 pb-3 md:flex">
        {nav.map((item) => <Link key={item.href} href={item.href} aria-current={active?.href === item.href ? 'page' : undefined} className={navClass(item.href)}>{item.label}</Link>)}
        <button type="button" className="nav-link" aria-expanded={menu} onClick={() => setMenu(true)}>更多功能 ▾</button>
      </nav>
    </header>
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-5 md:pb-10 md:pt-7">{children}</main>
    <nav aria-label="手机常用导航" className="mobile-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-white px-2 pt-2 md:hidden">
      {mobile.map((item) => <Link key={item.href} href={item.href} className={navClass(item.href)} aria-current={active?.href === item.href ? 'page' : undefined}>{item.label.replace('入库', '').replace('出库', '')}</Link>)}
      <button type="button" className="nav-link" onClick={() => setMenu(true)}>更多</button>
    </nav>
    {menu && <Dialog title="全部功能" onClose={() => setMenu(false)}>
      {[{ title: '常用业务', items: nav }, ...more].map((group) => <section key={group.title} className="mb-6">
        <h3 className="mb-3 font-semibold text-slate-500">{group.title}</h3>
        <div className="grid grid-cols-2 gap-3">{group.items.map((item) =>
          <Link key={item.href} href={item.href} className={navClass(item.href)} onClick={() => setMenu(false)}>{item.label}</Link>)}</div>
      </section>)}
    </Dialog>}
  </div>
}
