import { unstable_cache, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'

const TAG = 'master-data-options-v1'
const options = { revalidate: 30, tags: [TAG] }

// Shared reference data only. Never put cookies, users, balances or inventory here.
export const getActiveWarehouses = unstable_cache(
  () => prisma.warehouse.findMany({
    where: { active: true }, orderBy: { name: 'asc' },
    select: { id: true, name: true, type: true, stocktakeIntervalDays: true },
  }), ['active-warehouses-v1'], options,
)

export const getActiveCounterparties = unstable_cache(
  () => prisma.counterparty.findMany({
    where: { active: true }, orderBy: { name: 'asc' },
    select: { id: true, name: true, type: true },
  }), ['active-counterparties-v1'], options,
)

export const getPurchaseProducts = unstable_cache(
  () => prisma.yarn.findMany({
    where: { active: true }, orderBy: { name: 'asc' },
    select: { id: true, name: true, variants: {
      where: { active: true }, orderBy: [{ spec: 'asc' }, { color: 'asc' }],
      select: { id: true, spec: true, color: true, unit: true },
    } },
  }), ['purchase-products-v1'], options,
)

// Route handlers expire immediately, so the next navigation sees the write.
export function invalidateMasterData() {
  revalidateTag(TAG, { expire: 0 })
}
