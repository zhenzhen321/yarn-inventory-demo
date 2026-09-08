import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'ui', 'Table.tsx'),
  'utf8',
)
const css = readFileSync(
  path.resolve(process.cwd(), 'src', 'app', 'globals.css'),
  'utf8',
)

describe('表格数值列对齐', () => {
  it('数值列数据与表头保持左对齐，不出现横向偏移', () => {
    expect(css).toMatch(/\.numeric-cell\s*\{[^}]*tabular-nums/)
    expect(css).not.toMatch(/\.numeric-cell\s*\{[^}]*text-right/)
    const thead = source.slice(source.indexOf('<thead>'), source.indexOf('</thead>'))
    expect(thead).not.toContain('text-right')
  })

  it('数值列仍按同一规则做千分位格式化', () => {
    expect(source).toContain('const NUMERIC_HEADER =')
    expect(source.match(/NUMERIC_HEADER\.test\(/g)?.length).toBe(1)
    expect(source).toContain("numeric ? 'numeric-cell' : ''")
  })
})
