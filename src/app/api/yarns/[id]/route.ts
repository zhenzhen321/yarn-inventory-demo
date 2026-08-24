import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { yarnUpdateSchema } from '@/lib/validation'
import { requireAdmin } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { deleteYarnSafe } from '@/services/deletion'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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
  const row = await prisma.yarn
    .update({ where: { id: params.id }, data: parsed.data })
    .catch(() => null)
  if (!row) return NextResponse.json({ error: '记录不存在' }, { status: 404 })
  await logAudit({
    userName: admin.name,
    action: 'YARN_UPDATE',
    target: '纱线',
    detail: JSON.stringify(parsed.data),
  })
  return NextResponse.json(row)
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin().catch(() => null)
  if (!admin) return NextResponse.json({ error: '无权限：仅最高管理员可删除' }, { status: 403 })
  try {
    const row = await deleteYarnSafe(prisma, params.id)
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
