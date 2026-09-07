const BUSINESS_TIME_ZONE = 'Asia/Shanghai'
const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function ymd(year: number, month: number, day: number): string {
  return (
    String(year).padStart(4, '0') +
    '-' +
    String(month).padStart(2, '0') +
    '-' +
    String(day).padStart(2, '0')
  )
}

export function businessDateToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return value.year + '-' + value.month + '-' + value.day
}

export function businessDateFromInput(value: string): Date {
  const match = BUSINESS_DATE_PATTERN.exec(value.trim())
  if (!match) throw new Error('业务日期不正确')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('业务日期不正确')
  }
  return date
}

export function formatBusinessDate(date: Date): string {
  return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}
