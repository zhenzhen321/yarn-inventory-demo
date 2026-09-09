import { Prisma, PrismaClient } from '@prisma/client'

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

export const INVENTORY_GROUP_PAGE_SIZE = 20

const inventoryInclude = {
  warehouse: true,
  variant: { include: { yarn: true } },
  batch: true,
  lot: {
    include: {
      purchaseItem: { include: { order: { select: { id: true, orderNo: true, date: true } } } },
      processingOutput: { include: { job: { select: { id: true, orderNo: true, date: true } } } },
    },
  },
} as const

function sqlFilter(filter: InventoryFilter) {
  return Prisma.sql`
    i.archived = 0
    ${filter.warehouseId ? Prisma.sql`AND i.warehouseId = ${filter.warehouseId}` : Prisma.empty}
    ${filter.includeZero ? Prisma.empty : Prisma.sql`AND i.weight > 0`}
    ${filter.yarnId ? Prisma.sql`AND v.yarnId = ${filter.yarnId}` : Prisma.empty}
    ${filter.q ? Prisma.sql`AND (y.name LIKE ${`%${filter.q}%`} OR v.color LIKE ${`%${filter.q}%`} OR v.spec LIKE ${`%${filter.q}%`})` : Prisma.empty}
  `
}

/** Fetches complete rows for a page of source-document groups. */
export async function getInventoryPage(
  db: PrismaClient,
  filter: InventoryFilter,
  page = 1,
  pageSize = INVENTORY_GROUP_PAGE_SIZE,
) {
  const safePage = Math.max(1, Math.floor(page) || 1)
  const safeSize = Math.max(1, Math.floor(pageSize) || INVENTORY_GROUP_PAGE_SIZE)
  return db.$transaction(async (tx) => {
    const whereSql = sqlFilter(filter)
    const totalGroupsRows = await tx.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS count FROM (
        SELECT i.warehouseId, COALESCE(l.sourceType, 'LEGACY_AGGREGATED') AS sourceType,
          COALESCE(po.id, pj.id, l.id, i.id) AS sourceId
        FROM Inventory i
        JOIN Warehouse w ON w.id = i.warehouseId JOIN YarnVariant v ON v.id = i.variantId
        JOIN Yarn y ON y.id = v.yarnId JOIN Batch b ON b.id = i.batchId
        LEFT JOIN InventoryLot l ON l.id = i.lotId
        LEFT JOIN PurchaseItem pi ON pi.lotId = l.id LEFT JOIN PurchaseOrder po ON po.id = pi.orderId
        LEFT JOIN ProcessingOutput pox ON pox.lotId = l.id LEFT JOIN ProcessingJob pj ON pj.id = pox.jobId
        WHERE ${whereSql}
        GROUP BY i.warehouseId, sourceType, sourceId
      ) grouped
    `)
    const totalGroups = Number(totalGroupsRows[0]?.count ?? 0)
    const totalPages = Math.max(1, Math.ceil(totalGroups / safeSize))
    const effectivePage = Math.min(safePage, totalPages)
    const groups = await tx.$queryRaw<Array<{
      warehouseId: string
      sourceType: string
      sourceId: string
    }>>(Prisma.sql`
      WITH matching AS (
        SELECT i.id, i.warehouseId,
          COALESCE(l.sourceType, 'LEGACY_AGGREGATED') AS sourceType,
          COALESCE(po.id, pj.id, l.id, i.id) AS sourceId,
          w.name AS warehouseName, y.name AS yarnName, b.batchNo
        FROM Inventory i
        JOIN Warehouse w ON w.id = i.warehouseId
        JOIN YarnVariant v ON v.id = i.variantId
        JOIN Yarn y ON y.id = v.yarnId
        JOIN Batch b ON b.id = i.batchId
        LEFT JOIN InventoryLot l ON l.id = i.lotId
        LEFT JOIN PurchaseItem pi ON pi.lotId = l.id
        LEFT JOIN PurchaseOrder po ON po.id = pi.orderId
        LEFT JOIN ProcessingOutput pox ON pox.lotId = l.id
        LEFT JOIN ProcessingJob pj ON pj.id = pox.jobId
        WHERE ${whereSql}
      ), ranked AS (
        SELECT warehouseId, sourceType, sourceId, warehouseName, yarnName, batchNo, id,
          ROW_NUMBER() OVER (
            PARTITION BY warehouseId, sourceType, sourceId
            ORDER BY warehouseName ASC, yarnName ASC, batchNo ASC, id ASC
          ) AS groupRow
        FROM matching
      )
      SELECT warehouseId, sourceType, sourceId FROM ranked
      WHERE groupRow = 1
      ORDER BY warehouseName ASC, yarnName ASC, batchNo ASC, id ASC
      LIMIT ${safeSize} OFFSET ${(effectivePage - 1) * safeSize}
    `)

    const totals = await tx.inventory.aggregate({
      where: {
        archived: false,
        warehouseId: filter.warehouseId || undefined,
        ...(filter.includeZero ? {} : { weight: { gt: 0 } }),
        variant: {
          ...(filter.yarnId ? { yarnId: filter.yarnId } : {}),
          ...(filter.q ? { OR: [{ yarn: { name: { contains: filter.q } } }, { color: { contains: filter.q } }, { spec: { contains: filter.q } }] } : {}),
        },
      },
      _count: { _all: true },
      _sum: { weight: true },
    })

    let rows: Awaited<ReturnType<typeof getInventoryRows>> = []
    if (groups.length) {
      const conditions = groups.map((group) => Prisma.sql`(i.warehouseId = ${group.warehouseId} AND COALESCE(l.sourceType, 'LEGACY_AGGREGATED') = ${group.sourceType} AND COALESCE(po.id, pj.id, l.id, i.id) = ${group.sourceId})`)
      const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT i.id FROM Inventory i JOIN YarnVariant v ON v.id = i.variantId JOIN Yarn y ON y.id = v.yarnId
        JOIN Batch b ON b.id = i.batchId LEFT JOIN InventoryLot l ON l.id = i.lotId
        LEFT JOIN PurchaseItem pi ON pi.lotId = l.id LEFT JOIN PurchaseOrder po ON po.id = pi.orderId
        LEFT JOIN ProcessingOutput pox ON pox.lotId = l.id LEFT JOIN ProcessingJob pj ON pj.id = pox.jobId
        WHERE ${whereSql} AND (${Prisma.join(conditions, ' OR ')})
      `)
      rows = await tx.inventory.findMany({
        where: { id: { in: ids.map((item) => item.id) } },
        include: inventoryInclude,
        orderBy: [{ warehouse: { name: 'asc' } }, { variant: { yarn: { name: 'asc' } } }, { batch: { batchNo: 'asc' } }, { id: 'asc' }],
      })
    }
    return { rows, page: effectivePage, totalPages, totalGroups, totalRows: totals._count._all, totalWeight: totals._sum.weight ?? 0 }
  })
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
    include: inventoryInclude,
    orderBy: [
      { warehouse: { name: 'asc' } },
      { variant: { yarn: { name: 'asc' } } },
      { batch: { batchNo: 'asc' } },
      { id: 'asc' },
    ],
  })
}
