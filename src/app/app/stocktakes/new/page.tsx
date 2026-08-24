import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { StocktakeForm } from '@/components/stocktakes/StocktakeForm'

export default async function NewStocktakePage() {
  const [warehouses, inventory, zeroRows] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.inventory.findMany({
      where: { archived: false, weight: { gt: 0 } },
      include: { warehouse: true, variant: { include: { yarn: true } }, batch: true },
      orderBy: [{ warehouse: { name: 'asc' } }, { variant: { yarn: { name: 'asc' } } }],
    }),
    prisma.inventory.findMany({
      where: { archived: false, weight: 0 },
      select: { warehouseId: true },
    }),
  ])
  const user = await getSessionUser()
  const zeroCountByWarehouse: Record<string, number> = {}
  for (const z of zeroRows) {
    zeroCountByWarehouse[z.warehouseId] = (zeroCountByWarehouse[z.warehouseId] ?? 0) + 1
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">盘库</h1>
      <StocktakeForm
        defaultHandler={user?.name ?? 'admin'}
        warehouses={warehouses}
        inventoryRows={inventory.map((r) => ({
          id: r.id,
          warehouseId: r.warehouseId,
          yarnName: r.variant.yarn.name,
          spec: r.variant.spec,
          color: r.variant.color,
          unit: r.variant.unit,
          batchNo: r.batch.batchNo,
          weight: r.weight.toString(),
        }))}
        zeroCountByWarehouse={zeroCountByWarehouse}
      />
    </div>
  )
}
