import { PrismaClient } from '@prisma/client'

export async function archiveZeroInventory(db: PrismaClient, warehouseId: string) {
  const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId } })
  if (!warehouse) throw new Error('仓库不存在')
  const res = await db.inventory.updateMany({
    where: { warehouseId, weight: 0, archived: false },
    data: { archived: true },
  })
  return { count: res.count, warehouseName: warehouse.name }
}

export interface InventoryFilter {
  warehouseId?: string
  yarnId?: string
  q?: string
  includeZero?: boolean
}

export function getInventoryRows(db: PrismaClient, filter: InventoryFilter) {
  return db.inventory.findMany({
    where: {
      archived: false,
      warehouseId: filter.warehouseId || undefined,
      ...(filter.includeZero ? {} : { weight: { gt: 0 } }),
      variant: {
        ...(filter.yarnId ? { yarnId: filter.yarnId } : {}),
        ...(filter.q
          ? {
              OR: [
                { yarn: { name: { contains: filter.q } } },
                { color: { contains: filter.q } },
                { spec: { contains: filter.q } },
              ],
            }
          : {}),
      },
    },
    include: {
      warehouse: true,
      variant: { include: { yarn: true } },
      batch: true,
      lot: {
        include: {
          purchaseItem: {
            include: {
              order: { select: { id: true, orderNo: true, date: true } },
            },
          },
          processingOutput: {
            include: {
              job: { select: { id: true, orderNo: true, date: true } },
            },
          },
        },
      },
    },
    orderBy: [
      { warehouse: { name: 'asc' } },
      { variant: { yarn: { name: 'asc' } } },
      { batch: { batchNo: 'asc' } },
    ],
  })
}
