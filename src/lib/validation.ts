import { z, type RefinementCtx } from 'zod'
import { businessDateFromInput, formatBusinessDate } from '@/lib/business-date'

export const handlerNameSchema = z.enum(['admin', 'clerk'])

const businessDateSchema = z.union([z.string(), z.date()]).transform((value, ctx) => {
  try {
    return businessDateFromInput(value instanceof Date ? formatBusinessDate(value) : value)
  } catch {
    ctx.addIssue({ code: 'custom', message: '业务日期不正确' })
    return z.NEVER
  }
})

function rejectDuplicateInventoryItems(
  items: { inventoryId: string }[],
  ctx: RefinementCtx,
): void {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.inventoryId)) {
      ctx.addIssue({ code: 'custom', path: [index, 'inventoryId'], message: '同一库存不能重复选择' })
    }
    seen.add(item.inventoryId)
  })
}

export const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入账号').max(64, '账号过长'),
  password: z.string().min(1, '请输入密码').max(256, '密码过长'),
  remember: z.boolean().optional().default(true),
})

export const yarnSchema = z.object({
  name: z.string().trim().min(1, '名称必填'),
  note: z.string().optional().nullable(),
})

export const yarnVariantSchema = z.object({
  yarnId: z.string().min(1, '请选择产品'),
  spec: z.string().min(1, '支数必填'),
  color: z.string().min(1, '色号必填'),
  unit: z.string().default('kg'),
})

export const yarnVariantUpdateSchema = z.object({
  spec: z.string().min(1, '支数必填').optional(),
  color: z.string().min(1, '色号必填').optional(),
  unit: z.string().optional(),
  active: z.boolean().optional(),
})

export const processingReturnItemSchema = z.object({
  inventoryId: z.string().min(1, '请选择加工厂库存'),
  weight: z.coerce.number().positive('送厂重量必须大于 0'),
  spec: z.string().min(1, '支数必填'),
  color: z.string().min(1, '色号必填'),
  unit: z.string().default('kg'),
  batchNo: z.string().min(1, '请填写收回批次/缸号'),
  outputWeight: z.coerce.number().positive('收回重量必须大于 0'),
  packages: z.coerce.number().int().nonnegative().optional().nullable(),
})

export const processingReturnSchema = z.object({
  date: businessDateSchema,
  factoryId: z.string().min(1, '请选择加工厂'),
  warehouseId: z.string().min(1, '请选择目标仓库'),
  handlerName: handlerNameSchema,
  note: z.string().optional().nullable(),
  processingFeePerKg: z.coerce.number().nonnegative('加工费不能为负').default(0),
  freight: z.coerce.number().nonnegative('运费不能为负').default(0),
  expectedSellPricePerKg: z.coerce.number().nonnegative('预计卖价不能为负').optional().nullable(),
  items: z.array(processingReturnItemSchema).min(1, '至少一条明细'),
}).superRefine((value, ctx) => {
  rejectDuplicateInventoryItems(value.items, ctx)
})

export const warehouseSchema = z.object({
  name: z.string().min(1, '名称必填'),
  type: z.enum(['WAREHOUSE', 'FACTORY']).default('WAREHOUSE'),
  address: z.string().optional().nullable(),
  manager: z.string().optional().nullable(),
})

export const counterpartySchema = z.object({
  name: z.string().min(1, '名称必填'),
  type: z.enum(['SUPPLIER', 'CUSTOMER', 'BOTH']).default('BOTH'),
  contact: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
})

export const purchaseItemSchema = z
  .object({
    variantId: z.string().min(1, '请选择纱线规格').optional(),
    yarnId: z.string().min(1, '请选择纱线').optional(),
    spec: z.string().optional(),
    color: z.string().optional(),
    unit: z.string().optional(),
    batchNo: z.string().optional().nullable(),
    weight: z.coerce.number().positive('重量必须大于 0'),
    price: z.coerce.number().nonnegative('单价不能为负'),
    packages: z.coerce.number().int().nonnegative().optional().nullable(),
  })
  .superRefine((val, ctx) => {
    const hasVariant = !!val.variantId
    const hasParts = !!(val.yarnId && val.spec && val.color && val.unit)
    if (!hasVariant && !hasParts) {
      ctx.addIssue({ code: 'custom', message: '请选择纱线规格或填写支数/色号/单位' })
    }
  })

export const purchaseSchema = z.object({
  date: businessDateSchema,
  supplierId: z.string().min(1, '请选择供应商'),
  warehouseId: z.string().min(1, '请选择仓库'),
  handlerName: handlerNameSchema,
  note: z.string().optional().nullable(),
  freight: z.coerce.number().nonnegative('运费不能为负').default(0),
  items: z.array(purchaseItemSchema).min(1, '至少一条明细'),
})

export const purchaseUpdateSchema = z.object({
  freight: z.coerce.number().nonnegative('运费不能为负'),
})

export const saleItemSchema = z.object({
  inventoryId: z.string().min(1, '请选择库存'),
  weight: z.coerce.number().positive('重量必须大于 0'),
  price: z.coerce.number().nonnegative('单价不能为负'),
  packages: z.coerce.number().int().nonnegative().optional().nullable(),
})

