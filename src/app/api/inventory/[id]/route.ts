import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { settleProcessingFee } from '@/services/inventory'

const feeSchema = z.object({
  processingFeePerKg: z.coerce.number().nonnegative('加工费不能为负'),
  inputWeight: z.coerce.number().positive('本次加工重量必须大于 0').optional(),
  spec: z.string().optional(),
  color: z.string().optional(),
  unit: z.string().optional(),
  batchNo: z.string().optional(),
  outputWeight: z.coerce.number().positive('加工后重量必须大于 0').optional(),
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
    const result = await settleProcessingFee(prisma, id, {
      feePerKg: parsed.data.processingFeePerKg,
      inputWeight: parsed.data.inputWeight,
      handlerName: user.name,
      spec: parsed.data.spec,
      color: parsed.data.color,
      unit: parsed.data.unit,
      batchNo: parsed.data.batchNo,
      outputWeight: parsed.data.outputWeight,
    })
    await logAudit({
      userName: user.name,
      action: 'INVENTORY_PROCESSING_FEE',
      target: '结算加工费',
      detail: `仓库 ${result.row.warehouse.name}，纱线 ${result.row.variant.yarn.name}，加工前 ${result.row.variant.spec}/${result.row.variant.color}/${result.row.variant.unit} 批次${result.row.batch.batchNo} ${result.row.weight}kg，本次加工 ${result.inputWeight}kg → ${result.identityChanged ? '加工后' : '保持'} ${result.newSpec}/${result.newColor}/${result.newUnit} 批次${result.newBatchNo} ${result.outputWeight}kg，剩余 ${result.remainingWeight}kg，加工费 ${result.fee} 元/kg，合计 ${result.feeTotal}，新单位成本 ${result.newUnitCost}`,
    })
    return NextResponse.json({
      ok: true,
      cost: result.newCost.toString(),
      inputWeight: result.inputWeight.toString(),
      remainingWeight: result.remainingWeight.toString(),
      outputWeight: result.outputWeight.toString(),
      newUnitCost: result.newUnitCost.toString(),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json(
      { error: message },
      { status: message === '库存记录不存在' ? 404 : 400 },
    )
  }
}
