// 备份 SQLite 数据库到 backups/，保留最近 30 份标准命名快照。
// WAL 模式下不能直接复制主文件；VACUUM INTO 会生成包含已提交 WAL 数据的一致性快照。
// 用法：node scripts/backup-db.js（或 npm run backup）
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} = require('node:fs')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')

const DEFAULT_DATABASE_URL = 'file:./dev.db'
const BACKUP_FILE_PATTERN = /^dev-\d{8}-\d{6}\.db$/

function databaseUrlFromEnvFile(contents) {
  const match = contents.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m)
  if (!match) return undefined
  const value = match[1].trim()
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1)
  }
  return value || undefined
}

function resolveDatabaseUrl(environment, envFileContents = '') {
  const override = environment.DATABASE_URL
  if (typeof override === 'string' && override.trim()) return override.trim()
  return databaseUrlFromEnvFile(envFileContents) || DEFAULT_DATABASE_URL
}

function resolveDatabasePath(databaseUrl, schemaDir, pathApi = path) {
  if (!databaseUrl.startsWith('file:')) {
    throw new Error(`备份仅支持 SQLite file: 数据源，当前为：${databaseUrl}`)
  }
  let filePath = databaseUrl.slice('file:'.length).split('?', 1)[0]
  // 同时接受 file:C:/data.db 和标准 URL 形式 file:/C:/data.db。
  if (pathApi === path.win32 && /^\/[A-Za-z]:[\\/]/.test(filePath)) {
    filePath = filePath.slice(1)
  }
  if (!filePath) throw new Error('DATABASE_URL 未包含 SQLite 文件路径')
  // Prisma 的相对 SQLite 路径以 schema.prisma 所在目录为基准。
  return pathApi.resolve(schemaDir, filePath)
}

function prismaFileUrl(filePath) {
  return `file:${path.resolve(filePath).replace(/\\/g, '/')}`
}

function sqliteStringPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "''")
}

function pruneBackups(backupDir, keep = 30) {
  const files = readdirSync(backupDir).filter((file) => BACKUP_FILE_PATTERN.test(file)).sort()
  while (files.length > keep) {
    unlinkSync(path.join(backupDir, files.shift()))
  }
  return files.length
}

function backupTimestamp(now) {
  const pad = (number) => String(number).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

async function backupDatabase(options = {}) {
  const projectDir = options.projectDir || path.resolve(__dirname, '..')
  const schemaDir = path.join(projectDir, 'prisma')
  const envPath = path.join(projectDir, '.env')
  const envFileContents = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const databaseUrl = options.databaseUrl || resolveDatabaseUrl(process.env, envFileContents)
  const dbPath = resolveDatabasePath(databaseUrl, schemaDir)
  const backupDir = options.backupDir || path.join(projectDir, 'backups')
  const target = path.join(
    backupDir,
    `dev-${backupTimestamp(options.now || new Date())}.db`,
  )

  if (!existsSync(dbPath)) throw new Error(`数据库文件不存在：${dbPath}`)
  mkdirSync(backupDir, { recursive: true })
  if (existsSync(target)) {
    throw new Error(`同名备份已存在，请稍后重试以保留现有快照：${target}`)
  }

  const PrismaClientClass = options.PrismaClientClass || PrismaClient
  const source = new PrismaClientClass({ datasources: { db: { url: databaseUrl } } })
  let verification
  let snapshotIsValid = false
  try {
    await source.$executeRawUnsafe(`VACUUM INTO '${sqliteStringPath(target)}'`)
    // 独立连接既验证文件完整性，也证明快照可以通过 Prisma 数据源覆盖打开。
    verification = new PrismaClientClass({
      datasources: { db: { url: prismaFileUrl(target) } },
    })
    const rows = await verification.$queryRawUnsafe('PRAGMA integrity_check')
    const result = rows[0] && rows[0].integrity_check
    if (String(result) !== 'ok') {
      throw new Error(`快照完整性校验未通过：${JSON.stringify(rows)}`)
    }
    snapshotIsValid = true
  } finally {
    await verification?.$disconnect().catch(() => {})
    await source.$disconnect().catch(() => {})
    if (!snapshotIsValid && existsSync(target)) unlinkSync(target)
  }

  const retained = pruneBackups(backupDir)
  console.log(`备份完成：${target}`)
  console.log('完整性校验：ok')
  console.log(`当前保留 ${retained} 份备份`)
  return { target, retained }
}

if (require.main === module) {
  backupDatabase().catch((error) => {
    console.error('备份失败：', error)
    process.exitCode = 1
  })
}

module.exports = {
  BACKUP_FILE_PATTERN,
  backupDatabase,
  databaseUrlFromEnvFile,
  prismaFileUrl,
  pruneBackups,
  resolveDatabasePath,
  resolveDatabaseUrl,
  sqliteStringPath,
}
