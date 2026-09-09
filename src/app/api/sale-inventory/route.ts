import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { findSaleInventoryOption, getSaleInventoryOptions } from '@/services/sale-options'

const schema = z.object({ warehouseId: z.string().min(1), code: z.string().optional() })

export async function GET(req: Request) {
  if (!(await getSessionUser())) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const parsed = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: '仓库参数不正确' }, { status: 400 })
  const { warehouseId, code } = parsed.data
  const result = code
    ? await findSaleInventoryOption(prisma, warehouseId, code)
    : await getSaleInventoryOptions(prisma, warehouseId)
  const response = NextResponse.json(code ? { row: result } : { rows: result })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
