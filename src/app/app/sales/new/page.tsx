import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { SaleForm } from '@/components/sales/SaleForm'

export default async function NewSalePage() {
  const [warehouses, customers, inventory] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.counterparty.findMany({
      where: { active: true, type: { in: ['CUSTOMER', 'BOTH'] } },
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
      <h1 className="text-xl font-bold">卖出出库</h1>
      <SaleForm
        defaultHandler={user?.name ?? 'admin'}
        customers={customers}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name, type: w.type }))}
        inventoryRows={inventory.map((r) => ({
          id: r.id,
          warehouseId: r.warehouseId,
          warehouseName: r.warehouse.name,
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
