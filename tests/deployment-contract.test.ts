import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('deployment showcase contract', () => {
  it('provides a public database-aware health endpoint', () => {
    const healthRoute = read('src/app/api/health/route.ts')
    const proxy = read('src/proxy.ts')

    expect(healthRoute).toContain('prisma.$queryRaw`SELECT 1`')
    expect(healthRoute).toContain("status: 'ok'")
    expect(proxy).toContain("pathname === '/api/health'")
  })

  it('builds and starts through a guarded container entrypoint', () => {
    const dockerfile = read('Dockerfile')
    const entrypoint = read('scripts/container-entrypoint.sh')

    expect(dockerfile).toContain('RUN npm ci')
    expect(dockerfile).toContain('RUN npx prisma generate && npm run build')
    expect(dockerfile).toContain('ENTRYPOINT ["./scripts/container-entrypoint.sh"]')
    expect(entrypoint).toContain('npx prisma migrate deploy')
    expect(entrypoint).toContain('first_boot')
  })

  it('keeps application data and backups in named volumes', () => {
    const compose = read('compose.yaml')

    expect(compose).toContain('demo_data:/data')
    expect(compose).toContain('demo_backups:/app/backups')
    expect(compose).toContain('/api/health')
  })

  it('places Caddy in front of the application for domain HTTPS', () => {
    const caddyfile = read('deploy/Caddyfile')

    expect(caddyfile).toContain('{$DOMAIN}')
    expect(caddyfile).toContain('reverse_proxy app:3000')
  })

  it('allows deployment passwords to override local demo defaults', () => {
    const seed = read('prisma/seed.ts')

    expect(seed).toContain("process.env.ADMIN1_PASSWORD || 'demo123456'")
    expect(seed).toContain("process.env.ADMIN2_PASSWORD || 'demo123456'")
  })
})
