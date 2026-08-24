// 备份开发数据库到 backups/，保留最近 30 份
// 数据库已启用 WAL 模式，直接复制文件可能漏掉尚未合入主文件的已提交数据；
// 因此改用 SQLite 在线备份（VACUUM INTO）生成一致性快照：
//   - 即使系统正在写入，快照也完整、可独立恢复
//   - 备份完成后用独立连接执行 PRAGMA integrity_check 自动校验
// 用法：node scripts/backup-db.js（或 npm run backup）
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} = require('node:fs')
const { join } = require('node:path')
const { PrismaClient } = require('@prisma/client')

const cwd = process.cwd()
const env = readFileSync(join(cwd, '.env'), 'utf8')
const m = env.match(/^DATABASE_URL="?([^"\n]+)"?/m)
const url = m ? m[1] : 'file:./dev.db'
process.env.DATABASE_URL = url // Prisma Client 5 从环境变量解析数据源

// 用于存在性检查：file:./dev.db 相对于 prisma/ 目录解析
const dbRel = url.replace(/^file:/, '').replace(/^\.\//, '')
const dbPath = join(cwd, 'prisma', dbRel)

const backupDir = join(cwd, 'backups')
mkdirSync(backupDir, { recursive: true })

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const stamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
const target = join(backupDir, `dev-${stamp}.db`)

if (!existsSync(dbPath)) {
  console.error('数据库文件不存在：', dbPath)
  process.exit(1)
}

// VACUUM INTO 要求目标文件不存在；同名（同一秒重跑）时先移除旧文件
if (existsSync(target)) unlinkSync(target)

// SQLite 字符串字面量：反斜杠安全，单引号转义为两个单引号
const sqlTarget = target.replace(/\\/g, '/').replace(/'/g, "''")

;(async () => {
  const p = new PrismaClient()

  // 在线一致性快照：VACUUM INTO 会先把 WAL 中的数据合入，再写出紧凑副本
  await p.$executeRawUnsafe(`VACUUM INTO '${sqlTarget}'`)

  // 用独立连接对快照做完整性校验，失败则删除并报错
  const v = new PrismaClient({
    datasources: { db: { url: `file:${sqlTarget}` } },
  })
  try {
    const rows = await v.$queryRawUnsafe('PRAGMA integrity_check')
    const ok = rows[0] && rows[0].integrity_check
    if (String(ok) !== 'ok') {
      throw new Error(`快照完整性校验未通过：${JSON.stringify(rows)}`)
    }
    console.log(`备份完成：${target}`)
    console.log(`完整性校验：ok`)
  } catch (e) {
    if (existsSync(target)) unlinkSync(target)
    throw e
  } finally {
    await v.$disconnect().catch(() => {})
    await p.$disconnect().catch(() => {})
  }

  const files = readdirSync(backupDir)
    .filter((f) => /^dev-\d{8}-\d{6}\.db$/.test(f))
    .sort()
  while (files.length > 30) {
    const oldest = files.shift()
    unlinkSync(join(backupDir, oldest))
  }
  console.log(`当前保留 ${Math.min(files.length, 30)} 份备份`)
})().catch((e) => {
  console.error('备份失败：', e)
  process.exit(1)
})
