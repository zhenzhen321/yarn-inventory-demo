import { Prisma, PrismaClient } from '@prisma/client'
import { allocateAmountByWeight } from '@/lib/money'
import {
  addToLotBalance,
  createLot,
  ensureInventoryLot,
  portionOf,
  recordMovement,
  refreshLotStatus,
  subtractFromBalance,
} from '../lots'
import { runIdempotent } from '../idempotency'
import {
  assertUniqueInventoryItems,
  getOrCreateBatch,
  getOrCreateVariant,
  nextOrderNo,
  resolveMovedPackages,
} from './shared'

export interface ProcessingJobInputItem {
  inventoryId: string
  weight: number
  packages?: number | null
}

export interface ProcessingJobOutputItem {
  yarnId: string
  spec: string
  color: string
  unit: string
  batchNo: string
  weight: number
  packages?: number | null
  allocationWeight?: number
}

export interface CompleteProcessingJobInput {
  date: Date
  factoryId: string
  handlerName: string
  feePerKg: number
  additionalFreight?: number
  otherCost?: number
  note?: string | null
  inputs: ProcessingJobInputItem[]
  outputs: ProcessingJobOutputItem[]
}

async function loadCompletedProcessingJob(tx: Prisma.TransactionClient, jobId: string) {
  const job = await tx.processingJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      factory: true,
      inputs: { include: { lot: true } },
      outputs: { include: { lot: true } },
      feeSettlement: true,
    },
  })
  const outputs = await Promise.all(
    job.outputs.map(async (record) => {
      const inventory = await tx.inventory.findFirstOrThrow({
        where: {
          lotId: record.lotId,
          warehouseId: job.factoryId,
          processingFeeSettled: true,
        },
        orderBy: { updatedAt: 'desc' },
        include: { variant: { include: { yarn: true } }, batch: true },
      })
      return { record, lot: record.lot, inventory }
    }),
  )
  return {
    id: job.id,
    job,
    outputs,
    settlement: job.feeSettlement,
    fee: job.feePerKg,
    feeTotal: job.feeTotal,
    inputWeight: job.inputWeight,
    outputWeight: job.outputWeight,
  }
}

