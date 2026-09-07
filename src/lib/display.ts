export function formatNumber(value: number | string, digits = 2) {
  const number = Number(value)
  return Number.isFinite(number)
    ? number.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—'
}

export function quickValues(values: string[], selected = '', limit = 5) {
  const unique = [...new Set(values.filter(Boolean))]
  return [...(unique.includes(selected) ? [selected] : []), ...unique.filter((value) => value !== selected)].slice(0, limit)
}
