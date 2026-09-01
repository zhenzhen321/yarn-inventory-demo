import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  getCustomerOrders,
  getInventoryValuation,
  getRecentFlow,
  getSupplierOrders,
} from '@/services/reports'
import { getOrderRecords } from '@/services/orders'
import {
  getCounterpartyStatement,
  getPayableSummary,
  getReceivableSummary,
  getSettlementRecords,
} from '@/services/settlement'
import { getFactoryStatement } from '@/services/factory-fee'

function num(v: Prisma.Decimal | string | number): number {
  return typeof v === 'number' ? v : Number(v)
}

function toCellValue(value: unknown): ExcelJS.CellValue {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value
  return String(value)
}

async function exportXlsx(sheetName: string, rows: Record<string, unknown>[], filename: string) {
  const plain = rows.map((r) => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) {
      o[k] = v instanceof Prisma.Decimal ? Number(v) : v
    }
    return o
  })
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(sheetName)
  const headers = plain.length > 0 ? Object.keys(plain[0]) : []
  if (headers.length > 0) {
    const headerRow = worksheet.addRow(headers)
    headerRow.font = { bold: true }
    for (const row of plain) {
      worksheet.addRow(headers.map((header) => toCellValue(row[header])))
    }
    worksheet.columns.forEach((column, index) => {
      const header = headers[index] ?? ''
      const maxLength = Math.max(
        header.length,
        ...plain.map((row) => String(row[header] ?? '').length),
      )
      column.width = Math.min(Math.max(maxLength + 2, 10), 40)
    })
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const section = url.searchParams.get('section') ?? ''
  const ymd = new Date().toISOString().slice(0, 10)

  if (section === 'customer-orders') {
    const customerId = url.searchParams.get('customerId') ?? ''
    if (!customerId) return NextResponse.json({ error: '缺少客户参数' }, { status: 400 })
    const orders = await getCustomerOrders(prisma, customerId)
    return exportXlsx(
      '客户订单',
      orders.map((o) => ({
        单号: o.orderNo,
        日期: o.date.toISOString().slice(0, 10),
        仓库: o.warehouseName,
        经办人: o.handlerName,
        总额: num(o.totalAmount),
        运费: num(o.freight),
      })),
      `客户订单-${ymd}.xlsx`,
    )
  }

  if (section === 'supplier-orders') {
    const supplierId = url.searchParams.get('supplierId') ?? ''
    if (!supplierId) return NextResponse.json({ error: '缺少供应商参数' }, { status: 400 })
    const orders = await getSupplierOrders(prisma, supplierId)
    return exportXlsx(
      '供应商订单',
      orders.map((o) => ({
        单号: o.orderNo,
        日期: o.date.toISOString().slice(0, 10),
        仓库: o.warehouseName,
        经办人: o.handlerName,
        总额: num(o.totalAmount),
        运费: num(o.freight),
      })),
      `供应商订单-${ymd}.xlsx`,
    )
  }

  if (section === 'inventory') {
    const valuation = await getInventoryValuation(prisma)
    return exportXlsx(
      '库存金额',
      valuation.map((w) => ({ 仓库: w.name, '重量(kg)': w.weight, '金额(元)': num(w.value) })),
      `库存金额-${ymd}.xlsx`,
    )
  }

  if (section === 'payables') {
    const payables = await getPayableSummary(prisma)
    return exportXlsx(
      '应付供应商',
      payables.map((p) => ({
        供应商: p.name,
        应付总额: num(p.totalAmount),
        已付: num(p.settledAmount),
        未付: num(p.remainingAmount),
      })),
      `应付供应商-${ymd}.xlsx`,
    )
  }

  if (section === 'receivables') {
    const receivables = await getReceivableSummary(prisma)
    return exportXlsx(
      '应收客户',
      receivables.map((r) => ({
        客户: r.name,
        应收总额: num(r.totalAmount),
        已收: num(r.settledAmount),
        未收: num(r.remainingAmount),
      })),
      `应收客户-${ymd}.xlsx`,
    )
  }

  if (section === 'flow') {
    const flow = await getRecentFlow(prisma, 30)
    return exportXlsx(
      '进出流水',
      flow.map((f) => ({
        类型: f.type === 'PURCHASE' ? '买入' : '卖出',
        单号: f.orderNo,
        日期: f.date.toISOString().slice(0, 10),
        对方: f.counterpartyName,
        仓库: f.warehouseName,
        金额: num(f.amount),
      })),
      `进出流水-${ymd}.xlsx`,
    )
  }

  if (section === 'orders') {
    const filter = {
      type: (url.searchParams.get('type') ?? 'ALL') as 'ALL' | 'PURCHASE' | 'SALE',
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      warehouseId: url.searchParams.get('warehouseId') ?? undefined,
      counterpartyId: url.searchParams.get('counterpartyId') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
      yarnQ: url.searchParams.get('yarnQ') ?? undefined,
    }
    const orders = await getOrderRecords(prisma, filter)
    const rows: Record<string, unknown>[] = []
    for (const o of orders) {
      for (const it of o.items) {
        rows.push({
          日期: o.date.toISOString().slice(0, 10),
          类型: o.orderType === 'PURCHASE' ? '买入' : '卖出',
          单号: o.orderNo,
          '供应商/客户': o.counterpartyName,
          仓库: o.warehouseName,
          经办人: o.handlerName,
          名称: it.yarnName,
          支数: it.spec,
          色号: it.color,
          单位: it.unit,
          数量: num(it.weight),
          金额: num(it.amount),
          货款合计: num(o.totalAmount),
          运费: num(o.freight),
          备注: o.note ?? '',
        })
      }
    }
    return exportXlsx('出入库记录', rows, `出入库记录-${ymd}.xlsx`)
  }

  if (section === 'settlements') {
    const side = (url.searchParams.get('side') ?? undefined) as 'PURCHASE' | 'SALE' | undefined
    const counterpartyId = url.searchParams.get('counterpartyId') ?? undefined
    const from = url.searchParams.get('from') ?? undefined
    const to = url.searchParams.get('to') ?? undefined
    const records = await getSettlementRecords(prisma, {
      side,
      counterpartyId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: null,
    })
    return exportXlsx(
      '结算记录',
      records.map((r) => ({
        类型: r.side === 'PURCHASE' ? '买入应付' : '卖出应收',
        '客户/供应商': r.counterpartyName,
        日期: r.date.toISOString().slice(0, 10),
        金额: num(r.amount),
        方式: r.method ?? '',
        经手人: r.handlerName,
      })),
      `结算记录-${ymd}.xlsx`,
    )
  }

  if (section === 'statement') {
    const counterpartyId = url.searchParams.get('counterpartyId') ?? ''
    if (!counterpartyId) return NextResponse.json({ error: '缺少往来单位参数' }, { status: 400 })
    const cp = await prisma.counterparty.findUnique({ where: { id: counterpartyId } })
    if (!cp) return NextResponse.json({ error: '往来单位不存在' }, { status: 400 })
    const rows = await getCounterpartyStatement(prisma, counterpartyId)
    return exportXlsx(
      '对账单',
      rows.map((r) => ({
        日期: r.date.toISOString().slice(0, 10),
        类型: r.type,
        单号: r.orderNo,
        方向: r.side === 'PURCHASE' ? '应付' : '应收',
        名称: r.yarnName,
        支数: r.spec,
        色号: r.color,
        单位: r.unit,
        '缸号/批次': r.batchNo,
        重量: r.weight ? num(r.weight) : '',
        单价: r.price ? num(r.price) : '',
        金额: num(r.amount),
        应付余额: num(r.payableBalance),
        应收余额: num(r.receivableBalance),
        说明: r.detail,
      })),
      `对账单-${cp.name}-${ymd}.xlsx`,
    )
  }

  if (section === 'factory-statement') {
    const warehouseId = url.searchParams.get('warehouseId') ?? ''
    if (!warehouseId) return NextResponse.json({ error: '缺少加工厂参数' }, { status: 400 })
    const wh = await prisma.warehouse.findUnique({ where: { id: warehouseId } })
    if (!wh || wh.type !== 'FACTORY') {
      return NextResponse.json({ error: '加工厂不存在' }, { status: 400 })
    }
    const rows = await getFactoryStatement(prisma, warehouseId)
    return exportXlsx(
      '加工费对账单',
      rows.map((r) => ({
        日期: r.date.toISOString().slice(0, 10),
        类型: r.type,
        名称: r.yarnName,
        支数: r.spec,
        色号: r.color,
        单位: r.unit,
        '缸号/批次': r.batchNo,
        本次加工: r.inputWeight ? num(r.inputWeight) : '',
        加工后: r.outputWeight ? num(r.outputWeight) : '',
        加工费单价: r.feePerKg ? num(r.feePerKg) : '',
        金额: num(r.amount),
        应付余额: num(r.balance),
        说明: r.detail,
      })),
      `加工费对账单-${wh.name}-${ymd}.xlsx`,
    )
  }

  return NextResponse.json({ error: '未知导出类型' }, { status: 400 })
}