async function completeProcessingJobInTransaction(
  tx: Prisma.TransactionClient,
  input: CompleteProcessingJobInput,
) {
  if (input.inputs.length === 0) throw new Error('至少选择一个投入批次')
  if (input.outputs.length === 0) throw new Error('至少填写一个成品批次')
  assertUniqueInventoryItems(input.inputs)

  const factory = await tx.warehouse.findUnique({ where: { id: input.factoryId } })
  if (!factory?.active || factory.type !== 'FACTORY') {
    throw new Error('加工厂不存在、已停用或类型不正确')
  }

  const rows = await Promise.all(
    input.inputs.map((item) =>
      tx.inventory.findUnique({
        where: { id: item.inventoryId },
        include: {
          warehouse: true,
          variant: { include: { yarn: true } },
          batch: true,
          lot: true,
        },
      }),
    ),
  )
  const inputParts: Array<{
    row: NonNullable<(typeof rows)[number]>
    weight: Prisma.Decimal
    packages: number | null
    goodsCost: Prisma.Decimal
    freightCost: Prisma.Decimal
  }> = []

  for (let index = 0; index < input.inputs.length; index++) {
    const item = input.inputs[index]
    const row = rows[index]
    if (!row) throw new Error('库存记录不存在：' + item.inventoryId)
    if (row.warehouseId !== input.factoryId || row.warehouse.type !== 'FACTORY') {
      throw new Error('所有投入批次必须属于同一加工厂')
    }
    if (row.processingFeeSettled) throw new Error('已完成加工核算的成品不能再次作为待加工投入')
    if (row.weight.lessThanOrEqualTo(0)) throw new Error('投入库存重量必须大于 0')
    const weight = new Prisma.Decimal(item.weight).toDecimalPlaces(2)
    if (weight.lessThanOrEqualTo(0)) throw new Error('本次加工重量必须大于 0')
    if (weight.greaterThan(row.weight)) {
      throw new Error('本次加工重量不能超过当前库存：现有 ' + row.weight + ' kg')
    }
    const packages = resolveMovedPackages(row, weight, item.packages, '加工')
    const moved = portionOf(row, weight)
    inputParts.push({
      row,
      weight,
      packages,
      goodsCost: moved.cost,
      freightCost: moved.freight,
    })
  }

  const outputRows = input.outputs.map((item) => {
    const spec = item.spec.trim()
    const color = item.color.trim()
    const unit = item.unit.trim()
    const batchNo = item.batchNo.trim()
    if (!item.yarnId || !spec || !color || !unit || !batchNo) {
      throw new Error('成品品名、支数、色号、单位和批次必填')
    }
    const weight = new Prisma.Decimal(item.weight).toDecimalPlaces(2)
    if (weight.lessThanOrEqualTo(0)) throw new Error('加工后重量必须大于 0')
    if (
      item.packages !== null &&
      item.packages !== undefined &&
      (!Number.isInteger(item.packages) || item.packages < 0)
    ) {
      throw new Error('加工后件数必须是非负整数')
    }
    const allocationWeight = new Prisma.Decimal(item.allocationWeight ?? item.weight).toDecimalPlaces(4)
    if (allocationWeight.lessThanOrEqualTo(0)) throw new Error('成品分配权重必须大于 0')
    return { ...item, spec, color, unit, batchNo, weight, allocationWeight }
  })

  const fee = new Prisma.Decimal(input.feePerKg).toDecimalPlaces(2)
  const additionalFreight = new Prisma.Decimal(input.additionalFreight ?? 0).toDecimalPlaces(2)
  const otherCost = new Prisma.Decimal(input.otherCost ?? 0).toDecimalPlaces(2)
  if (fee.lessThan(0)) throw new Error('加工费不能为负')
  if (additionalFreight.lessThan(0)) throw new Error('附加运费不能为负')
  if (otherCost.lessThan(0)) throw new Error('其他费用不能为负')

  const totalInputWeight = inputParts
    .reduce((total, item) => total.plus(item.weight), new Prisma.Decimal(0))
    .toDecimalPlaces(2)
  const totalOutputWeight = outputRows
    .reduce((total, item) => total.plus(item.weight), new Prisma.Decimal(0))
    .toDecimalPlaces(2)
  const inputGoodsCost = inputParts
    .reduce((total, item) => total.plus(item.goodsCost), new Prisma.Decimal(0))
    .toDecimalPlaces(2)
  const inputFreight = inputParts
    .reduce((total, item) => total.plus(item.freightCost), new Prisma.Decimal(0))
    .toDecimalPlaces(2)
  const totalFreight = inputFreight.plus(additionalFreight).toDecimalPlaces(2)
  const feeTotal = fee.mul(totalOutputWeight).toDecimalPlaces(2)
  const allocationWeights = outputRows.map((item) => item.allocationWeight)
  const allocatedGoods = allocateAmountByWeight(allocationWeights, inputGoodsCost)
  const allocatedFreight = allocateAmountByWeight(allocationWeights, totalFreight)
  const allocatedProcessing = allocateAmountByWeight(allocationWeights, feeTotal)
  const allocatedOther = allocateAmountByWeight(allocationWeights, otherCost)

  const job = await tx.processingJob.create({
    data: {
      orderNo: await nextOrderNo('PF', (base) =>
        tx.processingJob.findMany({
          where: { orderNo: { startsWith: base } },
          select: { orderNo: true },
        }),
      ),
      date: input.date,
      factoryId: input.factoryId,
      status: 'COMPLETED',
      feeBasis: 'OUTPUT',
      chargedWeight: totalOutputWeight,
      feePerKg: fee,
      feeTotal,
      outboundFreight: 0,
      returnFreight: additionalFreight,
      otherCost,
      costAllocationBasis: 'OUTPUT_WEIGHT',
      inputWeight: totalInputWeight,
      outputWeight: totalOutputWeight,
      weightDiff: totalInputWeight.minus(totalOutputWeight).toDecimalPlaces(2),
      handlerName: input.handlerName,
      note: input.note ?? null,
    },
  })

  let totalRemainingWeight = new Prisma.Decimal(0)
  for (const part of inputParts) {
    const inputLot = part.row.lot ?? (await ensureInventoryLot(tx, part.row))
    await subtractFromBalance(tx, part.row, part.weight, part.packages)
    const remaining = part.row.weight.minus(part.weight).toDecimalPlaces(2)
    totalRemainingWeight = totalRemainingWeight.plus(remaining)
    if (remaining.isZero()) {
      await tx.inventory.update({
        where: { id: part.row.id },
        data: { processingFeeSettled: true, archived: true },
      })
    }
    const processingInput = await tx.processingInput.create({
      data: {
        jobId: job.id,
        lotId: inputLot.id,
        inventoryId: part.row.id,
        weight: part.weight,
        packages: part.packages,
        goodsCost: part.goodsCost,
        freightCost: part.freightCost,
      },
    })
    await recordMovement(tx, {
      lotId: inputLot.id,
      type: 'PROCESS_CONSUME',
      referenceType: 'PROCESSING_JOB',
      referenceId: job.id,
      referenceItemId: processingInput.id,
      fromWarehouseId: input.factoryId,
      weight: part.weight,
      packages: part.packages,
      goodsCost: part.goodsCost,
      freightCost: part.freightCost,
      occurredAt: input.date,
    })
    await refreshLotStatus(tx, inputLot.id)
  }

  for (let index = 0; index < outputRows.length; index++) {
    const output = outputRows[index]
    const yarn = await tx.yarn.findUnique({ where: { id: output.yarnId } })
    if (!yarn?.active) throw new Error('成品品名不存在或已停用')
    const variant = await getOrCreateVariant(
      tx,
      output.yarnId,
      output.spec,
      output.color,
      output.unit,
    )
    const batch = await getOrCreateBatch(tx, variant, output.batchNo)
    const inventoryCost = allocatedGoods[index]
      .plus(allocatedProcessing[index])
      .plus(allocatedOther[index])
      .toDecimalPlaces(2)
    const lot = await createLot(tx, {
      date: input.date,
      sourceType: 'PROCESSING',
      variantId: variant.id,
      batchId: batch.id,
      initialWeight: output.weight,
      initialPackages: output.packages ?? null,
      goodsCost: allocatedGoods[index],
      freightCost: allocatedFreight[index],
      processingCost: allocatedProcessing[index].plus(allocatedOther[index]).toDecimalPlaces(2),
      status: 'AVAILABLE',
    })
    const inventory = await addToLotBalance(
      tx,
      {
        lotId: lot.id,
        warehouseId: input.factoryId,
        variantId: variant.id,
        batchId: batch.id,
        processingCostCalculated: true,
      },
      {
        weight: output.weight,
        packages: output.packages ?? null,
        cost: inventoryCost,
        freight: allocatedFreight[index],
      },
      fee,
    )
    const processingOutput = await tx.processingOutput.create({
      data: {
        jobId: job.id,
        lotId: lot.id,
        weight: output.weight,
        packages: output.packages ?? null,
        allocationWeight: output.allocationWeight,
        allocatedGoodsCost: allocatedGoods[index],
        allocatedFreight: allocatedFreight[index],
        allocatedProcessingCost: allocatedProcessing[index],
        allocatedOtherCost: allocatedOther[index],
      },
    })
    await recordMovement(tx, {
      lotId: lot.id,
      type: 'PROCESS_PRODUCE',
      referenceType: 'PROCESSING_JOB',
      referenceId: job.id,
      referenceItemId: processingOutput.id,
      toWarehouseId: input.factoryId,
      weight: output.weight,
      packages: output.packages ?? null,
      goodsCost: inventoryCost,
      freightCost: allocatedFreight[index],
      occurredAt: input.date,
    })
  }

  const totalOutputCost = inputGoodsCost.plus(feeTotal).plus(otherCost).toDecimalPlaces(2)
  const newUnitCost = totalOutputCost.div(totalOutputWeight).toDecimalPlaces(2)
  await tx.processingFeeSettlement.create({
    data: {
      warehouseId: input.factoryId,
      variantId: inputParts[0].row.variantId,
      batchNo:
        inputParts.length === 1
          ? inputParts[0].row.batch.batchNo
          : '多投入(' + inputParts.length + '批)',
      inputWeight: totalInputWeight,
      outputWeight: totalOutputWeight,
      feePerKg: fee,
      feeTotal,
      remainingWeight: totalRemainingWeight.toDecimalPlaces(2),
      newUnitCost,
      handlerName: input.handlerName,
      processingJobId: job.id,
    },
  })

  return loadCompletedProcessingJob(tx, job.id)
}

