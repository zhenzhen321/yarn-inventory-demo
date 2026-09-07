import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'

export interface IdempotentResult<T> {
  value: T
  replayed: boolean
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Prisma.Decimal) return value.toString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

export function requestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex')
}

export function idempotencyKeyFromRequest(request: Request): string | undefined {
  const key = request.headers.get('Idempotency-Key')?.trim()
  if (!key) return undefined
  if (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new Error('幂等键格式不正确')
  }
  return key
}

export async function runIdempotent<T extends { id: string }>(
  db: PrismaClient,
  operation: string,
  key: string | undefined,
  payload: unknown,
  execute: (tx: Prisma.TransactionClient) => Promise<T>,
  load: (tx: Prisma.TransactionClient, resourceId: string) => Promise<T>,
): Promise<IdempotentResult<T>> {
  if (!key) {
    return db.$transaction(async (tx) => ({
      value: await execute(tx),
      replayed: false,
    }))
  }

  const hash = requestHash(payload)
  const resolveExisting = async (): Promise<IdempotentResult<T> | null> =>
    db.$transaction(async (tx) => {
      const existing = await tx.idempotencyRequest.findUnique({
        where: { operation_key: { operation, key } },
      })
      if (!existing) return null
      if (existing.requestHash !== hash) throw new Error('幂等键已用于不同请求')
      if (!existing.resourceId || !existing.completedAt) {
        throw new Error('相同请求正在处理中，请稍后重试')
      }
      return { value: await load(tx, existing.resourceId), replayed: true }
    })

  const existing = await resolveExisting()
  if (existing) return existing

  try {
    return await db.$transaction(
      async (tx) => {
        const seen = await tx.idempotencyRequest.findUnique({
          where: { operation_key: { operation, key } },
        })
        if (seen) {
          if (seen.requestHash !== hash) throw new Error('幂等键已用于不同请求')
          if (!seen.resourceId || !seen.completedAt) {
            throw new Error('相同请求正在处理中，请稍后重试')
          }
          return { value: await load(tx, seen.resourceId), replayed: true }
        }

        const reservation = await tx.idempotencyRequest.create({
          data: { operation, key, requestHash: hash },
        })
        const value = await execute(tx)
        await tx.idempotencyRequest.update({
          where: { id: reservation.id },
          data: { resourceId: value.id, completedAt: new Date() },
        })
        return { value, replayed: false }
      },
      { maxWait: 10_000, timeout: 30_000 },
    )
  } catch (error) {
    const isConcurrencyConflict =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2034'].includes(error.code)
    if (!isConcurrencyConflict) throw error
    const replay = await resolveExisting()
    if (replay) return replay
    throw error
  }
}
