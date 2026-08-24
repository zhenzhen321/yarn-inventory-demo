// 导出主数据（仓库 / 往来单位 / 纱线及其变体）到 backups/master-<时间戳>.json
// 用法：node scripts/backup-master-data.js（或 npm run backup:master）
const { writeFileSync, mkdirSync, readdirSync, unlinkSync } = require('node:fs')
const { join } = require('node:path')
const { PrismaClient } = require('@prisma/client')

const p = new PrismaClient()
const cwd = process.cwd()

;(async () => {
  const [warehouses, counterparties, yarns] = await Promise.all([
    p.warehouse.findMany({ orderBy: { name: 'asc' } }),
    p.counterparty.findMany({ orderBy: { name: 'asc' } }),
    p.yarn.findMany({
      include: {
        variants: { orderBy: [{ spec: 'asc' }, { color: 'asc' }, { unit: 'asc' }] },
      },
      orderBy: { name: 'asc' },
    }),
  ])

  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    warehouses,
    counterparties,
    yarns,
  }

  const backupDir = join(cwd, 'backups')
  mkdirSync(backupDir, { recursive: true })
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const target = join(backupDir, `master-${stamp}.json`)
  writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8')

  const variantCount = yarns.reduce((s, y) => s + y.variants.length, 0)
  console.log(`主数据备份完成：${target}`)
  console.log(
    `仓库 ${warehouses.length} 个，往来单位 ${counterparties.length} 个，纱线 ${yarns.length} 个（变体 ${variantCount} 条）`,
  )

  const files = readdirSync(backupDir).filter((f) => /^master-\d{8}-\d{6}\.json$/.test(f)).sort()
  while (files.length > 30) {
    unlinkSync(join(backupDir, files.shift()))
  }
  console.log(`当前保留 ${Math.min(files.length, 30)} 份主数据备份`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => p.$disconnect())