export function completeProcessingJob(db: PrismaClient, input: CompleteProcessingJobInput) {
  return db.$transaction(
    (tx) => completeProcessingJobInTransaction(tx, input),
    { maxWait: 10_000, timeout: 30_000 },
  )
}

export function completeProcessingJobIdempotent(
  db: PrismaClient,
  input: CompleteProcessingJobInput,
  idempotencyKey?: string,
) {
  return runIdempotent(
    db,
    'PROCESSING_JOB_COMPLETE',
    idempotencyKey,
    input,
    (tx) => completeProcessingJobInTransaction(tx, input),
    loadCompletedProcessingJob,
  )
}

export interface ProcessingFeeSettleInput {
  feePerKg: number
  inputWeight?: number
  inputPackages?: number | null
  handlerName?: string
  spec?: string
  color?: string
  unit?: string
  batchNo?: string
  outputWeight?: number
  outputPackages?: number | null
  packages?: number | null
  date?: Date
  note?: string | null
}

async function toSingleProcessingInput(
  db: Pick<Prisma.TransactionClient, 'inventory'>,
  inventoryId: string,
  input: ProcessingFeeSettleInput,
): Promise<CompleteProcessingJobInput> {
  const row = await db.inventory.findUnique({
    where: { id: inventoryId },
    include: { variant: true, batch: true },
  })
  if (!row) throw new Error('库存记录不存在')
  return {
    date: input.date ?? new Date(),
    factoryId: row.warehouseId,
    handlerName: input.handlerName ?? '未知',
    feePerKg: input.feePerKg,
    note: input.note,
    inputs: [{
      inventoryId,
      weight: input.inputWeight ?? Number(row.weight),
      packages: input.inputPackages,
    }],
    outputs: [{
      yarnId: row.variant.yarnId,
      spec: input.spec ?? row.variant.spec,
      color: input.color ?? row.variant.color,
      unit: input.unit ?? row.variant.unit,
      batchNo: input.batchNo ?? row.batch.batchNo,
      weight: input.outputWeight ?? input.inputWeight ?? Number(row.weight),
      packages: input.outputPackages ?? input.packages ?? input.inputPackages ?? row.packages,
    }],
  }
}

