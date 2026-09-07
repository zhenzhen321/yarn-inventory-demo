import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const prismaDir = join(projectDir, 'prisma')
const e2eDb = join(prismaDir, 'e2e.db')
const devDb = join(prismaDir, 'dev.db')
const baseUrl = 'http://127.0.0.1:3100'
const distDir = '.next-e2e'
const node = process.execPath
const prismaCli = join(projectDir, 'node_modules', 'prisma', 'build', 'index.js')
const nextCli = join(projectDir, 'node_modules', 'next', 'dist', 'bin', 'next')
const e2eScript = join(projectDir, 'scripts', 'e2e.mjs')
const cleanupScript = join(projectDir, 'scripts', 'cleanup-e2e.js')

if (resolve(e2eDb) === resolve(devDb) || !e2eDb.endsWith(join('prisma', 'e2e.db'))) {
  throw new Error('E2E 数据库路径校验失败')
}
if (new URL(baseUrl).port === '3000') throw new Error('E2E 端口不能使用 3000')

function hashFile(path) {
  if (!existsSync(path)) return null
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function removeE2eFile(path) {
  const absolute = resolve(path)
  if (dirname(absolute) !== resolve(prismaDir) || !/^e2e\.db(?:-wal|-shm)?$/.test(absolute.split(/[\\/]/).pop())) {
    throw new Error('拒绝删除非 E2E 数据库文件：' + absolute)
  }
  rmSync(absolute, { force: true })
}

function run(label, args, env) {
  console.log('[E2E] ' + label)
  const result = spawnSync(node, args, {
    cwd: projectDir,
    env,
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error(label + '失败，退出码 ' + result.status)
}

async function waitForServer(server) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('E2E 服务提前退出')
    try {
      const response = await fetch(baseUrl + '/login')
      if (response.ok) return
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error('等待 E2E 服务启动超时')
}

const devHashBefore = hashFile(devDb)
const env = {
  ...process.env,
  DATABASE_URL: 'file:./e2e.db',
  NEXT_DIST_DIR: distDir,
  E2E_BASE_URL: baseUrl,
  E2E_ISOLATED_RUN: '1',
  NODE_ENV: 'production',
}
let server
let serverOutput = ''
let databaseReady = false
let runError = null
let cleanupError = null

try {
  removeE2eFile(e2eDb)
  removeE2eFile(e2eDb + '-wal')
  removeE2eFile(e2eDb + '-shm')
  writeFileSync(e2eDb, '')

  run('准备独立数据库', [prismaCli, 'migrate', 'deploy'], env)
  databaseReady = true
  run('创建测试账号', [prismaCli, 'db', 'seed'], env)
  run('构建独立服务', [nextCli, 'build'], env)

  console.log('[E2E] 启动 ' + baseUrl)
  server = spawn(node, [nextCli, 'start', '-H', '127.0.0.1', '-p', '3100'], {
    cwd: projectDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => {
    serverOutput = (serverOutput + chunk.toString()).slice(-8000)
  })
  server.stderr.on('data', (chunk) => {
    serverOutput = (serverOutput + chunk.toString()).slice(-8000)
  })
  await waitForServer(server)
  run('执行业务全流程', [e2eScript], env)
  if (env.UI_VERIFY_MODULES) {
    run('浏览器点选与手机布局验收', [join(projectDir, 'scripts', 'verify-family-ui.cjs')], env)
  }
} catch (error) {
  if (serverOutput) console.error(serverOutput)
  runError = error
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM')
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000))
    if (server.exitCode === null) server.kill('SIGKILL')
  }
  if (databaseReady) {
    try {
      run('清理测试业务数据', [cleanupScript], env)
    } catch (error) {
      cleanupError = error
    }
  }
  const devHashAfter = hashFile(devDb)
  console.log('[E2E] 测试数据库：' + e2eDb)
  console.log('[E2E] 家庭业务数据库哈希：' + (devHashBefore === devHashAfter ? '未变化' : '发生变化'))
  if (devHashBefore !== devHashAfter) {
    throw new Error('E2E 运行期间 dev.db 哈希发生变化')
  }
}

if (runError) throw runError
if (cleanupError) throw cleanupError
