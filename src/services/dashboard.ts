import { PrismaClient } from '@prisma/client'

// Keep the original two populations: positive, unarchived balances for weight/
// counts; all unarchived balances for valuation (including zero-weight costs).
export async function getDashboardInventory(db: PrismaClient) {
  const [positive, costs, batchKeys] = await Promise.all([
    db.inventory.groupBy({
      by: ['warehouseId'], where: { archived: false, weight: { gt: 0 } },
      _sum: { weight: true }, _count: { _all: true },
    }),
    db.inventory.groupBy({ by: ['warehouseId'], where: { archived: false }, _sum: { cost: true } }),
    db.$queryRaw<{ warehouseId: string; batches: bigint }[]>`
      SELECT warehouseId, COUNT(DISTINCT COALESCE(lotId, batchId)) AS batches
      FROM Inventory WHERE archived = 0 AND weight > 0 GROUP BY warehouseId
    `,
  ])
  const costMap = new Map(costs.map(row => [row.warehouseId, Number(row._sum.cost?.toDecimalPlaces(2) ?? 0)]))
  const batchMap = new Map(batchKeys.map(row => [row.warehouseId, Number(row.batches)]))
  const positiveMap = new Map(positive.map(row => [row.warehouseId, row]))
  const warehouseIds = new Set([...costMap.keys(), ...positiveMap.keys()])
  return {
    balanceCount: positive.reduce((sum, row) => sum + row._count._all, 0),
    byWarehouse: new Map([...warehouseIds].map(id => [id, {
      weight: Number(positiveMap.get(id)?._sum.weight ?? 0),
      batches: batchMap.get(id) ?? 0,
      value: costMap.get(id) ?? 0,
    }])),
  }
}
