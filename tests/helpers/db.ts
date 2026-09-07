import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const PRISMA_DIR = join(process.cwd(), 'prisma')
const TEST_SCHEMA_FILE = join(PRISMA_DIR, 'schema.test.prisma')
const TEST_DB_URL = 'file:./test.db'

let db: PrismaClient | null = null

function prepareTestSchema() {
  mkdirSync(PRISMA_DIR, { recursive: true })
  const testDbPath = join(PRISMA_DIR, 'test.db')
  // 本环境的 Prisma schema 引擎无法自行创建 SQLite 文件，必须先存在空文件
  if (!existsSync(testDbPath)) writeFileSync(testDbPath, '')
  const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8')
  const replaced = schema.replace(/url\s+=\s+env\("DATABASE_URL"\)/, 'url = "file:./test.db"')
  writeFileSync(TEST_SCHEMA_FILE, replaced)
}

export function getTestDb(): PrismaClient {
  if (db) return db
  prepareTestSchema()
  process.env.DATABASE_URL = TEST_DB_URL
  execSync(`npx prisma db push --skip-generate --schema "${TEST_SCHEMA_FILE}"`, {
    stdio: 'ignore',
  })
  db = new PrismaClient()
  return db
}

export async function resetDb(client: PrismaClient): Promise<void> {
  await client.idempotencyRequest.deleteMany()
  await client.saleAllocation.deleteMany()
  await client.stockMovement.deleteMany()
  await client.processingOutput.deleteMany()
  await client.processingInput.deleteMany()
  await client.processingFeeSettlement.deleteMany()
  await client.processingJob.deleteMany()
  await client.processingReturnItem.deleteMany()
  await client.processingReturn.deleteMany()
  await client.stocktakeItem.deleteMany()
  await client.transferItem.deleteMany()
  await client.saleItem.deleteMany()
  await client.purchaseItem.deleteMany()
  await client.stocktake.deleteMany()
  await client.transferOrder.deleteMany()
  await client.saleOrder.deleteMany()
  await client.purchaseOrder.deleteMany()
  await client.settlement.deleteMany()
  await client.auditLog.deleteMany()
  await client.processingFeePayment.deleteMany()
  await client.inventory.deleteMany()
  await client.inventoryLot.deleteMany()
  await client.batch.deleteMany()
  await client.yarnVariant.deleteMany()
  await client.counterparty.deleteMany()
  await client.warehouse.deleteMany()
  await client.yarn.deleteMany()
  await client.user.deleteMany()
}
