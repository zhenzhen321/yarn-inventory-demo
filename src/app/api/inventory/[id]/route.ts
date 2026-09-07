import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { settleProcessingFeeIdempotent } from '@/services/inventory'
import { businessDateFromInput } from '@/lib/business-date'
import { idempotencyKeyFromRequest } from '@/services/idempotency'

const feeSchema = z.object({
  date: z.string().transform((value, ctx) => {
    try {
      return businessDateFromInput(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: '业务日期不正确' })
      return z.NEVER
    }
  }),
  processingFeePerKg: z.coerce.number().nonnegative('加工费不能为负'),
  inputWeight: z.coerce.number().positive('本次加工重量必须大于 0').optional(),
  inputPackages: z.coerce.number().int().nonnegative('投入件数不能为负').optional().nullable(),
  spec: z.string().optional(),
  color: z.string().optional(),
  unit: z.string().optional(),
  batchNo: z.string().optional(),
  outputWeight: z.coerce.number().positive('加工后重量必须大于 0').optional(),
  outputPackages: z.coerce.number().int().nonnegative('加工后件数不能为负').optional().nullable(),
  note: z.string().optional().nullable(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const parsed = feeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数不正确' },
      { status: 400 },
    )
  }
  try {
    const operation = await settleProcessingFeeIdempotent(prisma, id, {
      feePerKg: parsed.data.processingFeePerKg,
      inputWeight: parsed.data.inputWeight,
      inputPackages: parsed.data.inputPackages,
      handlerName: user.name,
      spec: parsed.data.spec,
      color: parsed.data.color,
      unit: parsed.data.unit,
      batchNo: parsed.data.batchNo,
      outputWeight: parsed.data.outputWeight,
      outputPackages: parsed.data.outputPackages,
      date: parsed.data.date,
      note: parsed.data.note,
    }, idempotencyKeyFromRequest(req))
    const result = operation.value
    if (!operation.replayed) await logAudit({
      userName: user.name,
      action: 'INVENTORY_PROCESSING_FEE',
      target: '结算加工费',
      detail: `仓库 ${result.row.warehouse.name}，纱线 ${result.row.variant.yarn.name}，加工前 ${result.row.variant.spec}/${result.row.variant.color}/${result.row.variant.unit} 批次${result.row.batch.batchNo} ${result.row.weight}kg，本次加工 ${result.inputWeight}kg → ${result.identityChanged ? '加工后' : '保持'} ${result.newSpec}/${result.newColor}/${result.newUnit} 批次${result.newBatchNo} ${result.outputWeight}kg，剩余 ${result.remainingWeight}kg，加工费 ${result.fee} 元/kg，合计 ${result.feeTotal}，新单位成本 ${result.newUnitCost}`,
    })
    return NextResponse.json(
      {
        ok: true,
        orderNo: result.job.orderNo,
        lotNo: result.outputLot.lotNo,
        scanCode: result.outputLot.scanCode,
        yarnName: result.row.variant.yarn.name,
        spec: result.newSpec,
        color: result.newColor,
        unit: result.newUnit,
        batchNo: result.newBatchNo,
        cost: result.newCost.toString(),
        inputWeight: result.inputWeight.toString(),
        inputPackages: result.inputPackages,
        remainingWeight: result.remainingWeight.toString(),
        outputWeight: result.outputWeight.toString(),
        outputPackages: result.outputPackages,
        newUnitCost: result.newUnitCost.toString(),
      },
      {
        status: 200,
        headers: { 'Idempotent-Replayed': String(operation.replayed) },
      },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json(
      { error: message },
      { status: message === '库存记录不存在' ? 404 : 400 },
    )
  }
}