export const saleSchema = z.object({
  date: businessDateSchema,
  customerId: z.string().min(1, '请选择客户'),
  warehouseId: z.string().min(1, '请选择仓库'),
  handlerName: handlerNameSchema,
  note: z.string().optional().nullable(),
  freight: z.coerce.number().nonnegative('运费不能为负').default(0),
  items: z.array(saleItemSchema).min(1, '至少一条明细'),
}).superRefine((value, ctx) => {
  rejectDuplicateInventoryItems(value.items, ctx)
})

export const transferItemSchema = z.object({
  inventoryId: z.string().min(1, '请选择库存'),
  weight: z.coerce.number().positive('重量必须大于 0'),
  packages: z.coerce.number().int().nonnegative().optional().nullable(),
})

export const transferSchema = z.object({
  date: businessDateSchema,
  fromWarehouseId: z.string().min(1, '请选择来源仓库'),
  toWarehouseId: z.string().min(1, '请选择目标仓库'),
  handlerName: handlerNameSchema,
  note: z.string().optional().nullable(),
  processingFeePerKg: z.coerce.number().nonnegative('加工费不能为负').optional().nullable(),
  freight: z.coerce.number().nonnegative('运费不能为负').default(0),
  items: z.array(transferItemSchema).min(1, '至少一条明细'),
}).superRefine((value, ctx) => {
  rejectDuplicateInventoryItems(value.items, ctx)
})

export const stocktakeItemSchema = z.object({
  inventoryId: z.string().min(1, '请选择库存'),
  actualWeight: z.coerce.number().nonnegative('实盘数不能为负'),
})

export const stocktakeSchema = z.object({
  date: businessDateSchema,
  warehouseId: z.string().min(1, '请选择仓库'),
  handlerName: handlerNameSchema,
  note: z.string().optional().nullable(),
  items: z.array(stocktakeItemSchema).min(1, '至少一条明细'),
}).superRefine((value, ctx) => {
  rejectDuplicateInventoryItems(value.items, ctx)
})

export const settlementSchema = z.object({
  side: z.enum(['PURCHASE', 'SALE'], { message: '方向不正确' }),
  counterpartyId: z.string().min(1, '请选择往来单位'),
  amount: z.coerce.number().positive('结算金额必须大于 0'),
  date: businessDateSchema,
  method: z.string().optional().nullable(),
  handlerName: handlerNameSchema,
})

export const processingFeePaymentSchema = z.object({
  factoryId: z.string().min(1, '请选择加工厂'),
  amount: z.coerce.number().positive('付款金额必须大于 0'),
  date: businessDateSchema,
  method: z.string().optional().nullable(),
  handlerName: handlerNameSchema,
})

export const processingJobCompletionSchema = z.object({
  date: businessDateSchema,
  factoryId: z.string().min(1, '请选择加工厂'),
  feePerKg: z.coerce.number().nonnegative('加工费不能为负'),
  additionalFreight: z.coerce.number().nonnegative('附加运费不能为负').default(0),
  otherCost: z.coerce.number().nonnegative('其他费用不能为负').default(0),
  note: z.string().optional().nullable(),
  inputs: z.array(z.object({
    inventoryId: z.string().min(1, '请选择投入批次'),
    weight: z.coerce.number().positive('投入重量必须大于 0'),
    packages: z.coerce.number().int().nonnegative('投入件数不能为负').optional().nullable(),
  })).min(1, '至少选择一个投入批次'),
  outputs: z.array(z.object({
    yarnId: z.string().min(1, '请选择成品品名'),
    spec: z.string().trim().min(1, '成品支数必填'),
    color: z.string().trim().min(1, '成品色号必填'),
    unit: z.string().trim().min(1, '成品单位必填'),
    batchNo: z.string().trim().min(1, '成品批次必填'),
    weight: z.coerce.number().positive('成品重量必须大于 0'),
    packages: z.coerce.number().int().nonnegative('成品件数不能为负').optional().nullable(),
    allocationWeight: z.coerce.number().positive('分配权重必须大于 0').optional(),
  })).min(1, '至少填写一个成品批次'),
}).superRefine((value, ctx) => {
  rejectDuplicateInventoryItems(value.inputs, ctx)
})

export const archiveZeroSchema = z.object({
  warehouseId: z.string().min(1, '请选择仓库'),
})

export const yarnUpdateSchema = z.object({
  name: z.string().trim().min(1, '名称必填').optional(),
  note: z.string().nullable().optional(),
})

export const warehouseUpdateSchema = z.object({
  name: z.string().min(1, '名称必填').optional(),
  type: z.enum(['WAREHOUSE', 'FACTORY']).optional(),
  address: z.string().nullable().optional(),
  manager: z.string().nullable().optional(),
})

export const counterpartyUpdateSchema = z.object({
  name: z.string().min(1, '名称必填').optional(),
  type: z.enum(['SUPPLIER', 'CUSTOMER', 'BOTH']).optional(),
  contact: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
})
