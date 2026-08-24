import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { archiveZeroSchema } from '@/lib/validation'
import { archiveZeroInventory } from '@/services/inventory'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = archiveZeroSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const result = await archiveZeroInventory(prisma, parsed.data.warehouseId)
    const user = await getSessionUser()
    await logAudit({
      userName: user?.name ?? '未知',
      action: 'INVENTORY_ARCHIVE_ZERO',
      target: '盘掉0kg库存',
      detail: `仓库 ${result.warehouseName}，清理 ${result.count} 条 0kg 库存`,
    })
    return NextResponse.json({ count: result.count })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