type SingleSourceRow = Awaited<ReturnType<typeof loadSingleSourceRow>>

function loadSingleSourceRow(db: PrismaClient, inventoryId: string) {
  return db.inventory.findUniqueOrThrow({
    where: { id: inventoryId },
    include: { warehouse: true, variant: { include: { yarn: true } }, batch: true, lot: true },
  })
}

function adaptSingleProcessingResult(
  currentRow: SingleSourceRow,
  result: Awaited<ReturnType<typeof loadCompletedProcessingJob>>,
) {
  const output = result.outputs[0]
  const jobInput = result.job.inputs[0]
  const row = {
    ...currentRow,
    weight: currentRow.weight.plus(jobInput.weight).toDecimalPlaces(2),
    cost: currentRow.cost.plus(jobInput.goodsCost).toDecimalPlaces(2),
    freight: currentRow.freight.plus(jobInput.freightCost).toDecimalPlaces(2),
    packages:
      currentRow.packages !== null && jobInput.packages !== null
        ? currentRow.packages + jobInput.packages
        : currentRow.packages,
  }
  const remainingWeight = currentRow.weight
  const identityChanged =
    output.inventory.variantId !== row.variantId || output.inventory.batchId !== row.batchId
  return {
    row,
    job: result.job,
    settlement: result.settlement,
    inputLot: jobInput.lot,
    outputLot: output.lot,
    outputInventory: output.inventory,
    fee: result.fee,
    inputWeight: jobInput.weight,
    inputPackages: jobInput.packages,
    remainingWeight,
    feeTotal: result.feeTotal,
    outputWeight: output.record.weight,
    outputPackages: output.record.packages,
    newCost: output.inventory.cost,
    newUnitCost: output.inventory.cost.div(output.record.weight).toDecimalPlaces(2),
    identityChanged,
    newSpec: output.inventory.variant.spec,
    newColor: output.inventory.variant.color,
    newUnit: output.inventory.variant.unit,
    newBatchNo: output.inventory.batch.batchNo,
  }
}

