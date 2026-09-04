// 端到端验收脚本（自包含、可重复运行）
// 登录 → 自建 E2E 测试数据（纱线/仓库/供应商/客户/买入）→ 卖出 → 调拨 → 盘库 → 结算 → 页面检查
// 不依赖演示数据，也不会改动已有业务数据（只新增带 E2E 前缀的测试记录）
// 用法：node scripts/e2e.mjs
import { readFileSync } from 'node:fs'

const base = process.env.E2E_BASE_URL || 'http://localhost:3000'
const ts = Date.now()

let e2ePassword = process.env.E2E_PASSWORD
if (!e2ePassword) {
  try {
    const env = readFileSync('.env', 'utf8')
    const m = env.match(/^ADMIN1_PASSWORD="?([^"\n]+)"?/m)
    if (m) e2ePassword = m[1]
  } catch {}
}
const password = e2ePassword || 'demo123456'

let admin2Password = process.env.E2E_PASSWORD2
if (!admin2Password) {
  try {
    const env = readFileSync('.env', 'utf8')
    const m = env.match(/^ADMIN2_PASSWORD="?([^"\n]+)"?/m)
    if (m) admin2Password = m[1]
  } catch {}
}

async function req(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers }
  if (cookie) h.Cookie = cookie
  const res = await fetch(base + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json, text, setCookie: res.headers.get('set-cookie') }
}

