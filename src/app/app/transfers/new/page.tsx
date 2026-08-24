import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { TransferForm } from '@/components/transfers/TransferForm'

export default async function NewTransferPage() {
  const [warehouses, inventory] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.inventory.findMany({
      where: { weight: { gt: 0 } },
      include: { warehouse: true, variant: { include: { yarn: true } }, batch: true },
      orderBy: [{ warehouse: { name: 'asc' } }, { variant: { yarn: { name: 'asc' } } }],
    }),
  ])
  const user = await getSessionUser()
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">仓库调拨</h1>
      <TransferForm
        defaultHandler={user?.name ?? '刚'}
        warehouses={warehouses}
        destinations={warehouses}
        inventoryRows={inventory.map((r) => ({
          id: r.id,
          warehouseId: r.warehouseId,
          yarnName: r.variant.yarn.name,
          spec: r.variant.spec,
          color: r.variant.color,
          unit: r.variant.unit,
          batchNo: r.batch.batchNo,
          weight: r.weight.toString(),
          processingFeeSettled: r.processingFeeSettled,
        }))}
      />
    </div>
  )
}
