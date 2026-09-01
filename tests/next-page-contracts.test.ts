import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function findPageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return findPageFiles(target)
    return entry.name === 'page.tsx' ? [target] : []
  })
}

const appDirectory = path.resolve(process.cwd(), 'src', 'app')
const pagesWithSearchParams = findPageFiles(appDirectory).filter((file) =>
  readFileSync(file, 'utf8').includes('searchParams'),
)

describe('Next.js 页面参数契约', () => {
  it('至少覆盖一个带查询参数的页面', () => {
    expect(pagesWithSearchParams.length).toBeGreaterThan(0)
  })

  for (const file of pagesWithSearchParams) {
    const relative = path.relative(process.cwd(), file)

    it(relative + ' 异步解析 searchParams', () => {
      const source = readFileSync(file, 'utf8')
      expect(source).toMatch(/searchParams:\s*Promise\s*</)
      expect(source).toMatch(/await\s+searchParams/)
    })
  }
})
