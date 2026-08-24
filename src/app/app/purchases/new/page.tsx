import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { PurchaseForm } from '@/components/purchases/PurchaseForm'

export default async function NewPurchasePage() {
  const [products, warehouses, counterparties] = await Promise.all([
    prisma.yarn.findMany({
      where: { active: true },
      include: {
        variants: { where: { active: true }, orderBy: [{ spec: 'asc' }, { color: 'asc' }] },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.counterparty.findMany({
      where: { active: true, type: { in: ['SUPPLIER', 'BOTH'] } },
      orderBy: { name: 'asc' },
    }),
  ])
  const user = await getSessionUser()
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">买入入库</h1>
      <PurchaseForm
        defaultHandler={user?.name ?? '刚'}
        products={products
          .filter((p) => p.variants.length > 0)
          .map((p) => ({
            id: p.id,
            name: p.name,
            variants: p.variants.map((v) => ({
              id: v.id,
              spec: v.spec,
              color: v.color,
              unit: v.unit,
            })),
          }))}
        warehouses={warehouses}
        suppliers={counterparties}
      />
    </div>
  )
}
