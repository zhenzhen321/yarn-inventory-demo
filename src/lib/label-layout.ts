export interface LabelSettings {
  width: number
  height: number
  padding: number
  topOffset: number
  fontSize: number
}

export interface LabelPrintOrder {
  orderNo: string
  items: {
    yarnName: string
    spec: string
    color: string
    weight: string
    unit: string
    packages: number | null
    batchNo?: string | null
    lotNo?: string | null
    scanCode?: string | null
  }[]
}

export interface PrintableLabel {
  item: LabelPrintOrder['items'][number]
  qr: string
}

function escapeHtml(value: string) {
  return value.replace(/\s+/g, ' ').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[ch]!)
}

// 预览和打印共用毫米尺寸、HTML、CSS和实测缩字算法。
export function buildLabelDocument(orderNo: string, labels: PrintableLabel[], settings: LabelSettings) {
  const { width, height, padding, topOffset, fontSize } = settings
  const qrSize = Math.max(0, Math.min(20, (width - padding * 2) * .35, (height - padding * 2 - topOffset) * .65))
  const line = (kind: string, factor: number, text: string) =>
    `<div class="line ${kind}" data-factor="${factor}"><span>${escapeHtml(text)}</span></div>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
    <title>标签打印 - ${escapeHtml(orderNo)}</title>
    <style>
      @page { size: ${width}mm ${height}mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { color: #000; background: #fff; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
      .label {
        width: ${width}mm; height: ${height}mm;
        padding: ${padding + topOffset}mm ${padding}mm ${padding}mm;
        display: flex; flex-direction: column; gap: .4mm;
        break-inside: avoid; break-after: page; page-break-after: always;
        visibility: hidden;
      }
      .label[data-fit] { visibility: visible; }
      .label:last-child { break-after: auto; page-break-after: auto; }
      .line { flex: none; min-width: 0; line-height: 1.2; white-space: nowrap; }
      .line span { display: inline-block; white-space: nowrap; }
      .body { display: grid; grid-template-columns: minmax(0, 1fr) ${qrSize}mm; gap: 1mm; flex: 1; min-height: 0; }
      .info { min-width: 0; min-height: 0; display: flex; flex-direction: column; justify-content: center; gap: .4mm; }
      .yarn-name, .quantity { font-weight: 800; }
      .lot-no { font-weight: 700; }
      .qr { display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 0; }
      .qr img { display: block; flex: none; width: ${qrSize}mm; height: ${qrSize}mm; image-rendering: pixelated; }
      .no-qr { font-size: 6pt; text-align: center; }
    </style></head><body>${labels.map(({ item, qr }) => `
      <section class="label" data-max-font="${fontSize}">
        ${line('order-no', .65, orderNo)}
        <div class="body">
          <div class="info">
            ${line('yarn-name', 1.4, item.yarnName)}
            ${line('detail', .9, `${item.spec} · ${item.color}`)}
            ${line('quantity', 1.02, `${item.weight} ${item.unit}${item.packages !== null ? ` · ${item.packages} 件` : ''}`)}
          </div>
          <div class="qr">${qr ? `<img src="${escapeHtml(qr)}" alt="批次二维码"/>` : '<div class="no-qr">历史库存<br/>无二维码</div>'}</div>
        </div>
        ${line('batch-no', .8, `批次 ${item.batchNo || '-'}`)}
        ${line('lot-no', .65, item.lotNo || '历史库存')}
      </section>`).join('')}</body></html>`
}

export interface LabelFitResult {
  ok: boolean
  minFontPt: number
  message: string
}

// 字号最低5pt，再小则提示扩大纸张或缩短内容，禁止静默裁切。
export async function fitLabelDocument(doc: Document): Promise<LabelFitResult[]> {
  await doc.fonts.ready
  await Promise.all(Array.from(doc.images).map((img) => img.decode()))
  const view = doc.defaultView!
  return Array.from(doc.querySelectorAll<HTMLElement>('.label')).map((label) => {
    const lines = Array.from(label.querySelectorAll<HTMLElement>('.line'))
    const info = label.querySelector<HTMLElement>('.info')!
    const qr = label.querySelector<HTMLElement>('.qr')!
    const MIN_PT = 5
    let minFontPt = MIN_PT
    let fits = false
    for (let base = Number(label.dataset.maxFont); base >= MIN_PT; base = Math.round((base - .25) * 100) / 100) {
      for (const row of lines) {
        const span = row.firstElementChild as HTMLElement
        let size = Math.max(MIN_PT, base * Number(row.dataset.factor))
        row.style.fontSize = `${size}pt`
        const available = row.getBoundingClientRect().width - .5
        const measured = span.getBoundingClientRect().width
        if (measured > available && measured > 0) {
          size = Math.max(MIN_PT, Math.floor(size * available / measured * 10) / 10)
          row.style.fontSize = `${size}pt`
        }
      }
      const bounds = label.getBoundingClientRect()
      const style = view.getComputedStyle(label)
      const left = bounds.left + parseFloat(style.paddingLeft)
      const right = bounds.right - parseFloat(style.paddingRight)
      const top = bounds.top + parseFloat(style.paddingTop)
      const bottom = bounds.bottom - parseFloat(style.paddingBottom)
      const infoBounds = info.getBoundingClientRect()
      fits = right > left && bottom > top && lines.every((row) => {
        const text = row.firstElementChild!.getBoundingClientRect()
        const rowBounds = row.getBoundingClientRect()
        const inInfo = info.contains(row)
        return text.left >= left - .1 && text.right <= Math.min(right, rowBounds.right) + .1 &&
          rowBounds.top >= Math.max(top, inInfo ? infoBounds.top : top) - .1 &&
          rowBounds.bottom <= Math.min(bottom, inInfo ? infoBounds.bottom : bottom) + .1
      })
      const image = qr.querySelector('img')
      if (image) {
        const rect = image.getBoundingClientRect()
        const space = qr.getBoundingClientRect()
        fits = fits && rect.width >= 10 * 96 / 25.4 &&
          rect.left >= space.left - .1 && rect.right <= space.right + .1 &&
          rect.top >= Math.max(top, space.top) - .1 && rect.bottom <= Math.min(bottom, space.bottom) + .1
      }
      minFontPt = Math.min(...lines.map((row) => parseFloat(row.style.fontSize)))
      if (fits) break
    }
    label.dataset.fit = fits ? 'ok' : 'error'
    return {
      ok: fits,
      minFontPt,
      message: fits ? `已自动适配，最小字号 ${minFontPt.toFixed(1)} pt` : '标签空间不足，无法完整且清晰地打印。请增大纸张尺寸、减小留白，或缩短过长内容。',
    }
  })
}
