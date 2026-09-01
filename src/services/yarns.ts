import type { Prisma, PrismaClient } from '@prisma/client'

export interface YarnMasterUpdate {
  name?: string
  note?: string | null
}

async function renameGeneratedBatchReferences(
  tx: Prisma.TransactionClient,
  yarnId: string,
  previousName: string,
  nextName: string,
) {
  const previousPrefix = `${previousName}-`
  const nextPrefix = `${nextName}-`
  const [batches, returnItems, feeSettlements] = await Promise.all([
    tx.batch.findMany({
      where: { variant: { yarnId }, batchNo: { startsWith: previousPrefix } },
      select: { id: true, variantId: true, batchNo: true },
    }),
    tx.processingReturnItem.findMany({
      where: { variant: { yarnId }, batchNo: { startsWith: previousPrefix } },
      select: { id: true, batchNo: true },
    }),
    tx.processingFeeSettlement.findMany({
      where: { variant: { yarnId }, batchNo: { startsWith: previousPrefix } },
      select: { id: true, batchNo: true },
    }),
  ])

  for (const batch of batches) {
    const nextBatchNo = nextPrefix + batch.batchNo.slice(previousPrefix.length)
    const duplicate = await tx.batch.findFirst({
      where: {
        id: { not: batch.id },
        variantId: batch.variantId,
        batchNo: nextBatchNo,
      },
      select: { id: true },
    })
    if (duplicate) {
      throw new Error(`更名后的批次号冲突：${nextBatchNo}`)
    }
  }

  await Promise.all([
    ...batches.map((batch) =>
      tx.batch.update({
        where: { id: batch.id },
        data: { batchNo: nextPrefix + batch.batchNo.slice(previousPrefix.length) },
      }),
    ),
    ...returnItems.map((item) =>
      tx.processingReturnItem.update({
        where: { id: item.id },
        data: { batchNo: nextPrefix + item.batchNo.slice(previousPrefix.length) },
      }),
    ),
    ...feeSettlements.map((record) =>
      tx.processingFeeSettlement.update({
        where: { id: record.id },
        data: { batchNo: nextPrefix + record.batchNo.slice(previousPrefix.length) },
      }),
    ),
  ])

  return {
    renamedBatchCount: batches.length,
    renamedSnapshotCount: returnItems.length + feeSettlements.length,
  }
}

export async function synchronizeYarnNameReferences(
  db: PrismaClient,
  yarnId: string,
  previousName: string,
) {
  return db.$transaction(async (tx) => {
    const yarn = await tx.yarn.findUnique({ where: { id: yarnId } })
    if (!yarn) throw new Error('纱线不存在')
    return renameGeneratedBatchReferences(tx, yarn.id, previousName, yarn.name)
  })
}

export async function updateYarnMaster(
  db: PrismaClient,
  id: string,
  input: YarnMasterUpdate,
) {
  return db.$transaction(async (tx) => {
    const existing = await tx.yarn.findUnique({
      where: { id },
      include: { _count: { select: { variants: true } } },
    })
    if (!existing) throw new Error('纱线不存在')

    const nextName = input.name?.trim()
    if (input.name !== undefined && !nextName) throw new Error('名称必填')

    if (nextName && nextName !== existing.name) {
      const duplicate = await tx.yarn.findFirst({
        where: { id: { not: id }, name: nextName },
        select: { id: true },
      })
      if (duplicate) throw new Error('已存在同名纱线，请勿重复更名')
    }

    const referenceImpact =
      nextName && nextName !== existing.name
        ? await renameGeneratedBatchReferences(tx, id, existing.name, nextName)
        : { renamedBatchCount: 0, renamedSnapshotCount: 0 }

    const row = await tx.yarn.update({
      where: { id },
      data: {
        ...(nextName !== undefined ? { name: nextName } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    })

    return {
      row,
      previousName: existing.name,
      renamed: row.name !== existing.name,
      relatedVariantCount: existing._count.variants,
      ...referenceImpact,
    }
  })
}
