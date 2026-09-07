import Link from 'next/link'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Table } from '@/components/ui/Table'
import { formatBusinessDate } from '@/lib/business-date'

export default async function TransfersPage() {
  const [orders, returns] = await Promise.all([
    prisma.transferOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { fromWarehouse: true, toWarehouse: true, items: true },
    }),
    prisma.processingReturn.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        items: {
          include: {
            inventory: { include: { variant: { include: { yarn: true } }, batch: true } },
            variant: { include: { yarn: true } },
          },
        },
        factory: true,
        warehouse: true,
      },
    }),
  ])
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">调拨记录</h1>
        <div className="flex gap-2">
          <Link
            href="/app/transfers/new"
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            新建调拨
          </Link>
        </div>
      </div>
      <Table
        headers={['单号', '日期', '来源', '目标', '经办人', '运费 (元)', '条目数']}
      >
        {orders.map((o) => (
          <tr key={o.id}>
            <td>{o.orderNo}</td>
            <td>{formatBusinessDate(o.date)}</td>
            <td>
              {o.fromWarehouse.name}
              {o.fromWarehouse.type === 'FACTORY' ? '（加工厂）' : ''}
            </td>
            <td>
              {o.toWarehouse.name}
              {o.toWarehouse.type === 'FACTORY' ? '（加工厂）' : ''}
            </td>
            <td>{o.handlerName}</td>
            <td>{o.freight.toString()}</td>
            <td>{o.items.length}</td>
          </tr>
        ))}
      </Table>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">加工收回记录</h2>
        <Table
          headers={[
            '单号',
            '日期',
            '加工厂',
            '目标仓库',
            '原纱线',
            '新纱线',
            '运费 (元)',
            '新单位成本 (元/kg)',
            '新单位运费 (元/kg)',
            '预计毛利 (元)',
          ]}
        >
          {returns.map((o) =>
            o.items.map((it) => {
              const unitCost = it.newCost.div(it.outputWeight)
              const unitFreight = it.newFreight.div(it.outputWeight)
              const profit = o.expectedSellPricePerKg
                ? new Prisma.Decimal(o.expectedSellPricePerKg)
                    .minus(unitCost)
                    .minus(unitFreight)
                    .mul(it.outputWeight)
                    .toFixed(2)
                : '-'
              return (
                <tr key={it.id}>
                  <td>{o.orderNo}</td>
                  <td>{formatBusinessDate(o.date)}</td>
                  <td>{o.factory.name}</td>
                  <td>{o.warehouse.name}</td>
                  <td>
                    {it.inventory.variant.yarn.name} {it.inventory.variant.spec}{' '}
                    {it.inventory.variant.color} {it.inventory.variant.unit} 批次
                    {it.inventory.batch.batchNo} {it.weight.toString()}kg
                  </td>
                  <td>
                    {it.variant.yarn.name} {it.variant.spec} {it.variant.color} {it.variant.unit}{' '}
                    批次{it.batchNo} {it.outputWeight.toString()}kg
                  </td>
                  <td>{o.freight.toString()}</td>
                  <td>{unitCost.toFixed(2)}</td>
                  <td>{unitFreight.toFixed(2)}</td>
                  <td>{profit}</td>
                </tr>
              )
            }),
          )}
        </Table>
      </section>
    </div>
  )
}
