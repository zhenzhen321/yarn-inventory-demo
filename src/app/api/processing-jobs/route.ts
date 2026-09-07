import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { processingJobCompletionSchema } from '@/lib/validation'
import { completeProcessingJobIdempotent } from '@/services/inventory'
import { idempotencyKeyFromRequest } from '@/services/idempotency'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const parsed = processingJobCompletionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }

  try {
    const result = await completeProcessingJobIdempotent(
      prisma,
      { ...parsed.data, handlerName: user.name },
      idempotencyKeyFromRequest(req),
    )
    const completed = result.value
    if (!result.replayed) {
      await logAudit({
        userName: user.name,
        action: 'PROCESSING_JOB_COMPLETE',
        target: '加工完工',
        detail:
          '单号 ' + completed.job.orderNo +
          '，投入 ' + completed.job.inputs.length + ' 批/' + completed.job.inputWeight + 'kg' +
          '，产出 ' + completed.job.outputs.length + ' 批/' + completed.job.outputWeight + 'kg' +
          '，加工费 ' + completed.job.feeTotal +
          '，附加运费 ' + completed.job.returnFreight +
          '，其他费用 ' + completed.job.otherCost,
      })
    }
    return NextResponse.json(
      {
        orderNo: completed.job.orderNo,
        inputs: completed.job.inputs.length,
        outputs: completed.outputs.map(({ lot, inventory, record }) => ({
          yarnName: inventory.variant.yarn.name,
          spec: inventory.variant.spec,
          color: inventory.variant.color,
          unit: inventory.variant.unit,
          batchNo: inventory.batch.batchNo,
          lotNo: lot.lotNo,
          scanCode: lot.scanCode,
          weight: record.weight.toString(),
          packages: record.packages,
        })),
      },
      {
        status: result.replayed ? 200 : 201,
        headers: { 'Idempotent-Replayed': String(result.replayed) },
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : '完工登记失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
