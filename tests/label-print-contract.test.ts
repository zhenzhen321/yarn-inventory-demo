import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const componentSource = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'labels', 'LabelPrintButton.tsx'),
  'utf8',
)
const layoutSource = readFileSync(path.resolve(process.cwd(), 'src/lib/label-layout.ts'), 'utf8')
const purchaseSource = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'purchases', 'PurchaseForm.tsx'),
  'utf8',
)
const saleSource = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'sales', 'SaleForm.tsx'),
  'utf8',
)
const orderTableSource = readFileSync(
  path.resolve(process.cwd(), 'src', 'components', 'orders', 'OrderTable.tsx'),
  'utf8',
)
const purchaseApiSource = readFileSync(
  path.resolve(process.cwd(), 'src', 'app', 'api', 'purchases', 'route.ts'),
  'utf8',
)

describe('独立批次二维码标签', () => {
  it('标签包含品名、规格色号、批次、重量、件数和内部批次号', () => {
    for (const field of [
      'order.orderNo',
      'item.yarnName',
      'item.spec',
      'item.color',
      'item.batchNo',
      'item.weight',
      'item.unit',
      'item.packages',
      'item.lotNo',
    ]) {
      expect(componentSource + layoutSource).toContain(field)
    }
    expect(componentSource).toContain('件')
    expect(purchaseApiSource).toContain('batchNo: item.batch.batchNo')
    expect(purchaseApiSource).toContain('lotNo: item.lot?.lotNo')
  })

  it('二维码在浏览器本地生成，不依赖外部二维码网站', () => {
    expect(componentSource).toContain("import QRCode from 'qrcode'")
    expect(componentSource).toContain('QRCode.toDataURL(scanCode')
    expect(componentSource).toContain('item.scanCode')
    expect(componentSource).not.toContain('api.qrserver.com')
  })

  it('首次打开时把二维码生成过程显示为加载中，不误报历史无二维码', () => {
    expect(componentSource).toContain('const [previewReady, setPreviewReady] = useState(false)')
    expect(componentSource).toContain('setPreviewReady(false)')
    expect(componentSource).toContain('setPreviewReady(true)')
    expect(componentSource).toContain('正在生成二维码并排版…')
    expect(componentSource).toContain('previewReady ? (')
  })

  it('支持常用毫米尺寸、自定义设置和本机记忆', () => {
    for (const size of ['40 × 30 mm', '50 × 30 mm', '60 × 40 mm']) {
      expect(componentSource).toContain(size)
    }
    expect(componentSource).toContain('自定义尺寸')
    expect(componentSource).toContain('localStorage')
    expect(layoutSource).toContain('@page')
    expect(componentSource).toContain('settings.width')
    expect(componentSource).toContain('settings.height')
    expect(componentSource).toContain('layoutVersion: SETTINGS_VERSION')
  })

  it('默认每个内部批次只打印一张，而不是按件数复制标签', () => {
    expect(componentSource).toContain('return order.items.map(() => 1)')
    expect(componentSource).toContain('默认每个批次一张')
    expect(componentSource).toContain('一批只贴一个标签')
  })

  it('采购保存后可立即打印，也可从有效历史订单补打', () => {
    expect(purchaseSource).toContain('打印本单标签')
    expect(orderTableSource).toContain('补打标签')
    expect(orderTableSource).toContain("order.orderType === 'PURCHASE' && !order.reversedAt")
    expect(orderTableSource).toContain('scanCode: item.scanCode')
  })

  it('扫码枪销售按内部扫码码匹配，并默认整批重量和件数', () => {
    expect(saleSource).toContain('扫码枪快速出库')
    expect(saleSource).toContain('aria-label="扫描标签二维码"')
    expect(saleSource).toContain('扫描 YMS-二维码或输入 LOT-内部批次号')
    expect(saleSource).toContain("event.key === 'Enter'")
    expect(saleSource).toContain('/api/sale-inventory?warehouseId=')
    expect(saleSource).toContain('weight: matched.weight')
    expect(saleSource).toContain("packages: matched.packages?.toString() ?? ''")
  })

  it('每次扫码尝试先清空输入，失败标签不会与下一张标签拼接', () => {
    const scanHandler = saleSource.slice(
      saleSource.indexOf('function addScannedLot('),
      saleSource.indexOf('async function onSubmit'),
    )
    expect(scanHandler.indexOf("setScanCode('')")).toBeGreaterThan(-1)
    expect(scanHandler.indexOf("setScanCode('')")).toBeLessThan(
      scanHandler.indexOf('fetch(`/api/sale-inventory?warehouseId='),
    )
  })

  it('扫码或粘贴内容先保留，按回车或点击加入后再处理', () => {
    expect(saleSource).toContain('function handleScanChange')
    expect(saleSource).toContain('setScanCode(value)')
    expect(saleSource).not.toContain('addScannedLot(value)')
    expect(saleSource).toContain("event.key === 'Enter'")
    expect(saleSource).toContain('onClick={() => void addScannedLot()}')
    expect(saleSource).toContain('setWarehouseId(matched.warehouseId)')
    expect(saleSource).toContain('已切换到')
    expect(saleSource).toContain('scanInputRef.current?.focus()')
  })
})
