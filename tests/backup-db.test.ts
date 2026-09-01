import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  databaseUrlFromEnvFile,
  pruneBackups,
  resolveDatabasePath,
  resolveDatabaseUrl,
  sqliteStringPath,
} from '../scripts/backup-db.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('数据库备份脚本', () => {
  it('显式 DATABASE_URL 优先于 .env，并兼容带空格和引号的配置', () => {
    const envFile = ' DATABASE_URL = "file:./from-env.db"\r\n'
    expect(databaseUrlFromEnvFile(envFile)).toBe('file:./from-env.db')
    expect(resolveDatabaseUrl({ DATABASE_URL: ' file:C:/data/override.db ' }, envFile)).toBe(
      'file:C:/data/override.db',
    )
  })

  it('按 Prisma 规则解析 Windows 相对路径、绝对路径和查询参数', () => {
    const schemaDir = 'C:\\work\\yarn-ms\\prisma'
    expect(resolveDatabasePath('file:./dev.db?connection_limit=1', schemaDir, path.win32)).toBe(
      'C:\\work\\yarn-ms\\prisma\\dev.db',
    )
    expect(resolveDatabasePath('file:C:/data/yarn.db', schemaDir, path.win32)).toBe(
      'C:\\data\\yarn.db',
    )
    expect(resolveDatabasePath('file:/C:/data/yarn.db', schemaDir, path.win32)).toBe(
      'C:\\data\\yarn.db',
    )
    expect(sqliteStringPath("C:\\data\\owner's yarn.db")).toBe("C:/data/owner''s yarn.db")
  })

  it('只轮转标准命名快照，保留自定义恢复点', () => {
    const backupDir = mkdtempSync(path.join(tmpdir(), 'yarn-ms-backup-'))
    tempDirs.push(backupDir)
    for (let second = 1; second <= 32; second += 1) {
      writeFileSync(
        path.join(backupDir, `dev-20260101-0000${String(second).padStart(2, '0')}.db`),
        '',
      )
    }
    writeFileSync(path.join(backupDir, 'dev-20260101-before-import.db'), '')
    expect(pruneBackups(backupDir, 30)).toBe(30)
    const files = readdirSync(backupDir).sort()
    expect(files).not.toContain('dev-20260101-000001.db')
    expect(files).not.toContain('dev-20260101-000002.db')
    expect(files).toContain('dev-20260101-before-import.db')
  })
})
