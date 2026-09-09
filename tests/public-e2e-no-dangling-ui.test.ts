import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('公开 E2E 可复现性', () => {
  it('隔离运行器不引用未随 Demo 发布的 UI 浏览器脚本', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/run-e2e-isolated.mjs'), 'utf8')
    expect(source).not.toContain('verify-family-ui.cjs')
    expect(source).not.toContain('UI_VERIFY_MODULES')
  })
})