export async function settleProcessingFee(
  db: PrismaClient,
  inventoryId: string,
  input: ProcessingFeeSettleInput,
) {
  const result = await settleProcessingFeeIdempotent(db, inventoryId, input)
  return result.value
}

export async function settleProcessingFeeIdempotent(
  db: PrismaClient,
  inventoryId: string,
  input: ProcessingFeeSettleInput,
  idempotencyKey?: string,
) {
  const row = await loadSingleSourceRow(db, inventoryId)
  if (row.warehouse.type !== 'FACTORY') throw new Error('只有加工厂库存可以结算加工费')
  if (!idempotencyKey && row.processingFeeSettled) throw new Error('该批货已完成加工核算')
  const result = await runIdempotent(
    db,
    'PROCESSING_FEE_SETTLE_LEGACY',
    idempotencyKey,
    { inventoryId, input },
    async (tx) =>
      completeProcessingJobInTransaction(
        tx,
        await toSingleProcessingInput(tx, inventoryId, input),
      ),
    loadCompletedProcessingJob,
  )
  const currentRow = await loadSingleSourceRow(db, inventoryId)
  return {
    value: adaptSingleProcessingResult(currentRow, result.value),
    replayed: result.replayed,
  }
}

export interface ProcessingReturnItemInput {
  inventoryId: string
  weight: number
  spec: string
  color: string
  unit: string
  batchNo: string
  outputWeight: number
  packages?: number | null
}

export interface ProcessingReturnInput {
  date: Date
  factoryId: string
  warehouseId: string
  handlerName: string
  note?: string | null
  processingFeePerKg?: number | null
  freight?: number
  expectedSellPricePerKg?: number | null
  items: ProcessingReturnItemInput[]
}

