import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const source = (relative: string) => readFileSync(join(root, relative), 'utf8')

describe('master-data cache invalidation contracts', () => {
  it('invalidates cached options after collection creates and auto-created specs', () => {
    for (const route of [
      'src/app/api/counterparties/route.ts',
      'src/app/api/warehouses/route.ts',
      'src/app/api/yarns/route.ts',
      'src/app/api/yarn-variants/route.ts',
      'src/app/api/purchases/route.ts',
      'src/app/api/processing-jobs/route.ts',
    ]) {
      const text = source(route)
      expect(text).toContain("from '@/lib/master-data-cache'")
      expect(text).toContain('invalidateMasterData()')
    }
  })

  it('invalidates cached options after updates and deletes', () => {
    for (const route of [
      'src/app/api/counterparties/[id]/route.ts',
      'src/app/api/warehouses/[id]/route.ts',
      'src/app/api/yarns/[id]/route.ts',
      'src/app/api/yarn-variants/[id]/route.ts',
    ]) {
      const text = source(route)
      expect(text).toContain("from '@/lib/master-data-cache'")
      expect(text.match(/invalidateMasterData\(\)/g)?.length).toBe(2)
    }
  })

  it('invalidates cached options when inventory processing is settled', () => {
    const text = source('src/app/api/inventory/[id]/route.ts')
    expect(text).toContain("from '@/lib/master-data-cache'")
    expect(text).toContain('invalidateMasterData()')
  })
})