import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
describe('库存 API 缓存安全契约', () => {
  it('GET 明确禁止缓存，避免登录态库存过期或串用', () => {
    const route = read('src/app/api/inventory/route.ts')
    expect(route).toContain("'Cache-Control': 'no-store'")
    expect(route).toContain('NextResponse.json(rows, { headers:')
  })
})