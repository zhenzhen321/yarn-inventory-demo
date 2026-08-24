import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { ProcessingReturnForm } from '@/components/transfers/ProcessingReturnForm'

export default async function ProcessingReturnPage() {
  const [factories, warehouses, inventory] = await Promise.all([
    prisma.warehouse.findMany({
      where: { active: true, type: 'FACTORY' },
      orderBy: { name: 'asc' },
    }),
    prisma.warehouse.findMany({
      where: { active: true, type: 'WAREHOUSE' },
      orderBy: { name: 'asc' },
    }),
    prisma.inventory.findMany({
      where: { weight: { gt: 0 } },
      include: { warehouse: true, variant: { include: { yarn: true } }, batch: true },
      orderBy: [{ warehouse: { name: 'asc' } }, { variant: { yarn: { name: 'asc' } } }],
    }),
  ])
  const user = await getSessionUser()
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">加工收回</h1>
      <ProcessingReturnForm
        defaultHandler={user?.name ?? 'admin'}
        factories={factories}
        warehouses={warehouses}
        factoryRows={inventory
          .filter((r) => r.warehouse.type === 'FACTORY')
          .map((r) => ({
            id: r.id,
            warehouseId: r.warehouseId,
            yarnName: r.variant.yarn.name,
            spec: r.variant.spec,
            color: r.variant.color,
            unit: r.variant.unit,
            batchNo: r.batch.batchNo,
            weight: r.weight.toString(),
            cost: r.cost.toString(),
            freight: r.freight.toString(),
            processingFeeSettled: r.processingFeeSettled,
          }))}
      />
    </div>
  )
}
