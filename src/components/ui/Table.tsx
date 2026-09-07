import { Children, Fragment, cloneElement, isValidElement, ReactElement, ReactNode } from 'react'
import { formatNumber } from '@/lib/display'

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  function decorate(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (node) => {
      if (!isValidElement(node)) return node
      const element = node as ReactElement<{ children?: ReactNode; colSpan?: number; className?: string; 'data-label'?: string }>
      if (node.type === Fragment) return cloneElement(element, {}, decorate(element.props.children))
      if (node.type !== 'tr') return node
      return cloneElement(element, {}, Children.map(element.props.children, (cell, index) => {
        if (!isValidElement(cell) || cell.type !== 'td') return cell
        const td = cell as typeof element
        const spanning = (td.props.colSpan ?? 1) > 1
        const numeric = !spanning && /金额|总额|货款|已付|未付|应付|已收|未收|应收|余额|单价|成本|运费|重量/.test(headers[index] ?? '')
        const value = td.props.children
        const formatted = numeric && (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)))
          ? formatNumber(value) : value
        return cloneElement(td, {
          'data-label': spanning ? undefined : headers[index],
          className: [td.props.className, spanning ? 'table-detail' : '', numeric ? 'numeric-cell' : ''].join(' '),
        }, formatted)
      }))
    })
  }
  return <div className="table-shell overflow-x-auto rounded-xl border border-slate-200 bg-white">
    <table className="responsive-table w-full text-sm [&_td]:px-3 [&_td]:py-3 [&_td]:align-middle">
      <thead><tr className="border-b bg-slate-50 text-left">
        {headers.map((header) => <th scope="col" key={header} className="px-3 py-3 font-semibold text-slate-600">{header}</th>)}
      </tr></thead>
      <tbody>{decorate(children)}</tbody>
    </table>
  </div>
}
