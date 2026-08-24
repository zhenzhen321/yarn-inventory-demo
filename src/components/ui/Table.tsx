import { ReactNode } from 'react'

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border bg-white">
      <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle">
        <thead>
          <tr className="border-b bg-gray-50 text-left">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium text-gray-600">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
        </tbody>
      </table>
    </div>
  )
}
