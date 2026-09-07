'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

import { buildLabelDocument, fitLabelDocument, type LabelSettings, type LabelPrintOrder } from '@/lib/label-layout'
export type { LabelPrintOrder } from '@/lib/label-layout'

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

function defaultCopies(order: LabelPrintOrder) {
  return order.items.map(() => 1)
}

async function qrDataUrl(scanCode?: string | null) {
  if (!scanCode) return ''
  return QRCode.toDataURL(scanCode, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 256,
    color: { dark: '#000000', light: '#ffffff' },
  })
}

export function LabelPrintButton({
  order,
  label = '打印标签',
  className = '',
  context,
}: {
  order: LabelPrintOrder
  label?: string
  className?: string
  context?: string
}) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<LabelSettings>(DEFAULT_SETTINGS)
  const [copies, setCopies] = useState<number[]>(() => defaultCopies(order))
  const [previewCodes, setPreviewCodes] = useState<string[]>([])
  const [previewReady, setPreviewReady] = useState(false)
  const [previewMessages, setPreviewMessages] = useState<Record<string, string>>({})
  const previewDocuments = useMemo(
    () => previewReady
      ? order.items.map((item, index) =>
          buildLabelDocument(order.orderNo, [{ item, qr: previewCodes[index] ?? '' }], settings),
        )
      : [],
    [order, previewCodes, previewReady, settings],
  )
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
    setPreviewReady(false)
    setPreviewCodes([])
    Promise.all(order.items.map((item) => qrDataUrl(item.scanCode))).then((codes) => {
      if (active) {
        setPreviewCodes(codes)
        setPreviewReady(true)
      }
    }).catch(() => {
      if (active) setMessage('二维码生成失败，请刷新后重试')
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
    const printWindow = window.open('', '_blank', 'width=760,height=640')
    if (!printWindow) {
      setMessage('浏览器阻止了打印窗口，请允许弹出窗口后重试')
      return
    }
    setPrinting(true)
    try {
      const labels = order.items.flatMap((item, index) =>
        Array.from({ length: copies[index] ?? 0 }, () => item),
      )
      const printable = await Promise.all(labels.map(async (item) => ({ item, qr: await qrDataUrl(item.scanCode) })))
      if (printWindow.closed) return
      printWindow.document.write(buildLabelDocument(order.orderNo, printable, settings))
      printWindow.document.close()
      const results = await fitLabelDocument(printWindow.document)
      const invalid = results.findIndex((result) => !result.ok)
      if (invalid !== -1) {
        setMessage(`第 ${invalid + 1} 张：${results[invalid].message}`)
        printWindow.close()
        return
      }
      printWindow.focus()
      printWindow.print()
    } catch {
      if (!printWindow.closed) printWindow.close()
      setMessage('标签生成或排版失败，请刷新后重试')
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
            {context && <p className="mt-1 text-sm text-blue-800">{context}</p>}
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
                  ['fontSize', '基础字号上限 (pt)', 1],
                ] as const).map(([key, text, step]) => (
                  <label key={key} className="text-sm">
                    {text}
                    <Input type="number" step={step} value={settings[key]} onChange={(event) => updateSetting(key, Number(event.target.value))} />
                  </label>
                ))}
              </div>
              <p className="text-xs leading-5 text-gray-500">
                已启用自动缩字：各项内容尽量整行显示，最长字段单独缩小。最小字号为 5pt；仍放不下时会提示调整尺寸。
                打印机纸张尺寸须与这里一致，缩放选 100%，关闭页眉页脚。设置保存在当前电脑。
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
            <p className="mt-1 text-xs text-gray-500">下方预览与实际打印共用排版；长批次号使用整张标签宽度，不省略文字。</p>
            <div className="mt-3 grid gap-3">
              {order.items.map((item, index) => (
                <div key={`preview-${item.lotNo || index}`} className="space-y-1">
                  <div className="max-w-full overflow-x-auto border border-dashed border-gray-400 bg-white">
                    {previewReady ? (
                      <iframe
                        title={`标签效果预览 ${index + 1}`}
                        srcDoc={previewDocuments[index]}
                        style={{ width: `${settings.width}mm`, height: `${settings.height}mm`, border: 0, display: 'block' }}
                        onLoad={async (event) => {
                          const frame = event.currentTarget
                          const doc = frame.contentDocument
                          if (!doc) return
                          const key = previewDocuments[index]
                          try {
                            const results = await fitLabelDocument(doc)
                            if (frame.contentDocument !== doc) return
                            setPreviewMessages((current) => ({ ...current, [key]: results[0]?.message ?? '暂无标签' }))
                          } catch {
                            if (frame.contentDocument === doc) setPreviewMessages((current) => ({ ...current, [key]: '预览生成失败，请重试' }))
                          }
                        }}
                      />
                    ) : (
                      <div className="flex min-h-28 items-center justify-center px-4 text-sm text-gray-500" role="status">
                        正在生成二维码并排版…
                      </div>
                    )}
                  </div>
                  {previewReady ? (
                    <p className="text-xs text-gray-600" role="status">{previewMessages[previewDocuments[index]] ?? '正在按纸张尺寸排版…'}</p>
                  ) : null}
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
          setPreviewCodes([])
          setPreviewReady(false)
          setPreviewMessages({})
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
