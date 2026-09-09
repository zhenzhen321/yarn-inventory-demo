import { getActiveCounterparties, getActiveWarehouses, getPurchaseProducts } from '@/lib/master-data-cache'
import { getSessionUser } from '@/lib/auth'
import { PurchaseForm } from '@/components/purchases/PurchaseForm'

export default async function NewPurchasePage() {
  const [products, warehouses, counterparties, user] = await Promise.all([
    getPurchaseProducts(), getActiveWarehouses(), getActiveCounterparties(), getSessionUser(),
  ])
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">买入入库</h1>
      <PurchaseForm
        defaultHandler={user?.name ?? '刚'}
        products={products.map((p) => ({
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
        suppliers={counterparties.filter((row) => row.type === 'SUPPLIER' || row.type === 'BOTH')}
      />
    </div>
  )
}