async function createProcessingReturnInTransaction(
  tx: Prisma.TransactionClient,
  input: ProcessingReturnInput,
) {
    assertUniqueInventoryItems(input.items)
    if (input.factoryId === input.warehouseId) throw new Error('加工厂与目标仓库不能相同')
    const factory = await tx.warehouse.findUnique({ where: { id: input.factoryId } })
    const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId } })
    if (!factory || !factory.active || factory.type !== 'FACTORY') {
      throw new Error('来源仓库必须是加工厂且处于启用状态')
    }
    if (!warehouse || !warehouse.active || warehouse.type !== 'WAREHOUSE') {
      throw new Error('目标仓库必须是普通仓库且处于启用状态')
    }

    const rows = await Promise.all(
      input.items.map((it) =>
        tx.inventory.findUnique({
          where: { id: it.inventoryId },
          include: {
            warehouse: true,
            variant: { include: { yarn: true } },
            batch: true,
            lot: true,
          },
        }),
      ),
    )
    for (let i = 0; i < input.items.length; i++) {
      const row = rows[i]
      if (!row) throw new Error(`库存记录不存在：${input.items[i].inventoryId}`)
      if (row.warehouseId !== input.factoryId) {
        throw new Error(
          `库存 ${row.variant.yarn.name} ${row.variant.spec} ${row.variant.color} 不在加工厂`,
        )
      }
      const movedWeight = new Prisma.Decimal(input.items[i].weight).toDecimalPlaces(2)
      if (movedWeight.lessThanOrEqualTo(0)) throw new Error('返仓重量必须大于 0')
      if (row.weight.lessThan(movedWeight)) {
        throw new Error(
          `库存不足：${row.variant.yarn.name} ${row.variant.spec} ${row.variant.color} 批次 ${row.batch.batchNo}，现有 ${row.weight} kg`,
        )
      }
      if (row.warehouse.type === 'FACTORY' && !row.processingFeeSettled) {
        throw new Error(
          `该批货未结算加工费，无法出加工厂：${row.variant.yarn.name} ${row.variant.spec} ${row.variant.color} 批次 ${row.batch.batchNo}`,
        )
      }
      const submittedOutputWeight = new Prisma.Decimal(input.items[i].outputWeight).toDecimalPlaces(2)
      if (!submittedOutputWeight.equals(movedWeight)) {
        throw new Error('加工后重量已在完工核算时确定，返仓重量必须与本次移出重量一致')
      }
      const packages = input.items[i].packages
      if (
        packages !== null &&
        packages !== undefined &&
        (!Number.isInteger(packages) || packages < 0)
      ) {
        throw new Error('返仓件数必须是非负整数')
      }
      if (packages !== null && packages !== undefined && row.packages !== null && packages > row.packages) {
        throw new Error(`返仓件数不能超过当前库存：现有 ${row.packages} 件`)
      }
    }

    const order = await tx.processingReturn.create({
      data: {
        orderNo: await nextOrderNo('PR', (base) =>
          tx.processingReturn.findMany({
            where: { orderNo: { startsWith: base } },
            select: { orderNo: true },
          }),
        ),
        date: input.date,
        factoryId: input.factoryId,
        warehouseId: input.warehouseId,
        handlerName: input.handlerName,
        note: input.note ?? null,
        processingFeePerKg: 0,
        freight: input.freight ?? 0,
        expectedSellPricePerKg: input.expectedSellPricePerKg ?? null,
      },
    })

    const totalBackFreight = new Prisma.Decimal(input.freight ?? 0).toDecimalPlaces(2)
    const returnFreights = allocateAmountByWeight(
      input.items.map((item) => new Prisma.Decimal(item.weight)),
      totalBackFreight,
    )

    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]
      const row = rows[i]!
      const movedWeight = new Prisma.Decimal(it.weight).toDecimalPlaces(2)
      const packages =
        it.packages ?? (movedWeight.equals(row.weight) ? row.packages : null)
      if (!movedWeight.equals(row.weight) && row.packages !== null && it.packages == null) {
        throw new Error('部分返仓时必须填写本次返仓件数')
      }
      const moved = portionOf(row, movedWeight)
      const addedFreight = returnFreights[i]
      const newCost = moved.cost
      const newFreight = moved.freight.plus(addedFreight).toDecimalPlaces(2)
      const lot = row.lot ?? (await ensureInventoryLot(tx, row))

      await subtractFromBalance(tx, row, movedWeight, packages)
      const destination = await addToLotBalance(
        tx,
        {
          lotId: lot.id,
          warehouseId: input.warehouseId,
          variantId: row.variantId,
          batchId: row.batchId,
          processingCostCalculated: true,
        },
        {
          weight: movedWeight,
          packages,
          cost: newCost,
          freight: newFreight,
        },
        row.processingFeePerKg ?? undefined,
      )
      const returnItem = await tx.processingReturnItem.create({
        data: {
          orderId: order.id,
          inventoryId: row.id,
          weight: movedWeight,
          variantId: row.variantId,
          batchNo: row.batch.batchNo,
          outputWeight: movedWeight,
          packages,
          newCost,
          newFreight,
          outputLotId: lot.id,
          destinationInventoryId: destination.id,
        },
      })
      if (!addedFreight.isZero()) {
        await tx.inventoryLot.update({
          where: { id: lot.id },
          data: { freightCost: lot.freightCost.plus(addedFreight).toDecimalPlaces(2) },
        })
      }
      await recordMovement(tx, {
        lotId: lot.id,
        type: 'TRANSFER',
        referenceType: 'PROCESSING_RETURN',
        referenceId: order.id,
        referenceItemId: returnItem.id,
        fromWarehouseId: input.factoryId,
        toWarehouseId: input.warehouseId,
        weight: movedWeight,
        packages,
        goodsCost: moved.cost,
        freightCost: newFreight,
        occurredAt: input.date,
      })
    }

    return tx.processingReturn.findUniqueOrThrow({
      where: { id: order.id },
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
}

export function createProcessingReturn(
  db: PrismaClient,
  input: ProcessingReturnInput,
) {
  return db.$transaction((tx) => createProcessingReturnInTransaction(tx, input))
}

export function createProcessingReturnIdempotent(
  db: PrismaClient,
  input: ProcessingReturnInput,
  idempotencyKey?: string,
) {
  return runIdempotent(
    db,
    'PROCESSING_RETURN_CREATE',
    idempotencyKey,
    input,
    (tx) => createProcessingReturnInTransaction(tx, input),
    (tx, resourceId) => tx.processingReturn.findUniqueOrThrow({
      where: { id: resourceId },
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
    }),
  )
}
