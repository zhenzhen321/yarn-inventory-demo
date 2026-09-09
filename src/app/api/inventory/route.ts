import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getInventoryRows } from '@/services/inventory'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const rows = await getInventoryRows(prisma, {
    warehouseId: url.searchParams.get('warehouseId') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    includeZero: url.searchParams.get('includeZero') === '1',
  })
  return NextResponse.json(rows, { headers: { 'Cache-Control': 'no-store' } })
}
