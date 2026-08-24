'use client'

import { FormEvent, Fragment, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Table } from '@/components/ui/Table'

export interface FieldConfig {
  key: string
  label: string
  type?: 'text' | 'select'
  options?: { value: string; label: string }[]
  required?: boolean
  placeholder?: string
}

interface Row {
  id: string
  [key: string]: unknown
}

export interface ExtraColumn {
  key: string
  label: string
  render?: (row: Row, helpers: { expanded: boolean; onToggle: () => void }) => ReactNode
}

export function ResourcePage({
  title,
  apiPath,
  fields,
  columns,
  rowExportHrefPrefix,
  extraColumns,
  expandRowContent,
}: {
  title: string
  apiPath: string
  fields: FieldConfig[]
  columns: { key: string; label: string; labelMap?: Record<string, string> }[]
  rowExportHrefPrefix?: string
  extraColumns?: ExtraColumn[]
  expandRowContent?: (row: Row) => ReactNode | null
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Record<string, string>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  async function load() {
    const res = await fetch(`${apiPath}?q=${encodeURIComponent(q)}`)
    if (res.ok) setRows(await res.json())
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function startEdit(row: Row) {
    setEditingId(row.id)
    const next: Record<string, string> = {}
    for (const f of fields) next[f.key] = String(row[f.key] ?? '')
    setForm(next)
    setMessage('')
  }

  function cancelEdit() {
    setEditingId(null)
    setForm({})
    setMessage('')
  }

  async function onDelete(row: Row) {
    if (!window.confirm('确定删除这条记录吗？删除后不可恢复。')) return
    setMessage('')
    const res = await fetch(`${apiPath}/${row.id}`, { method: 'DELETE' })
    if (res.ok) {
      setMessage('删除成功')
      load()
    } else {
      const data = await res.json().catch(() => ({}))
      setMessage(data.error || '删除失败')
    }
  }

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage('')
    const body: Record<string, unknown> = {}
    for (const f of fields) {
      const v = form[f.key]
      body[f.key] = typeof v === 'string' && v.trim() === '' ? null : v
    }
    const res = await fetch(editingId ? `${apiPath}/${editingId}` : apiPath, {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setMessage(editingId ? '修改成功' : '保存成功')
      cancelEdit()
      load()
    } else {
      const data = await res.json().catch(() => ({}))
      setMessage(data.error || (editingId ? '修改失败' : '保存失败'))
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{title}</h1>
      <form
        onSubmit={onSubmit}
        className="grid gap-3 rounded border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        {fields.map((f) =>
          f.type === 'select' ? (
            <Select
              key={f.key}
              value={form[f.key] ?? (f.options?.[0]?.value ?? '')}
              onChange={(e) => setField(f.key, e.target.value)}
              required={f.required}
            >
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              key={f.key}
              value={form[f.key] ?? ''}
              onChange={(e) => setField(f.key, e.target.value)}
              placeholder={f.placeholder ?? f.label}
              required={f.required}
            />
          ),
        )}
        {editingId ? (
          <div className="flex gap-2">
            <Button type="submit" className="bg-green-600 hover:bg-green-700">
              保存修改
            </Button>
            <Button
              type="button"
              onClick={cancelEdit}
              className="bg-gray-500 hover:bg-gray-600"
            >
              取消
            </Button>
          </div>
        ) : (
          <Button type="submit">保存</Button>
        )}
      </form>
      {message && <p className="text-sm text-gray-600">{message}</p>}
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索…"
        className="max-w-xs"
      />
      <Table
        headers={[
          ...columns.map((c) => c.label),
          ...(extraColumns?.map((c) => c.label) ?? []),
          '操作',
        ]}
      >
        {rows.map((row) => {
          const detail = expandRowContent ? expandRowContent(row) : null
          return (
            <Fragment key={row.id}>
              <tr>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.labelMap
                      ? String(c.labelMap[String(row[c.key])] ?? row[c.key] ?? '-')
                      : String(row[c.key] ?? '-')}
                  </td>
                ))}
                {extraColumns?.map((c) => (
                  <td key={c.key}>
                    {c.render ? (
                      c.render(row, {
                        expanded: expandedId === row.id,
                        onToggle: () => toggleExpand(row.id),
                      })
                    ) : (
                      <div className="flex items-center gap-1">
                        {detail !== null && (
                          <CollapseToggle
                            expanded={expandedId === row.id}
                            onClick={() => toggleExpand(row.id)}
                            label={`展开${c.label}`}
                          />
                        )}
                        <span>{String(row[c.key] ?? '-')}</span>
                      </div>
                    )}
                  </td>
                ))}
                <td>
                  <div className="flex gap-2">
                    {rowExportHrefPrefix && (
                      <a
                        href={`${rowExportHrefPrefix}${String(row.id)}`}
                        className="rounded border border-blue-600 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50"
                      >
                        导出对账单
                      </a>
                    )}
                    <Button
                      type="button"
                      onClick={() => startEdit(row)}
                      className="bg-gray-600 px-3 py-1 text-xs hover:bg-gray-700"
                    >
                      编辑
                    </Button>
                    <Button
                      type="button"
                      onClick={() => onDelete(row)}
                      className="bg-red-600 px-3 py-1 text-xs hover:bg-red-700"
                    >
                      删除
                    </Button>
                  </div>
                </td>
              </tr>
              {detail !== null && expandedId === row.id && (
                <tr className="bg-gray-50">
                  <td
                    colSpan={columns.length + (extraColumns?.length ?? 0) + 1}
                    className="px-3 py-2"
                  >
                    {detail}
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </Table>
    </div>
  )
}