function check(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` -> ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

const login = await req('/api/auth/login', {
  method: 'POST',
  body: { username: 'admin', password },
})
check('登录', login.status === 200)
if (!login.setCookie) {
  throw new Error(`登录未返回会话 Cookie（HTTP ${login.status}）：${login.text}`)
}
const cookie = login.setCookie.split(';')[0]

let locked = false
for (let i = 0; i < 6; i++) {
  const bad = await req('/api/auth/login', {
    method: 'POST',
    body: { username: `E2E锁定-${ts}`, password: 'wrong' },
  })
  if (bad.status === 429) locked = true
}
check('连续失败后锁定(429)', locked)

const whA = await req('/api/warehouses', {
  method: 'POST',
  cookie,
  body: { name: `E2E仓A-${ts}` },
})
check('建测试仓A', whA.status === 201)

const csrf = await req('/api/warehouses', {
  method: 'POST',
  cookie,
  headers: { Origin: 'http://evil.example' },
  body: { name: `E2ECS-${ts}` },
})
check('跨站来源被拦截(403)', csrf.status === 403)

const whB = await req('/api/warehouses', {
  method: 'POST',
  cookie,
  body: { name: `E2E仓B-${ts}` },
})
check('建测试仓B', whB.status === 201)
const yarn = await req('/api/yarns', {
  method: 'POST',
  cookie,
  body: { name: `E2E纱线-${ts}` },
})
check('建测试产品', yarn.status === 201)
const variant = await req('/api/yarn-variants', {
  method: 'POST',
  cookie,
  body: { yarnId: yarn.json.id, spec: '32支', color: '白', unit: 'kg' },
})
check('建测试变体', variant.status === 201)
const supplier = await req('/api/counterparties', {
  method: 'POST',
  cookie,
  body: { name: `E2E供应商-${ts}`, type: 'SUPPLIER' },
})
check('建测试供应商', supplier.status === 201)
const customer = await req('/api/counterparties', {
  method: 'POST',
  cookie,
  body: { name: `E2E客户-${ts}`, type: 'CUSTOMER' },
})
check('建测试客户', customer.status === 201)

const batchNo = `E2E-${ts}`
const buyColor = `新色-${ts}`
const purchase = await req('/api/purchases', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-11',
    supplierId: supplier.json.id,
    warehouseId: whA.json.id,
    handlerName: 'admin',
    freight: 300,
    note: 'E2E备注',
    items: [{ yarnId: yarn.json.id, spec: '32支', color: buyColor, unit: 'kg', batchNo, weight: 1000, price: 20 }],
  },
})
check('买入保存', purchase.status === 201, purchase.json?.orderNo ?? purchase.text)
const variantsAfterBuy = await req(`/api/yarn-variants?yarnId=${yarn.json.id}`, { cookie })
check('买入自动创建新颜色变体', variantsAfterBuy.json.some((v) => v.color === buyColor))

const inv = await req('/api/inventory', { cookie })
const row = inv.json.find((r) => r.batch.batchNo === batchNo)
check('找到测试库存 1000kg', row && Number(row.weight) === 1000, row?.weight)

const sale = await req('/api/sales', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-11',
    customerId: customer.json.id,
    warehouseId: whA.json.id,
    handlerName: 'admin',
    freight: 50,
    items: [{ inventoryId: row.id, weight: 100, price: 22, packages: 2 }],
  },
})
check('卖出保存', sale.status === 201, sale.json?.orderNo ?? sale.text)

const inv2 = await req('/api/inventory', { cookie })
const row2 = inv2.json.find((r) => r.batch.batchNo === batchNo && r.warehouseId === whA.json.id)
check('卖出后库存 900', row2 && Number(row2.weight) === 900, row2?.weight)

const transfer = await req('/api/transfers', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-11',
    fromWarehouseId: whA.json.id,
    toWarehouseId: whB.json.id,
    handlerName: 'admin',
    items: [{ inventoryId: row.id, weight: 50 }],
  },
})
check('调拨保存', transfer.status === 201, transfer.json?.orderNo ?? transfer.text)

const renamed = await req(`/api/warehouses/${whA.json.id}`, {
  method: 'PATCH',
  cookie,
  body: { name: `E2E仓A改-${ts}` },
})
check('仓库改名', renamed.status === 200 && renamed.json?.name === `E2E仓A改-${ts}`)

const purchasesAfterRename = await req('/api/purchases', { cookie })
const renamedPo = purchasesAfterRename.json.find((p) => p.warehouseId === whA.json.id)
check(
  '改名后单据实时显示新名',
  renamedPo && renamedPo.warehouse?.name === `E2E仓A改-${ts}`,
  renamedPo?.warehouse?.name,
)

const inv3 = await req('/api/inventory', { cookie })
const row3 = inv3.json.find((r) => r.batch.batchNo === batchNo && r.warehouseId === whA.json.id)
const targetRow = inv3.json.find((r) => r.batch.batchNo === batchNo && r.warehouseId === whB.json.id)
check(
  '调拨后来源 850 / 目标 50',
  row3 && Number(row3.weight) === 850 && targetRow && Number(targetRow.weight) === 50,
  `${row3?.weight}/${targetRow?.weight}`,
)

const factory = await req('/api/warehouses', {
  method: 'POST',
  cookie,
  body: { name: `E2E染厂-${ts}`, type: 'FACTORY' },
})
check('建加工厂', factory.status === 201)
const feeTransfer = await req('/api/transfers', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-11',
    fromWarehouseId: whA.json.id,
    toWarehouseId: factory.json.id,
    handlerName: 'admin',
    freight: 80,
    items: [{ inventoryId: row.id, weight: 200 }],
  },
})
check('送加工保存', feeTransfer.status === 201, feeTransfer.json?.orderNo ?? feeTransfer.text)
const transferList = await req('/api/transfers', { cookie })
const feeRow = transferList.json.find((t) => t.orderNo === feeTransfer.json.orderNo)
check(
  '送加工不含加工费、含运费',
  feeRow && feeRow.processingFeePerKg == null && Number(feeRow.freight) === 80,
)

const factoryInv = await req('/api/inventory', { cookie })
const frRow = factoryInv.json.find((r) => r.warehouseId === factory.json.id)
check('加工厂有送加工库存 200kg', frRow && Number(frRow.weight) === 200, frRow?.weight)
check('加工厂库存未算加工费', frRow && frRow.processingFeeSettled === false)

const blockOut = await req('/api/transfers', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-11',
    fromWarehouseId: factory.json.id,
    toWarehouseId: whB.json.id,
    handlerName: 'admin',
    items: [{ inventoryId: frRow.id, weight: 10 }],
  },
})
check(
  '未算货调拨出加工厂被拒',
  blockOut.status === 400 && blockOut.json?.error?.includes('未结算加工费'),
  blockOut.json?.error,
)

const blockSale = await req('/api/sales', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-11',
    customerId: customer.json.id,
    warehouseId: factory.json.id,
    handlerName: 'admin',
    items: [{ inventoryId: frRow.id, weight: 10, price: 25 }],
  },
})
check(
  '未算货卖出自加工厂被拒',
  blockSale.status === 400 && blockSale.json?.error?.includes('未结算加工费'),
  blockSale.json?.error,
)

const blockPr = await req('/api/processing-returns', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-13',
    factoryId: factory.json.id,
    warehouseId: whA.json.id,
    handlerName: 'admin',
    freight: 50,
    items: [
      {
        inventoryId: frRow.id,
        weight: 100,
        spec: '20支',
        color: '紫',
        unit: 'kg',
        batchNo: `PR-${ts}`,
        outputWeight: 800,
      },
    ],
  },
})
check(
  '未算货加工收回被拒',
  blockPr.status === 400 && blockPr.json?.error?.includes('未结算加工费'),
  blockPr.json?.error,
)

const feeSettle = await req(`/api/inventory/${frRow.id}`, {
  method: 'PATCH',
  cookie,
  body: {
    processingFeePerKg: 2,
    inputWeight: 100,
    spec: '20支',
    color: '紫',
    unit: 'kg',
    batchNo: `PR-${ts}`,
    outputWeight: 80,
  },
})
check(
  '结算弹窗登记变化 20支/紫 80kg 成本 2160',
  feeSettle.status === 200 && feeSettle.json?.cost === '2160',
  feeSettle.json?.cost,
)

const afterTransform = await req('/api/inventory', { cookie })
const prRow = afterTransform.json.find(
  (r) => r.batch.batchNo === `PR-${ts}` && r.warehouseId === factory.json.id,
)
check(
  '加工后新行 80kg/成本 2160/已算',
  prRow &&
    prRow.variant.spec === '20支' &&
    prRow.variant.color === '紫' &&
    Number(prRow.weight) === 80 &&
    Number(prRow.cost).toFixed(2) === '2160.00' &&
    prRow.processingFeeSettled === true,
  `${prRow?.weight}/${prRow?.cost}`,
)
const whiteRemain = afterTransform.json.find(
  (r) => r.batch.batchNo === batchNo && r.warehouseId === factory.json.id,
)
check(
  '部分结算后白坯剩余 100kg 未算',
  whiteRemain && Number(whiteRemain.weight) === 100 && whiteRemain.processingFeeSettled === false,
  `${whiteRemain?.weight}/${whiteRemain?.processingFeeSettled}`,
)

const whAfter = await req('/api/warehouses', { cookie })
const factoryWh = whAfter.json.find((w) => w.id === factory.json.id)
check(
  '加工厂欠款 160 元/明细 1 条',
  factoryWh && Number(factoryWh.feeOwed).toFixed(2) === '160.00' && factoryWh.feeCount === 1,
  `${factoryWh?.feeOwed}/${factoryWh?.feeCount}`,
)
check(
  '最近明细含本次加工 100kg 加工费 2 元/kg',
  factoryWh?.processingFeeSettlements?.length === 1 &&
    Number(factoryWh.processingFeeSettlements[0].inputWeight) === 100 &&
    Number(factoryWh.processingFeeSettlements[0].feePerKg) === 2,
)

const feePay = await req('/api/processing-fee-payments', {
  method: 'POST',
  cookie,
  body: {
    factoryId: factory.json.id,
    amount: 100,
    date: '2026-08-14',
    method: '微信',
    handlerName: 'admin',
  },
})
check('加工费付款保存', feePay.status === 201, feePay.json?.error ?? feePay.text)
const whAfterPay = await req('/api/warehouses', { cookie })
const factoryWh2 = whAfterPay.json.find((w) => w.id === factory.json.id)
check(
  '付款后欠款 60 元',
  factoryWh2 && Number(factoryWh2.feeOwed).toFixed(2) === '60.00',
  factoryWh2?.feeOwed,
)

const overPay = await req('/api/processing-fee-payments', {
  method: 'POST',
  cookie,
  body: { factoryId: factory.json.id, amount: 61, date: '2026-08-14', handlerName: 'admin' },
})
check(
  '加工费超付被拒',
  overPay.status === 400 && overPay.json?.error?.includes('超过未结金额'),
  overPay.json?.error,
)

const payRows = await req('/api/processing-fee-payments', { cookie })
const payRow = payRows.json.find((p) => p.factoryId === factory.json.id)
check('付款记录列表含 100 元', payRow && Number(payRow.amount) === 100, payRow?.amount)
await checkExport('导出加工费对账单xlsx', `section=factory-statement&warehouseId=${factory.json.id}`)

const variantsAfter = await req(`/api/yarn-variants?yarnId=${yarn.json.id}`, { cookie })
check(
  '结算登记自动创建新变体 20支/紫',
  variantsAfter.json.some((v) => v.spec === '20支' && v.color === '紫'),
)

const saleOut = await req('/api/sales', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-13',
    customerId: customer.json.id,
    warehouseId: factory.json.id,
    handlerName: 'admin',
    items: [{ inventoryId: prRow.id, weight: 10, price: 25 }],
  },
})
check('加工后直接卖出自加工厂成功', saleOut.status === 201, saleOut.json?.orderNo ?? saleOut.text)

const transferOut = await req('/api/transfers', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-13',
    fromWarehouseId: factory.json.id,
    toWarehouseId: whB.json.id,
    handlerName: 'admin',
    items: [{ inventoryId: prRow.id, weight: 70 }],
  },
})
check('加工后调拨出加工厂成功', transferOut.status === 201, transferOut.json?.orderNo ?? transferOut.text)

const invAfterOut = await req('/api/inventory', { cookie })
const whBRow = invAfterOut.json.find(
  (r) => r.batch.batchNo === `PR-${ts}` && r.warehouseId === whB.json.id,
)
check('调拨目标行 70kg', whBRow && Number(whBRow.weight) === 70, whBRow?.weight)

const tPage2 = await fetch(base + '/app/transfers', { headers: { Cookie: cookie } })
const tHtml2 = await tPage2.text()
check(
  '调拨页可访问且含记录区块',
  tPage2.status === 200 && tHtml2.includes('调拨记录') && tHtml2.includes('加工收回记录'),
)

const rPage4 = await fetch(base + '/app/reports', { headers: { Cookie: cookie } })
const rHtml4 = await rPage4.text()
check('报表页含库存成本口径', rHtml4.includes('库存成本'))

const oPage = await fetch(base + '/app/orders', { headers: { Cookie: cookie } })
const oHtml = await oPage.text()
check(
  '出入库记录页可访问',
  oPage.status === 200 &&
    oHtml.includes('出入库记录') &&
    oHtml.includes('打印') &&
    oHtml.includes('纱线关键词') &&
    oHtml.includes('供应商/客户') &&
    oHtml.includes('支数'),
)

const yPage = await fetch(base + '/app/yarns', { headers: { Cookie: cookie } })
const yHtml = await yPage.text()
check(
  '纱线档案页表格正常渲染',
  yPage.status === 200 &&
    yHtml.includes('名称') &&
    yHtml.includes('支数') &&
    yHtml.includes('色号') &&
    yHtml.includes('expand-variants'),
)

const cpPage = await fetch(base + '/app/counterparties', { headers: { Cookie: cookie } })
const cpHtml = await cpPage.text()
check(
  '往来单位页可访问',
  cpPage.status === 200 && cpHtml.includes('往来单位') && cpHtml.includes('折让金'),
)

const iPage = await fetch(base + '/app/inventory', { headers: { Cookie: cookie } })
const iHtml = await iPage.text()
check(
  '库存页含批次成本列',
  iPage.status === 200 && iHtml.includes('单位成本') && iHtml.includes('含运费单价'),
)
check(
  '库存页含内部批次追溯入口',
  iHtml.includes('内部批次') && iHtml.includes('/app/lots/'),
)

const stocktake = await req('/api/stocktakes', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-11',
    warehouseId: whA.json.id,
    handlerName: 'clerk',
    items: [{ inventoryId: row.id, actualWeight: 0 }],
  },
})
check('盘库保存', stocktake.status === 201, stocktake.json?.orderNo ?? stocktake.text)

const invZero = await req(
  `/api/inventory?warehouseId=${whA.json.id}&includeZero=1`,
  { cookie },
)
check(
  '盘库清零后 0kg 行仍在（未归档）',
  invZero.json.some((r) => r.batch.batchNo === batchNo && r.warehouseId === whA.json.id),
)
const archiveZero = await req('/api/inventory/archive-zero', {
  method: 'POST',
  cookie,
  body: { warehouseId: whA.json.id },
})
check(
  '盘掉 0kg 库存成功',
  archiveZero.status === 200 && Number(archiveZero.json?.count) === 1,
  `${archiveZero.status}/${archiveZero.json?.count}`,
)
const invAfterArchive = await req(
  `/api/inventory?warehouseId=${whA.json.id}&includeZero=1`,
  { cookie },
)
check(
  '盘掉后 0kg 行不再显示',
  !invAfterArchive.json.some((r) => r.batch.batchNo === batchNo && r.warehouseId === whA.json.id),
)
const stPage = await fetch(base + '/app/stocktakes/new', { headers: { Cookie: cookie } })
const stHtml = await stPage.text()
check('盘库页含盘掉按钮', stPage.status === 200 && stHtml.includes('盘掉 0kg 库存'))

const open1 = await req('/api/settlements', { cookie })
const po = open1.json.find(
  (o) => o.side === 'PURCHASE' && o.name === `E2E供应商-${ts}`,
)
check('未结清单含测试供应商', Boolean(po), po ? `未结 ${po.remainingAmount}` : '')

const poCheck = await req('/api/purchases', { cookie })
const poRow = poCheck.json.find((p) => p.orderNo === purchase.json.orderNo)
check(
  '运费不计入总额但被保存',
  poRow &&
    Number(poRow.totalAmount) === 20000 &&
    Number(poRow.freight) === 300 &&
    poRow.note === 'E2E备注',
)

const settle1 = await req('/api/settlements', {
  method: 'POST',
  cookie,
  body: {
    side: 'PURCHASE',
    counterpartyId: supplier.json.id,
    amount: 10000,
    date: '2026-08-11',
    method: '银行转账',
    handlerName: 'admin',
  },
})
check('部分结算保存', settle1.status === 201)

const open2 = await req('/api/settlements', { cookie })
const poAfter = open2.json.find(
  (o) => o.side === 'PURCHASE' && o.name === `E2E供应商-${ts}`,
)
check('结算后未结实时更新为 10000', poAfter && Number(poAfter.remainingAmount) === 10000, poAfter?.remainingAmount)

const over = await req('/api/settlements', {
  method: 'POST',
  cookie,
  body: {
    side: 'PURCHASE',
    counterpartyId: supplier.json.id,
    amount: 99999,
    date: '2026-08-11',
    handlerName: 'admin',
  },
})
check('超结拦截', over.status === 400 && over.json?.error?.includes('超过未结金额'), over.json?.error)

const discount = await req('/api/settlements', {
  method: 'POST',
  cookie,
  body: {
    side: 'SALE',
    counterpartyId: customer.json.id,
    amount: 500,
    date: '2026-08-12',
    method: '折让',
    handlerName: 'clerk',
  },
})
check('折让结算保存', discount.status === 201, discount.json?.error ?? discount.text)

const cpList = await req('/api/counterparties', { cookie })
const cpRow = cpList.json.find((c) => c.id === customer.json.id)
check(
  '往来单位折让金汇总正确',
  cpRow && Number(cpRow.discountTotal) === 500 && cpRow.discountRecords?.length === 1,
  JSON.stringify(cpRow ?? null),
)

const sPage = await fetch(base + '/app/settlements', { headers: { Cookie: cookie } })
const sHtml = await sPage.text()
check('结算页可访问', sPage.status === 200 && sHtml.includes('资金结算'))
check('结算页买入/卖出分开', sHtml.includes('应付供应商') && sHtml.includes('应收客户'))
check('结算页含登记与记录入口', sHtml.includes('登记结算') && sHtml.includes('结算记录'))

const revertVariantColor = `撤回-${ts}`
const revertPo = await req('/api/purchases', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-15',
    supplierId: supplier.json.id,
    warehouseId: whA.json.id,
    handlerName: 'admin',
    items: [
      {
        yarnId: yarn.json.id,
        spec: '32支',
        color: revertVariantColor,
        unit: 'kg',
        batchNo: `E2ER-${ts}`,
        weight: 500,
        price: 20,
      },
    ],
  },
})
check('撤回测试买入保存', revertPo.status === 201, revertPo.json?.orderNo ?? revertPo.text)
const revertSettle = await req('/api/settlements', {
  method: 'POST',
  cookie,
  body: {
    side: 'PURCHASE',
    counterpartyId: supplier.json.id,
    amount: 3000,
    date: '2026-08-15',
    handlerName: 'admin',
  },
})
check('撤回测试结算保存', revertSettle.status === 201)

const settleId = revertSettle.json?.id
if (!settleId) throw new Error('撤回测试结算未返回记录 ID')
const login2 = await req('/api/auth/login', {
  method: 'POST',
  body: { username: 'clerk', password: admin2Password || 'demo123456' },
})
check('clerk登录成功', login2.status === 200)
if (!login2.setCookie) {
  throw new Error(`clerk 登录未返回会话 Cookie（HTTP ${login2.status}）：${login2.text}`)
}
const cookie2 = login2.setCookie.split(';')[0]
const forbidden = await req(`/api/settlements/${settleId}`, { method: 'DELETE', cookie: cookie2 })
check('非经办人撤回被拒(403)', forbidden.status === 403, forbidden.json?.error)
const delSettle = await req(`/api/settlements/${settleId}`, { method: 'DELETE', cookie })
check('经办人撤回结算成功', delSettle.status === 200)

const invRev = await req('/api/inventory', { cookie })
const revRow = invRev.json.find(
  (r) => r.batch.batchNo === `E2ER-${ts}` && r.warehouseId === whA.json.id,
)
const revSale = await req('/api/sales', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-15',
    customerId: customer.json.id,
    warehouseId: whA.json.id,
    handlerName: 'admin',
    items: [{ inventoryId: revRow.id, weight: 100, price: 22 }],
  },
})
check('撤回测试卖出保存', revSale.status === 201, revSale.json?.orderNo ?? revSale.text)
const revSaleList = await req('/api/sales', { cookie })
const revSaleRow = revSaleList.json.find((o) => o.orderNo === revSale.json.orderNo)
const delSale = await req(`/api/sales/${revSaleRow.id}`, { method: 'DELETE', cookie })
check('撤回卖出成功', delSale.status === 200)

const revertPoList = await req('/api/purchases', { cookie })
const revertPoRow = revertPoList.json.find((o) => o.orderNo === revertPo.json.orderNo)
const delPo = await req(`/api/purchases/${revertPoRow.id}`, { method: 'DELETE', cookie })
check(
  '有下游流水的买入即使销售已撤回仍保留来源链',
  delPo.status === 400 && delPo.json?.error?.includes('已被卖出、调拨、加工或盘点'),
  delPo.json?.error,
)
const afterRev = await req('/api/inventory', { cookie })
const restoredRevRow = afterRev.json.find(
  (r) => r.batch.batchNo === `E2ER-${ts}` && r.warehouseId === whA.json.id,
)
check(
  '撤回销售后来源批次库存恢复',
  restoredRevRow && Number(restoredRevRow.weight) === 500,
  restoredRevRow?.weight,
)

const cleanPo = await req('/api/purchases', {
  method: 'POST',
  cookie,
  body: {
    date: '2026-08-16',
    supplierId: supplier.json.id,
    warehouseId: whA.json.id,
    handlerName: 'admin',
    items: [{
      yarnId: yarn.json.id,
      spec: '32支',
      color: `可撤回-${ts}`,
      unit: 'kg',
      batchNo: `E2ECLEAN-${ts}`,
      weight: 200,
      price: 20,
    }],
  },
})
check('无下游买入保存', cleanPo.status === 201, cleanPo.json?.orderNo ?? cleanPo.text)
const cleanPoList = await req('/api/purchases', { cookie })
const cleanPoRow = cleanPoList.json.find((o) => o.orderNo === cleanPo.json.orderNo)
const delCleanPo = await req(`/api/purchases/${cleanPoRow.id}`, { method: 'DELETE', cookie })
check('无下游买入通过反向流水撤回', delCleanPo.status === 200, delCleanPo.json?.error)

const open3 = await req('/api/settlements', { cookie })
const poFinal = open3.json.find(
  (o) => o.side === 'PURCHASE' && o.name === `E2E供应商-${ts}`,
)
check(
  '撤回后应付只统计仍有效的 30000、已付 10000',
  poFinal &&
    Number(poFinal.totalAmount) === 30000 &&
    Number(poFinal.settledAmount) === 10000 &&
    Number(poFinal.remainingAmount) === 20000,
  `${poFinal?.settledAmount}/${poFinal?.remainingAmount}`,
)
const rPage = await fetch(base + '/app/reports', { headers: { Cookie: cookie } })
const rHtml = await rPage.text()
check('报表页可访问', rPage.status === 200 && rHtml.includes('报表'))

const dPage = await fetch(base + '/app/dashboard', { headers: { Cookie: cookie } })
const dHtml = await dPage.text()
check('首页含盘点提醒列', dPage.status === 200 && dHtml.includes('盘点提醒'))

const rPage2 = await fetch(base + '/app/reports?customerId=' + (customer.json?.id ?? ''), {
  headers: { Cookie: cookie },
})
const rHtml2 = await rPage2.text()
check('报表页含客户订单查询', rHtml2.includes('客户订单查询'))
check('报表页含供应商订单查询', rHtml2.includes('供应商订单查询'))

const rPage3 = await fetch(base + '/app/reports', { headers: { Cookie: cookie } })
const rHtml3 = await rPage3.text()
check('报表页含毛利估算', rHtml3.includes('毛利估算'))

const dPage2 = await fetch(base + '/app/dashboard', { headers: { Cookie: cookie } })
const dHtml2 = await dPage2.text()
check('首页导航高亮已渲染', dHtml2.includes('bg-blue-600'))

const auditPage = await fetch(base + '/app/audit', { headers: { Cookie: cookie } })
const auditHtml = await auditPage.text()
check('日志页可访问', auditPage.status === 200 && auditHtml.includes('安全日志'))
check('日志含登录成功', auditHtml.includes('登录成功'))
check('日志含新增仓库', auditHtml.includes('新增仓库'))
check('日志含买入入库', auditHtml.includes('买入入库'))
check('日志含撤回', auditHtml.includes('撤回'))

async function checkExport(label, query) {
  const res = await fetch(base + '/api/export?' + query, { headers: { Cookie: cookie } })
  const buf = new Uint8Array(await res.arrayBuffer())
  const isXlsx = res.status === 200 && buf[0] === 0x50 && buf[1] === 0x4b
  check(label, isXlsx)
}

await checkExport(
  '导出客户订单xlsx',
  `section=customer-orders&customerId=${customer.json.id}&customerStatus=ALL`,
)
await checkExport(
  '导出供应商订单xlsx',
  `section=supplier-orders&supplierId=${supplier.json.id}&supplierStatus=ALL`,
)
await checkExport('导出库存金额xlsx', 'section=inventory')
await checkExport('导出应付xlsx', 'section=payables')
await checkExport('导出应收xlsx', 'section=receivables')
await checkExport('导出流水xlsx', 'section=flow')
await checkExport('导出出入库记录xlsx', 'section=orders&type=ALL')
await checkExport('导出结算记录xlsx', 'section=settlements')
await checkExport('导出对账单xlsx', `section=statement&counterpartyId=${supplier.json.id}`)

const delWh = await req('/api/warehouses', {
  method: 'POST',
  cookie,
  body: { name: `E2E临时仓-${ts}` },
})
check('建临时仓', delWh.status === 201)
const delWhRes = await req(`/api/warehouses/${delWh.json.id}`, { method: 'DELETE', cookie })
check('删除未引用仓库成功', delWhRes.status === 200)
const delUsedWh = await req(`/api/warehouses/${whA.json.id}`, { method: 'DELETE', cookie })
check('删除已引用仓库被拒', delUsedWh.status === 400, delUsedWh.json?.error)
const delUsedCp = await req(`/api/counterparties/${supplier.json.id}`, { method: 'DELETE', cookie })
check('删除已引用供应商被拒', delUsedCp.status === 400)
const tmpCp = await req('/api/counterparties', {
  method: 'POST',
  cookie,
  body: { name: `E2E临时往来-${ts}`, type: 'CUSTOMER' },
})
check('建临时往来单位', tmpCp.status === 201)
const delTmpCp = await req(`/api/counterparties/${tmpCp.json.id}`, { method: 'DELETE', cookie })
check('删除未引用往来单位成功', delTmpCp.status === 200)
const delUsedYarn = await req(`/api/yarns/${yarn.json.id}`, { method: 'DELETE', cookie })
check('删除已引用纱线被拒', delUsedYarn.status === 400)
const tmpYarn = await req('/api/yarns', { method: 'POST', cookie, body: { name: `E2E临时纱-${ts}` } })
const tmpVariant = await req('/api/yarn-variants', {
  method: 'POST',
  cookie,
  body: { yarnId: tmpYarn.json.id, spec: '21支', color: '灰', unit: 'kg' },
})
check('建临时纱线+变体', tmpYarn.status === 201 && tmpVariant.status === 201)
const delTmpVariant = await req(`/api/yarn-variants/${tmpVariant.json.id}`, {
  method: 'DELETE',
  cookie,
})
check('删除未引用变体成功', delTmpVariant.status === 200)
const delTmpYarn = await req(`/api/yarns/${tmpYarn.json.id}`, { method: 'DELETE', cookie })
check('删除无变体纱线成功', delTmpYarn.status === 200)

console.log(process.exitCode ? '存在失败项' : '全部通过')
