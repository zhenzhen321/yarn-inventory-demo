'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

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

interface LabelSettings {
  width: number
  height: number
  padding: number
  topOffset: number
  fontSize: number
}

const STORAGE_KEY = 'yarn-ms-label-print-settings'
const SETTINGS_VERSION = 3
const DEFAULT_SETTINGS: LabelSettings = {
  width: 50,
  height: 30,
  padding: 1.5,
  topOffset: 0.5,
  fontSize: 10,
}
const PRESETS = [
  { label: '40 × 30 mm', width: 40, height: 30 },
  { label: '50 × 30 mm', width: 50, height: 30 },
  { label: '60 × 40 mm', width: 60, height: 40 },
]

function safeNumber(value: number, fallback: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[
        character
      ]!,
  )
}

function defaultCopies(order: LabelPrintOrder) {
  return order.items.map(() => 1)
}

async function qrDataUrl(scanCode?: string | null) {
  if (!scanCode) return ''
  return QRCode.toDataURL(scanCode, {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 256,
    color: { dark: '#000000', light: '#ffffff' },
  })
}

export function LabelPrintButton({
  order,
  label = '打印标签',
  className = '',
}: {
  order: LabelPrintOrder
  label?: string
  className?: string
}) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<LabelSettings>(DEFAULT_SETTINGS)
  const [copies, setCopies] = useState<number[]>(() => defaultCopies(order))
  const [previewCodes, setPreviewCodes] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (saved?.layoutVersion === SETTINGS_VERSION) {
        setSettings({
          width: safeNumber(Number(saved.width), 50, 20, 150),
          height: safeNumber(Number(saved.height), 30, 15, 100),
          padding: safeNumber(Number(saved.padding), DEFAULT_SETTINGS.padding, 0, 10),
          topOffset: safeNumber(Number(saved.topOffset), DEFAULT_SETTINGS.topOffset, 0, 10),
          fontSize: safeNumber(Number(saved.fontSize), DEFAULT_SETTINGS.fontSize, 7, 28),
        })
      }
    } catch {
      // 本机旧设置无效时使用安全默认值。
    }
  }, [])

  useEffect(() => setCopies(defaultCopies(order)), [order])

  useEffect(() => {
    if (!mounted) return
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...settings, layoutVersion: SETTINGS_VERSION }),
    )
  }, [mounted, settings])

  useEffect(() => {
    if (!open) return
    let active = true
    Promise.all(order.items.map((item) => qrDataUrl(item.scanCode))).then((codes) => {
      if (active) setPreviewCodes(codes)
    })
    return () => {
      active = false
    }
  }, [open, order])

  const presetValue = useMemo(() => {
    const preset = PRESETS.find(
      (candidate) => candidate.width === settings.width && candidate.height === settings.height,
    )
    return preset ? `${preset.width}x${preset.height}` : 'custom'
  }, [settings.height, settings.width])
  const totalCopies = copies.reduce((total, count) => total + count, 0)

  function updateSetting(key: keyof LabelSettings, value: number) {
    const bounds = {
      width: [20, 150],
      height: [15, 100],
      padding: [0, 10],
      topOffset: [0, 10],
      fontSize: [7, 28],
    } as const
    setSettings((current) => ({
      ...current,
      [key]: safeNumber(value, current[key], bounds[key][0], bounds[key][1]),
    }))
  }

  async function printLabels() {
    setMessage('')
    if (totalCopies <= 0) {
      setMessage('请至少打印一张标签')
      return
    }
    setPrinting(true)
    try {
      const labels = order.items.flatMap((item, index) =>
        Array.from({ length: copies[index] ?? 0 }, () => item),
      )
      const printable = await Promise.all(
        labels.map(async (item) => ({ item, qr: await qrDataUrl(item.scanCode) })),
      )
      const printWindow = window.open('', '_blank', 'width=760,height=640')
      if (!printWindow) {
        setMessage('浏览器阻止了打印窗口，请允许弹出窗口后重试')
        return
      }
      const labelHtml = printable
        .map(
          ({ item, qr }) => `
            <section class="label">
              <div class="info">
                <div class="order-no">${escapeHtml(order.orderNo)}</div>
                <div class="yarn-name">${escapeHtml(item.yarnName)}</div>
                <div class="detail">${escapeHtml(item.spec)} · ${escapeHtml(item.color)}</div>
                <div class="detail">批次 ${escapeHtml(item.batchNo || '-')}</div>
                <div class="quantity">
                  <strong>${escapeHtml(item.weight)} ${escapeHtml(item.unit)}</strong>
                  ${item.packages !== null ? `<strong>${item.packages} 件</strong>` : ''}
                </div>
                <div class="lot-no">${escapeHtml(item.lotNo || '历史库存')}</div>
              </div>
              <div class="qr">
                ${qr ? `<img src="${escapeHtml(qr)}" alt="" />` : '<div class="no-qr">历史<br/>无二维码</div>'}
              </div>
            </section>
          `,
        )
        .join('')
      printWindow.document.write(`<!doctype html>
        <html lang="zh-CN">
          <head>
            <meta charset="utf-8" />
            <title>标签打印 - ${escapeHtml(order.orderNo)}</title>
            <style>
              @page { size: ${settings.width}mm ${settings.height}mm; margin: 0; }
              * { box-sizing: border-box; }
              html, body { margin: 0; padding: 0; }
              body { color: #111; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
              .label {
                width: ${settings.width}mm;
                height: ${settings.height}mm;
                padding: ${settings.padding + settings.topOffset}mm ${settings.padding}mm ${settings.padding}mm;
                overflow: hidden;
                display: grid;
                grid-template-columns: minmax(0, 1fr) min(42%, 22mm);
                gap: 1mm;
                break-after: page;
                page-break-after: always;
                font-size: ${settings.fontSize}pt;
              }
              .label:last-child { break-after: auto; page-break-after: auto; }
              .info { min-width: 0; display: flex; flex-direction: column; justify-content: center; line-height: 1.08; }
              .order-no, .lot-no { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .64em; }
              .yarn-name { margin: .25mm 0; font-size: 1.4em; font-weight: 800; overflow-wrap: anywhere; }
              .detail { font-size: .9em; overflow-wrap: anywhere; }
              .quantity { display: flex; flex-wrap: wrap; gap: .5mm 1.5mm; margin-top: .45mm; font-size: 1.02em; }
              .lot-no { margin-top: .45mm; font-weight: 700; }
              .qr { min-width: 0; display: flex; align-items: center; justify-content: center; }
              .qr img { display: block; width: 100%; max-width: 22mm; max-height: 22mm; object-fit: contain; image-rendering: pixelated; }
              .no-qr { border: .3mm solid #777; padding: 2mm; text-align: center; font-size: .7em; }
            </style>
          </head>
          <body>${labelHtml}</body>
        </html>`)
      printWindow.document.close()
      printWindow.focus()
      window.setTimeout(() => printWindow.print(), 300)
    } catch {
      setMessage('二维码生成失败，请刷新后重试')
    } finally {
      setPrinting(false)
    }
  }

  const modal = open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-labelledby="label-print-title">
      <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-gray-50 p-4 shadow-xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="label-print-title" className="text-lg font-bold">标签打印预览</h2>
            <p className="mt-1 text-sm text-gray-600">
              单号 {order.orderNo} · 默认每个批次一张 · 共打印 {totalCopies} 张
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-200" aria-label="关闭标签预览">✕</button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="space-y-4">
            <section className="space-y-3 rounded-lg border bg-white p-3">
              <h3 className="font-semibold">标签设置</h3>
              <label className="block text-sm">
                常用尺寸
                <Select
                  value={presetValue}
                  onChange={(event) => {
                    const preset = PRESETS.find(
                      (candidate) => `${candidate.width}x${candidate.height}` === event.target.value,
                    )
                    if (preset) setSettings((current) => ({ ...current, width: preset.width, height: preset.height }))
                  }}
                >
                  {PRESETS.map((preset) => <option key={preset.label} value={`${preset.width}x${preset.height}`}>{preset.label}</option>)}
                  <option value="custom">自定义尺寸</option>
                </Select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['width', '宽度 (mm)', 1],
                  ['height', '高度 (mm)', 1],
                  ['padding', '内边距 (mm)', 0.5],
                  ['topOffset', '顶部留白 (mm)', 0.5],
                  ['fontSize', '基础字号', 1],
                ] as const).map(([key, text, step]) => (
                  <label key={key} className="text-sm">
                    {text}
                    <Input type="number" step={step} value={settings[key]} onChange={(event) => updateSetting(key, Number(event.target.value))} />
                  </label>
                ))}
              </div>
              <p className="text-xs leading-5 text-gray-500">
                设置保存在当前电脑。二维码内容是系统内部批次码，扫码枪按键盘输入即可识别。
              </p>
            </section>

            <section className="space-y-2 rounded-lg border bg-white p-3">
              <h3 className="font-semibold">打印份数</h3>
              {order.items.map((item, index) => (
                <label key={`${item.lotNo || item.yarnName}-${index}`} className="grid grid-cols-[1fr_80px] items-center gap-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.yarnName}</span>
                    <span className="block truncate text-xs text-gray-500">{item.lotNo || '历史库存'} · {item.packages ?? '-'} 件</span>
                  </span>
                  <Input
                    type="number"
                    min="0"
                    max="999"
                    step="1"
                    value={copies[index] ?? 0}
                    onChange={(event) =>
                      setCopies((current) => current.map((count, itemIndex) =>
                        itemIndex === index ? safeNumber(Number(event.target.value), count, 0, 999) : count,
                      ))
                    }
                    aria-label={`${item.yarnName}打印份数`}
                  />
                </label>
              ))}
            </section>
          </div>

          <section className="rounded-lg border bg-white p-3">
            <h3 className="font-semibold">效果预览</h3>
            <p className="mt-1 text-xs text-gray-500">一批只贴一个标签；如确有需要，可在左侧增加份数。</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {order.items.map((item, index) => (
                <div key={`preview-${item.lotNo || index}`} className="space-y-1">
                  <div className="mx-auto grid w-full max-w-[360px] grid-cols-[minmax(0,1fr)_38%] gap-2 overflow-hidden border-2 border-dashed border-gray-400 bg-white p-2 text-gray-950 shadow-sm" style={{ aspectRatio: `${settings.width} / ${settings.height}`, fontSize: `${Math.max(9, settings.fontSize)}px` }}>
                    <div className="min-w-0 self-center leading-tight">
                      <div className="truncate text-[.65em]">{order.orderNo}</div>
                      <div className="text-[1.4em] font-extrabold [overflow-wrap:anywhere]">{item.yarnName}</div>
                      <div>{item.spec} · {item.color}</div>
                      <div>批次 {item.batchNo || '-'}</div>
                      <div className="font-bold">{item.weight} {item.unit}{item.packages !== null ? ` · ${item.packages} 件` : ''}</div>
                      <div className="truncate text-[.7em] font-bold">{item.lotNo || '历史库存'}</div>
                    </div>
                    <div className="flex items-center justify-center">
                      {previewCodes[index] ? <img src={previewCodes[index]} alt="批次二维码" className="aspect-square w-full max-w-28 [image-rendering:pixelated]" /> : <div className="border p-2 text-center text-xs">历史库存<br />无二维码</div>}
                    </div>
                  </div>
                  <p className="text-center text-xs text-gray-500">打印 {copies[index] ?? 0} 张</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {message ? <p className="mt-3 text-sm text-red-600">{message}</p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={() => setOpen(false)} className="bg-gray-500 hover:bg-gray-600">取消</Button>
          <Button type="button" disabled={printing} onClick={printLabels}>
            {printing ? '正在生成二维码…' : `打印 ${totalCopies} 张标签`}
          </Button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setMessage('')
          setCopies(defaultCopies(order))
          setOpen(true)
        }}
        className={className}
      >
        {label}
      </Button>
      {mounted && modal ? createPortal(modal, document.body) : null}
    </>
  )
}
