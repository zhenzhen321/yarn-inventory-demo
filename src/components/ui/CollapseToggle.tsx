'use client'

export function CollapseToggle({
  expanded,
  onClick,
  label,
  testId,
}: {
  expanded: boolean
  onClick: () => void
  label?: string
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? (expanded ? '收起' : '展开')}
      aria-expanded={expanded}
      data-testid={testId}
      className="inline-flex h-6 w-6 items-center justify-center text-black hover:opacity-70"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5">
        {expanded ? <path d="M3 6h10l-5 8z" /> : <path d="M6 3v10l8-5z" />}
      </svg>
    </button>
  )
}
