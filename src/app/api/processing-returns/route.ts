import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { processingReturnSchema } from '@/lib/validation'
import { createProcessingReturn } from '@/services/inventory'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = processingReturnSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const order = await createProcessingReturn(prisma, parsed.data)
    const user = await getSessionUser()
    await logAudit({
      userName: user?.name ?? '未知',
      action: 'PROCESSING_RETURN_CREATE',
      target: '加工收回',
      detail: `单号 ${order.orderNo}，加工费单价 ${order.processingFeePerKg}，运费 ${order.freight}，条目 ${order.items.length}`,
    })
    return NextResponse.json({ orderNo: order.orderNo }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  const orders = await prisma.processingReturn.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      items: {
        include: {
          inventory: { include: { variant: { include: { yarn: true } }, batch: true } },
          variant: { include: { yarn: true } },
        },
      },
      factory: true,
      warehouse: true,
    },
  })
  return NextResponse.json(orders)
}
