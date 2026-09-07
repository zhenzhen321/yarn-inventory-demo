import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Table } from '@/components/ui/Table'
import { LotBackLink } from '@/components/lots/LotBackLink'
import { OrderTraceLink } from '@/components/orders/OrderTraceLink'
import { CurrentInventoryLabelButton } from '@/components/labels/CurrentInventoryLabelButton'
import { formatBusinessDate } from '@/lib/business-date'

const movementLabels: Record<string, string> = {
  PURCHASE_RECEIPT: '采购入库',
  TRANSFER: '地点移动',
  PROCESS_CONSUME: '加工投入',
  PROCESS_PRODUCE: '加工产出',
  SALE: '销售出库',
  STOCKTAKE: '盘点调整',
  REVERSAL: '撤回反向流水',
}

export default async function LotTracePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const lot = await prisma.inventoryLot.findUnique({
    where: { id },
    include: {
      variant: { include: { yarn: true } },
      batch: true,
      purchaseItem: {
        include: { order: { include: { supplier: true, warehouse: true } } },
      },
      processingOutput: {
        include: {
          job: {
            include: {
              factory: true,
              inputs: {
                include: {
                  lot: {
                    include: {
                      variant: { include: { yarn: true } },
                      batch: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      processingInputs: {
        include: {
          job: {
            include: {
              factory: true,
              outputs: {
                include: {
                  lot: {
                    include: {
                      variant: { include: { yarn: true } },
                      batch: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      inventories: { include: { warehouse: true } },
      movements: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] },
      saleAllocations: {
        include: {
          saleItem: {
            include: {
              order: { include: { customer: true, warehouse: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!lot) notFound()

  const activeBalances = lot.inventories.filter((row) => !row.archived && row.weight.gt(0))
  const remainingWeight = activeBalances.reduce((sum, row) => sum + Number(row.weight), 0)
  const source =
    lot.sourceType === 'PURCHASE'
      ? '采购批次'
      : lot.sourceType === 'PROCESSING'
        ? '加工产出批次'
        : '历史汇总批次（上线前数据无法拆到原始采购批）'

  return (
    <div className="space-y-5">
      <div>
        <LotBackLink />
        <h1 className="mt-2 text-xl font-bold">批次追溯 · {lot.lotNo}</h1>
        <p className="mt-1 text-sm text-gray-600">
          扫码内容：{lot.scanCode} · {source} · 状态 {lot.status}
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">品名</div><div className="font-semibold">{lot.variant.yarn.name}</div></div>
        <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">规格 / 色号</div><div className="font-semibold">{lot.variant.spec} / {lot.variant.color}</div></div>
        <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">批次 / 缸号</div><div className="font-semibold">{lot.batch.batchNo}</div></div>
        <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">初始 / 当前</div><div className="font-semibold">{lot.initialWeight.toString()} / {remainingWeight.toFixed(2)} kg</div></div>
        <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">初始件数</div><div className="font-semibold">{lot.initialPackages ?? '-'}</div></div>
        <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">货物成本</div><div className="font-semibold">¥{lot.goodsCost.toString()}</div></div>
        <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">累计运费</div><div className="font-semibold">¥{lot.freightCost.toString()}</div></div>
        <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">本次加工费</div><div className="font-semibold">¥{lot.processingCost.toString()}</div></div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">来源</h2>
        {lot.purchaseItem ? (
          <div className="rounded border bg-white p-3 text-sm">
            采购单 <OrderTraceLink orderNo={lot.purchaseItem.order.orderNo} orderType="PURCHASE" /> · {formatBusinessDate(lot.purchaseItem.order.date)} ·
            供应商 {lot.purchaseItem.order.supplier.name} · 入库/直送 {lot.purchaseItem.order.warehouse.name} ·
            {lot.purchaseItem.weight.toString()} kg @ ¥{lot.purchaseItem.price.toString()}
            {lot.purchaseItem.order.reversedAt ? ' · 该采购单已撤回' : ''}
          </div>
        ) : lot.processingOutput ? (
          <div className="space-y-2 rounded border bg-white p-3 text-sm">
            <p>
              加工单 {lot.processingOutput.job.orderNo} · 加工厂 {lot.processingOutput.job.factory.name} ·
              投入 {lot.processingOutput.job.inputWeight.toString()} kg → 产出 {lot.processingOutput.job.outputWeight.toString()} kg ·
              差异 {lot.processingOutput.job.weightDiff.toString()} kg · 加工应付 ¥{lot.processingOutput.job.feeTotal.toString()}
            </p>
            <div>
              原料批次：
              {lot.processingOutput.job.inputs.map((input, index) => (
                <span key={input.id}>
                  {index > 0 ? '、' : ''}
                  <Link href={`/app/lots/${input.lot.id}`} className="text-blue-700 hover:underline">
                    {input.lot.lotNo}（{input.lot.variant.yarn.name} {input.lot.batch.batchNo}，{input.weight.toString()} kg）
                  </Link>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            这是上线迁移形成的历史汇总批次，只能从现有库存继续向后精确追踪，无法可靠还原上线前每张采购单。
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">当前位置</h2>
        <Table headers={['地点', '重量 (kg)', '件数', '状态', '标签']}>
          {activeBalances.length === 0 ? (
            <tr><td colSpan={5} className="text-center text-gray-500">当前无可用库存</td></tr>
          ) : activeBalances.map((row) => (
            <tr key={row.id}>
              <td>{row.warehouse.name}</td>
              <td>{row.weight.toString()}</td>
              <td>{row.packages ?? '-'}</td>
              <td>{row.processingFeeSettled ? '成品已核算' : row.warehouse.type === 'FACTORY' ? '待加工' : '可用'}</td>
              <td>
                <CurrentInventoryLabelButton row={{
                  sourceNo: lot.processingOutput?.job.orderNo ?? lot.purchaseItem?.order.orderNo ?? lot.lotNo,
                  warehouseName: row.warehouse.name,
                  yarnName: lot.variant.yarn.name,
                  spec: lot.variant.spec,
                  color: lot.variant.color,
                  unit: lot.variant.unit,
                  batchNo: lot.batch.batchNo,
                  lotNo: lot.lotNo,
                  scanCode: lot.scanCode,
                  weight: row.weight.toString(),
                  packages: row.packages,
                  archived: row.archived,
                }} />
              </td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">流转流水</h2>
        <Table headers={['日期', '动作', '从', '到', '重量', '件数', '关联单据']}>
          {lot.movements.map((movement) => {
            const from = lot.inventories.find((row) => row.warehouseId === movement.fromWarehouseId)?.warehouse.name
            const to = lot.inventories.find((row) => row.warehouseId === movement.toWarehouseId)?.warehouse.name
            return (
              <tr key={movement.id}>
                <td>{formatBusinessDate(movement.occurredAt)}</td>
                <td>{movementLabels[movement.type] ?? movement.type}</td>
                <td>{from ?? '-'}</td>
                <td>{to ?? '-'}</td>
                <td>{movement.weight.toString()} kg</td>
                <td>{movement.packages ?? '-'}</td>
                <td>{movement.referenceType} / {movement.referenceId.slice(0, 12)}</td>
              </tr>
            )
          })}
        </Table>
      </section>

      {lot.saleAllocations.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-bold">销售去向</h2>
          <Table headers={['销售单', '日期', '客户', '出库地点', '重量', '件数', '状态']}>
            {lot.saleAllocations.map((allocation) => (
              <tr key={allocation.id}>
                <td><OrderTraceLink orderNo={allocation.saleItem.order.orderNo} orderType="SALE" /></td>
                <td>{formatBusinessDate(allocation.saleItem.order.date)}</td>
                <td>{allocation.saleItem.order.customer.name}</td>
                <td>{allocation.saleItem.order.warehouse.name}</td>
                <td>{allocation.weight.toString()} kg</td>
                <td>{allocation.packages ?? '-'}</td>
                <td>{allocation.saleItem.order.reversedAt ? '已撤回' : '有效'}</td>
              </tr>
            ))}
          </Table>
        </section>
      )}

      {lot.processingInputs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-bold">后续加工产出</h2>
          <div className="rounded border bg-white p-3 text-sm">
            {lot.processingInputs.flatMap((input) =>
              input.job.outputs.map((output) => (
                <div key={output.id}>
                  {input.job.orderNo}：
                  <Link href={`/app/lots/${output.lot.id}`} className="text-blue-700 hover:underline">
                    {output.lot.lotNo}（{output.lot.variant.yarn.name} {output.lot.batch.batchNo}，{output.weight.toString()} kg）
                  </Link>
                </div>
              )),
            )}
          </div>
        </section>
      )}
    </div>
  )
}
