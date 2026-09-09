import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { SaleForm } from '@/components/sales/SaleForm'
import { getSaleInventoryOptions } from '@/services/sale-options'
import { getActiveCounterparties, getActiveWarehouses } from '@/lib/master-data-cache'

export default async function NewSalePage() {
  const [warehouses, customers, user] = await Promise.all([
    getActiveWarehouses(),
    getActiveCounterparties(),
    getSessionUser(),
  ])
  const defaultWarehouse = warehouses[0]
  const customersForSale = customers.filter((row) => row.type === 'CUSTOMER' || row.type === 'BOTH')
  const inventoryRows = defaultWarehouse ? await getSaleInventoryOptions(prisma, defaultWarehouse.id) : []
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">卖出出库</h1>
      <SaleForm
        defaultHandler={user?.name ?? '刚'}
        customers={customersForSale}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name, type: w.type }))}
        initialWarehouseId={defaultWarehouse?.id ?? ''}
        inventoryRows={inventoryRows}
      />
    </div>
  )
}
