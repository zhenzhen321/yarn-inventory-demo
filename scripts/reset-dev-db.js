// 清空开发库全部业务数据，仅保留两个管理员账号（刚 / 萍）
// 密码从 .env 的 ADMIN1_PASSWORD / ADMIN2_PASSWORD 读取（.env 不入库）
// 用法：node scripts/reset-dev-db.js（在 yarn-ms 目录下执行）
const { readFileSync } = require('node:fs')
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const env = readFileSync('.env', 'utf8')
function getEnv(key) {
  const m = env.match(new RegExp(`^${key}="?([^"\\n]+)"?`, 'm'))
  return m ? m[1] : undefined
}

const p = new PrismaClient()

;(async () => {
  await p.processingReturnItem.deleteMany()
  await p.processingReturn.deleteMany()
  await p.stocktakeItem.deleteMany()
  await p.transferItem.deleteMany()
  await p.saleItem.deleteMany()
  await p.purchaseItem.deleteMany()
  await p.stocktake.deleteMany()
  await p.transferOrder.deleteMany()
  await p.saleOrder.deleteMany()
  await p.purchaseOrder.deleteMany()
  await p.settlement.deleteMany()
  await p.auditLog.deleteMany()
  await p.inventory.deleteMany()
  await p.batch.deleteMany()
  await p.yarnVariant.deleteMany()
  await p.counterparty.deleteMany()
  await p.warehouse.deleteMany()
  await p.yarn.deleteMany()
  await p.user.deleteMany()

  const admin1 = getEnv('ADMIN1_PASSWORD')
  const admin2 = getEnv('ADMIN2_PASSWORD')
  if (!admin1 || !admin2) {
    throw new Error('请先在 .env 中设置 ADMIN1_PASSWORD 与 ADMIN2_PASSWORD')
  }
  await p.user.create({
    data: { username: '刚', name: '刚', passwordHash: await bcrypt.hash(admin1, 10) },
  })
  await p.user.create({
    data: { username: '萍', name: '萍', passwordHash: await bcrypt.hash(admin2, 10) },
  })

  const users = await p.user.findMany()
  for (const u of users) {
    console.log(`user: ${u.username} / ${u.name} / hashPrefix ${u.passwordHash.slice(0, 7)}`)
  }
  const counts = {
    yarn: await p.yarn.count(),
    warehouse: await p.warehouse.count(),
    counterparty: await p.counterparty.count(),
    purchase: await p.purchaseOrder.count(),
    sale: await p.saleOrder.count(),
    inventory: await p.inventory.count(),
    audit: await p.auditLog.count(),
  }
  console.log('业务数据计数:', JSON.stringify(counts))
  await p['$disconnect']()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
