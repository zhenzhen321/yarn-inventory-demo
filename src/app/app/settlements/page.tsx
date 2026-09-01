import Link from 'next/link'

const settlementLinks = [
  {
    href: '/app/settlements/new',
    title: '登记结算',
    description: '登记供应商付款、客户收款或加工费付款。',
    accent: 'bg-emerald-50 text-emerald-700',
    icon: '记',
  },
  {
    href: '/app/settlements/payables',
    title: '应付供应商',
    description: '查看供应商应付、已付、未付金额并快速结算。',
    accent: 'bg-amber-50 text-amber-700',
    icon: '付',
  },
  {
    href: '/app/settlements/receivables',
    title: '应收客户',
    description: '查看客户应收、已收、未收金额并快速结算。',
    accent: 'bg-blue-50 text-blue-700',
    icon: '收',
  },
  {
    href: '/app/settlements/factory-fees',
    title: '加工费结算',
    description: '查看加工厂欠款、付款记录并登记加工费付款。',
    accent: 'bg-violet-50 text-violet-700',
    icon: '工',
  },
  {
    href: '/app/settlements/records',
    title: '结算记录',
    description: '按类型、往来单位和日期查询、导出或撤回记录。',
    accent: 'bg-slate-100 text-slate-700',
    icon: '查',
  },
]

export default function SettlementsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">资金结算</h1>
        <p className="mt-1 text-sm text-gray-600">选择需要办理或查询的结算功能。</p>
      </div>

      <nav className="grid gap-3 sm:grid-cols-2" aria-label="结算功能">
        {settlementLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center gap-4 rounded-xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg font-bold ${item.accent}`}
              aria-hidden="true"
            >
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-3">
                <span className="font-semibold text-gray-900 group-hover:text-blue-700">
                  {item.title}
                </span>
                <span className="text-blue-600" aria-hidden="true">→</span>
              </span>
              <span className="mt-1 block text-sm leading-5 text-gray-600">
                {item.description}
              </span>
            </span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
