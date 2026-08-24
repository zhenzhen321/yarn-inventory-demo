// 为 SQLite 数据库开启 WAL（预写日志）模式
// WAL 是持久化设置（记录在数据库文件头），对每个库执行一次即可：
//   - 写入不再阻塞读取，掉电后恢复更可靠
//   - 此后会出现 <库名>-wal / <库名>-shm 伴生文件，属正常现象
//   - 备份必须改用 VACUUM INTO 一致性快照（scripts/backup-db.js 已适配）
// 用法：
//   node scripts/enable-wal.js                  # 对 .env 中 DATABASE_URL 指向的库
//   node scripts/enable-wal.js prisma/test.db   # 对指定文件（相对项目根）
const { readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { PrismaClient } = require('@prisma/client')

function loadEnv() {
  try {
    const env = readFileSync(join(process.cwd(), '.env'), 'utf8')
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
      }
    }
  } catch {
    // 无 .env 时依赖已有环境变量
  }
}

const targetFile = process.argv[2]

async function main() {
  loadEnv()
  let url = process.env.DATABASE_URL
  if (targetFile) {
    const abs = resolve(process.cwd(), targetFile).replace(/\\/g, '/')
    url = `file:${abs}`
  }
  if (!url) throw new Error('缺少 DATABASE_URL，且未指定数据库文件')

  const p = new PrismaClient({ datasources: { db: { url } } })
  const rows = await p.$queryRawUnsafe('PRAGMA journal_mode=WAL')
  console.log(`目标：${url}`)
  console.log(`journal_mode 查询结果：${JSON.stringify(rows)}`)
  const mode = rows[0] && rows[0].journal_mode
  if (String(mode).toLowerCase() !== 'wal') {
    throw new Error(`journal_mode 未生效，当前为 ${mode}`)
  }
  console.log('WAL 模式已生效（该设置永久保存在数据库文件中）')
  await p.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
