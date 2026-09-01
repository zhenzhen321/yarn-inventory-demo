import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { Table } from '@/components/ui/Table'
import { RevertButton } from '@/components/common/RevertButton'
import { SettlementPageHeader } from '@/components/settlements/SettlementPageHeader'
import { getFactoryFeePayments, getFactoryFeeSummary } from '@/services/factory-fee'
import { STATUS_LABEL } from '@/services/settlement'

export default async function FactoryFeeSettlementsPage() {
  const [fees, payments, user] = await Promise.all([
    getFactoryFeeSummary(prisma),
    getFactoryFeePayments(prisma),
    getSessionUser(),
  ])

  return (
    <div className="space-y-6">
      <SettlementPageHeader title="加工费结算" />

      <section className="space-y-3">
        <h2 className="text-lg font-bold">加工厂欠款清单</h2>
        <Table headers={['加工厂', '加工费总额 (元)', '已付', '未付', '状态', '操作']}>
          {fees.map((fee) => {
            const params = new URLSearchParams({ side: 'PROCESSING_FEE', cp: fee.id })
            return (
              <tr key={fee.id}>
                <td>{fee.name}</td>
                <td>{fee.totalAmount.toString()}</td>
                <td>{fee.paidAmount.toString()}</td>
                <td>{fee.owedAmount.toString()}</td>
                <td>{STATUS_LABEL[fee.status]}</td>
                <td>
                  {fee.status !== 'PAID' ? (
                    <Link
                      href={`/app/settlements/new?${params.toString()}`}
                      className="inline-flex rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                    >
                      去结算
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-400">已结清</span>
                  )}
                </td>
              </tr>
            )
          })}
        </Table>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">加工厂付款记录</h2>
        <Table headers={['加工厂', '日期', '金额 (元)', '方式', '经手人', '操作']}>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td>{payment.factoryName}</td>
              <td>{payment.date.toISOString().slice(0, 10)}</td>
              <td>{payment.amount.toString()}</td>
              <td>{payment.method ?? '-'}</td>
              <td>{payment.handlerName}</td>
              <td>
                {user && user.name === payment.handlerName ? (
                  <RevertButton href={`/api/processing-fee-payments/${payment.id}`} />
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  )
}
