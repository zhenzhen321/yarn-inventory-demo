import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { yarnUpdateSchema } from '@/lib/validation'
import { requireAdmin } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { deleteYarnSafe } from '@/services/deletion'
import { updateYarnMaster } from '@/services/yarns'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdmin().catch(() => null)
  if (!admin) return NextResponse.json({ error: '无权限：仅最高管理员可修改' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const parsed = yarnUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: '没有需要修改的内容' }, { status: 400 })
  }
  let result
  try {
    result = await updateYarnMaster(prisma, id, parsed.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : '修改失败'
    const status = message === '纱线不存在' ? 404 : message.startsWith('已存在') ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
  await logAudit({
    userName: admin.name,
    action: 'YARN_UPDATE',
    target: '纱线',
    detail: result.renamed
      ? `全局更名：${result.previousName} → ${result.row.name}，关联规格 ${result.relatedVariantCount} 个，同步批次 ${result.renamedBatchCount} 个、历史批次文字 ${result.renamedSnapshotCount} 条；库存、订单和报表通过主档关联同步显示`
      : `修改纱线：${result.row.name}，${JSON.stringify(parsed.data)}`,
  })
  return NextResponse.json({
    ...result.row,
    renameImpact: {
      renamed: result.renamed,
      previousName: result.previousName,
      relatedVariantCount: result.relatedVariantCount,
      renamedBatchCount: result.renamedBatchCount,
      renamedSnapshotCount: result.renamedSnapshotCount,
    },
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdmin().catch(() => null)
  if (!admin) return NextResponse.json({ error: '无权限：仅最高管理员可删除' }, { status: 403 })
  try {
    const row = await deleteYarnSafe(prisma, id)
    await logAudit({
      userName: admin.name,
      action: 'YARN_DELETE',
      target: '纱线',
      detail: `名称：${row.name}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : '删除失败'
    return NextResponse.json(
      { error: message },
      { status: message === '记录不存在' ? 404 : 400 },
    )
  }
}
