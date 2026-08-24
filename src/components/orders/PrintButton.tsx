'use client'

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-gray-400 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-100"
    >
      打印
    </button>
  )
}
