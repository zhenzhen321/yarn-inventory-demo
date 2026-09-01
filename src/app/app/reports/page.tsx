import Link from 'next/link'

const reportLinks = [
  {
    href: '/app/reports/customer-orders',
    title: '客户订单查询',
    description: '按客户查看卖出订单、货款和运费。',
  },
  {
    href: '/app/reports/supplier-orders',
    title: '供应商订单查询',
    description: '按供应商查看买入订单、货款和运费。',
  },
  {
    href: '/app/reports/settlements',
    title: '结算记录',
    description: '查看客户收款与供应商付款记录。',
  },
  {
    href: '/app/reports/profit',
    title: '毛利估算',
    description: '汇总销售额、成本与运费，估算当前毛利。',
  },
  {
    href: '/app/reports/inventory',
    title: '库存金额',
    description: '按仓库查看库存重量和库存成本。',
  },
  {
    href: '/app/reports/payables',
    title: '应付供应商',
    description: '查看供应商应付、已付和未付金额。',
  },
  {
    href: '/app/reports/receivables',
    title: '应收客户',
    description: '查看客户应收、已收和未收金额。',
  },
  {
    href: '/app/reports/flow',
    title: '近 30 天进出流水',
    description: '集中查看最近 30 天的买入和卖出流水。',
  },
]

export default function ReportsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">报表</h1>
        <p className="mt-1 text-sm text-gray-600">选择需要查看的报表。</p>
      </div>

      <nav className="grid gap-3 sm:grid-cols-2" aria-label="报表功能">
        {reportLinks.map((report) => (
          <Link
            key={report.href}
            href={report.href}
            className="group rounded-lg border bg-white p-4 transition hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-gray-900 group-hover:text-blue-700">
                {report.title}
              </h2>
              <span className="text-blue-600" aria-hidden="true">
                →
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{report.description}</p>
          </Link>
        ))}
      </nav>
    </div>
  )
}
