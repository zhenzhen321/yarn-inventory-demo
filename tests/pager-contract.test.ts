import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'ui', 'Pager.tsx'),
  'utf8',
)

describe('翻页组件', () => {
  it('提供可输入页码的跳转表单，且不依赖客户端脚本', () => {
    expect(source).toContain('method="get"')
    expect(source).toContain('name="page"')
    expect(source).toContain('aria-label="跳转到页"')
    expect(source).toContain("type=\"number\"")
    expect(source).toContain('跳转')
  })

  it('跳转表单保留当前查询参数，隐藏项不传空值', () => {
    expect(source).toContain('.filter(([, value]) => value)')
    expect(source).toContain('type="hidden"')
  })

  it('超出范围的页码先收敛再渲染，上一页/下一页基于收敛值', () => {
    expect(source).toContain('const current = Math.min(Math.max(1, page), totalPages)')
    expect(source).toContain('buildHref(current - 1)')
    expect(source).toContain('buildHref(current + 1)')
  })
})
