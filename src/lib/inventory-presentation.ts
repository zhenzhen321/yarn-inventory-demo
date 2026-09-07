export interface InventoryPresentationRow {
  id: string
  warehouseId: string
  warehouseName: string
  yarnName: string
  spec: string
  color: string | null
  unit: string
  batchNo: string
  lotNo: string | null
  weight: string
  packages: number | null
  cost: string
  freight: string
  sourceType: string
  sourceId: string | null
  sourceNo: string
  sourceDate: string | null
}

export interface InventoryPresentationGroup<T extends InventoryPresentationRow = InventoryPresentationRow> {
  key: string
  warehouseId: string
  warehouseName: string
  sourceType: string
  sourceNo: string
  sourceDate: string | null
  yarnSummary: string
  colorSummary: string
  weight: number
  packages: number | null
  cost: number
  freight: number
  rows: T[]
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)]
}

function summarize(values: string[], unit: string): string {
  const unique = uniqueInOrder(values)
  if (unique.length === 0) return '-'
  if (unique.length === 1) return unique[0]
  return `${unique[0]}等${unique.length}${unit}`
}

export function buildInventoryGroups<T extends InventoryPresentationRow>(rows: T[]) {
  const grouped = new Map<string, InventoryPresentationGroup<T>>()

  for (const row of rows) {
    const sourceKey = row.sourceId ?? row.lotNo ?? row.id
    const key = `${row.warehouseId}:${row.sourceType}:${sourceKey}`
    const current = grouped.get(key)
    if (current) {
      current.rows.push(row)
      current.weight += Number(row.weight)
      current.cost += Number(row.cost)
      current.freight += Number(row.freight)
      current.packages =
        current.packages === null || row.packages === null
          ? null
          : current.packages + row.packages
      current.yarnSummary = summarize(current.rows.map((item) => item.yarnName), '种')
      current.colorSummary = summarize(
        current.rows.map((item) => item.color ?? '未填色号'),
        '种',
      )
      continue
    }

    grouped.set(key, {
      key,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      sourceType: row.sourceType,
      sourceNo: row.sourceNo,
      sourceDate: row.sourceDate,
      yarnSummary: row.yarnName,
      colorSummary: row.color ?? '未填色号',
      weight: Number(row.weight),
      packages: row.packages,
      cost: Number(row.cost),
      freight: Number(row.freight),
      rows: [row],
    })
  }

  return [...grouped.values()]
}

export function getSaleInventoryChoices<T extends {
  warehouseId: string
  yarnName: string
  color: string | null
}>(rows: T[], warehouseId: string) {
  const warehouseRows = rows.filter((row) => row.warehouseId === warehouseId)

  return {
    yarnNames: uniqueInOrder(warehouseRows.map((row) => row.yarnName)),
    colorsFor(yarnName: string) {
      if (!yarnName) return []
      return uniqueInOrder(
        warehouseRows
          .filter((row) => row.yarnName === yarnName)
          .map((row) => row.color ?? '未填色号'),
      )
    },
    rowsFor(yarnName: string, color: string) {
      if (!yarnName || !color) return []
      return warehouseRows.filter(
        (row) => row.yarnName === yarnName && (row.color ?? '未填色号') === color,
      )
    },
  }
}

export function findScannedInventory<
  T extends {
    warehouseId: string
    scanCode?: string | null
    lotNo?: string | null
  },
>(rows: T[], warehouseId: string, code: string): T | null {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return null
  const matches = rows.filter(
    (row) =>
      row.scanCode?.toUpperCase() === normalized || row.lotNo?.toUpperCase() === normalized,
  )
  return matches.find((row) => row.warehouseId === warehouseId) ?? matches[0] ?? null
}
