import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (...parts: string[]) =>
  readFileSync(path.resolve(process.cwd(), ...parts), 'utf8')

const shell = read('src', 'components', 'layout', 'AppShell.tsx')
const layout = read('src', 'app', 'layout.tsx')
const css = read('src', 'app', 'globals.css')
const label = read('src', 'components', 'labels', 'LabelPrintButton.tsx')

describe('深色模式开关', () => {
  it('右上角有深色/浅色切换按钮，与"大字"并列且记录选择', () => {
    expect(shell).toContain("aria-label=\"切换深色模式\"")
    expect(shell).toContain("localStorage.setItem('yarn-ui:dark'")
    expect(shell).toContain("classList.toggle('dark', next)")
    expect(shell).toContain("{dark ? '浅色' : '深色'}")
  })

  it('首屏渲染前恢复已保存的深色选择，避免闪白', () => {
    expect(layout).toContain("localStorage.getItem('yarn-ui:dark')==='1'")
    expect(layout).toContain("classList.add('dark')")
  })

  it('深色样式集中定义，浅色卡片、文字、边框和共享组件均有映射', () => {
    expect(css).toContain('html.dark .bg-white:not(.keep-light)')
    expect(css).toContain('html.dark .text-slate-600')
    expect(css).toContain('html.dark .border-slate-300')
    expect(css).toContain('html.dark .form-section')
    expect(css).toContain('html.dark .notice-error')
    expect(css).toContain('html.dark .responsive-table thead th')
  })

  it('标签预览保持白底黑字，打印强制浅色输出', () => {
    expect(label).toContain('keep-light')
    expect(css).toMatch(/\.keep-light \{[^}]*#ffffff/s)
    expect(css).toContain('@media print')
  })
})
