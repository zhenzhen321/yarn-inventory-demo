'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

export interface LabelPrintOrder {
  orderNo: string
  items: {
    yarnName: string
    spec: string
    color: string
    packages: number | null
  }[]
}

interface LabelSettings {
  width: number
  height: number
  padding: number
  fontSize: number
}

const STORAGE_KEY = 'yarn-ms-label-print-settings'
const DEFAULT_SETTINGS: LabelSettings = {
  width: 50,
  height: 30,
  padding: 2,
  fontSize: 11,
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
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character]!,
  )
}

function defaultCopies(order: LabelPrintOrder) {
  return order.items.map((item) =>
    item.packages && item.packages > 0 ? Math.min(999, item.packages) : 1,
  )
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
  const [message, setMessage] = useState('')

  useEffect(() => {
    setMounted(true)
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (saved) {
        setSettings({
          width: safeNumber(Number(saved.width), 50, 20, 150),
          height: safeNumber(Number(saved.height), 30, 15, 100),
          padding: safeNumber(Number(saved.padding), 2, 0, 10),
          fontSize: safeNumber(Number(saved.fontSize), 11, 7, 28),
        })
      }
    } catch {
      // 无效的本机设置直接使用默认值。
    }
  }, [])

  useEffect(() => {
    setCopies(defaultCopies(order))
  }, [order])

  useEffect(() => {
    if (!mounted) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [mounted, settings])

  const presetValue = useMemo(() => {
    const preset = PRESETS.find(
      (candidate) =>
        candidate.width === settings.width && candidate.height === settings.height,
    )
    return preset ? `${preset.width}x${preset.height}` : 'custom'
  }, [settings.height, settings.width])

  const totalCopies = copies.reduce((total, count) => total + count, 0)

  function updateSetting(key: keyof LabelSettings, value: number) {
    const bounds = {
      width: [20, 150],
      height: [15, 100],
      padding: [0, 10],
      fontSize: [7, 28],
    } as const
    setSettings((current) => ({
      ...current,
      [key]: safeNumber(value, current[key], bounds[key][0], bounds[key][1]),
    }))
  }

  function printLabels() {
    setMessage('')
    if (totalCopies <= 0) {
      setMessage('请至少打印一张标签')
      return
    }
    const labels = order.items.flatMap((item, index) =>
      Array.from({ length: copies[index] ?? 0 }, () => item),
    )
    const printWindow = window.open('', '_blank', 'width=760,height=640')
    if (!printWindow) {
      setMessage('浏览器阻止了打印窗口，请允许弹出窗口后重试')
      return
    }

    const labelHtml = labels
      .map(
        (item) => `
          <section class="label">
            <div class="order-no">${escapeHtml(order.orderNo)}</div>
            <div class="yarn-name">${escapeHtml(item.yarnName)}</div>
            <div class="details">
              <div><span>支数</span><strong>${escapeHtml(item.spec)}</strong></div>
              <div><span>色号</span><strong>${escapeHtml(item.color)}</strong></div>
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
            @page {
              size: ${settings.width}mm ${settings.height}mm;
              margin: 0;
            }
            * { box-sizing: border-box; }
            html, body { margin: 0; padding: 0; }
            body {
              color: #111;
              font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
            }
            .label {
              width: ${settings.width}mm;
              height: ${settings.height}mm;
              padding: ${settings.padding}mm;
              overflow: hidden;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              break-after: page;
              page-break-after: always;
              font-size: ${settings.fontSize}pt;
            }
            .label:last-child {
              break-after: auto;
              page-break-after: auto;
            }
            .order-no {
              overflow: hidden;
              font-weight: 700;
              line-height: 1.1;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            .yarn-name {
              overflow: hidden;
              font-size: 1.55em;
              font-weight: 800;
              line-height: 1.1;
              text-align: center;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            .details {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 1.5mm;
              line-height: 1.1;
            }
            .details div {
              min-width: 0;
              display: flex;
              flex-direction: column;
            }
            .details span { color: #555; font-size: .72em; }
            .details strong {
              overflow: hidden;
              font-size: 1.05em;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
          </style>
        </head>
        <body>${labelHtml}</body>
      </html>`)
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => printWindow.print(), 250)
  }

  const modal = open ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="label-print-title"
    >
      <div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-gray-50 p-4 shadow-xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="label-print-title" className="text-lg font-bold">标签打印预览</h2>
            <p className="mt-1 text-sm text-gray-600">
              单号 {order.orderNo} · 共打印 {totalCopies} 张
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded px-2 py-1 text-gray-500 hover:bg-gray-200 hover:text-gray-800"
            aria-label="关闭标签预览"
          >
            ✕
          </button>
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
                      (candidate) =>
                        `${candidate.width}x${candidate.height}` === event.target.value,
                    )
                    if (preset) {
                      setSettings((current) => ({
                        ...current,
                        width: preset.width,
                        height: preset.height,
                      }))
                    }
                  }}
                >
                  {PRESETS.map((preset) => (
                    <option key={preset.label} value={`${preset.width}x${preset.height}`}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="custom">自定义尺寸</option>
                </Select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  宽度 (mm)
                  <Input
                    type="number"
                    min="20"
                    max="150"
                    step="1"
                    value={settings.width}
                    onChange={(event) => updateSetting('width', Number(event.target.value))}
                  />
                </label>
                <label className="text-sm">
                  高度 (mm)
                  <Input
                    type="number"
                    min="15"
                    max="100"
                    step="1"
                    value={settings.height}
                    onChange={(event) => updateSetting('height', Number(event.target.value))}
                  />
                </label>
                <label className="text-sm">
                  内边距 (mm)
                  <Input
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                    value={settings.padding}
                    onChange={(event) => updateSetting('padding', Number(event.target.value))}
                  />
                </label>
                <label className="text-sm">
                  基础字号
                  <Input
                    type="number"
                    min="7"
                    max="28"
                    step="1"
                    value={settings.fontSize}
                    onChange={(event) => updateSetting('fontSize', Number(event.target.value))}
                  />
                </label>
              </div>
              <p className="text-xs leading-5 text-gray-500">
                设置保存在当前电脑的浏览器中；打印机在 Windows 打印窗口中选择。
              </p>
            </section>

            <section className="space-y-2 rounded-lg border bg-white p-3">
              <h3 className="font-semibold">打印份数</h3>
              {order.items.map((item, index) => (
                <label key={`${item.yarnName}-${item.spec}-${item.color}-${index}`} className="grid grid-cols-[1fr_80px] items-center gap-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.yarnName}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {item.spec} · {item.color}
                    </span>
                  </span>
                  <Input
                    type="number"
                    min="0"
                    max="999"
                    step="1"
                    value={copies[index] ?? 0}
                    onChange={(event) =>
                      setCopies((current) =>
                        current.map((count, itemIndex) =>
                          itemIndex === index
                            ? safeNumber(Number(event.target.value), count, 0, 999)
                            : count,
                        ),
                      )
                    }
                    aria-label={`${item.yarnName}打印份数`}
                  />
                </label>
              ))}
            </section>
          </div>

          <section className="rounded-lg border bg-white p-3">
            <h3 className="font-semibold">效果预览</h3>
            <p className="mt-1 text-xs text-gray-500">
              每条货品显示一张示意图，实际打印按左侧份数生成。
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {order.items.map((item, index) => (
                <div key={`preview-${index}`} className="space-y-1">
                  <div
                    className="mx-auto flex w-full max-w-[320px] flex-col justify-between overflow-hidden border-2 border-dashed border-gray-400 bg-white text-gray-950 shadow-sm"
                    style={{
                      aspectRatio: `${settings.width} / ${settings.height}`,
                      padding: `${Math.max(6, settings.padding * 4)}px`,
                      fontSize: `${Math.max(10, settings.fontSize)}px`,
                    }}
                  >
                    <div className="truncate font-bold leading-none">{order.orderNo}</div>
                    <div className="truncate text-center text-[1.55em] font-extrabold leading-none">
                      {item.yarnName}
                    </div>
                    <div className="grid grid-cols-2 gap-2 leading-none">
                      <div className="min-w-0">
                        <span className="block text-[.72em] text-gray-500">支数</span>
                        <strong className="block truncate">{item.spec}</strong>
                      </div>
                      <div className="min-w-0">
                        <span className="block text-[.72em] text-gray-500">色号</span>
                        <strong className="block truncate">{item.color}</strong>
                      </div>
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
          <Button
            type="button"
            onClick={() => setOpen(false)}
            className="bg-gray-500 hover:bg-gray-600"
          >
            取消
          </Button>
          <Button type="button" onClick={printLabels}>
            打印 {totalCopies} 张标签
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
