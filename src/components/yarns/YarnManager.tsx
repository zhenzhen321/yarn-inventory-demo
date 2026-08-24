'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import { Input } from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'

interface Variant {
  id: string
  spec: string
  color: string
  unit: string
  active: boolean
}

interface Product {
  id: string
  name: string
  note: string | null
  active: boolean
  variants: Variant[]
}

async function jsonFetch(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === null ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

export function YarnManager({ initialProducts }: { initialProducts: Product[] }) {
  const router = useRouter()
  const [products, setProducts] = useState(initialProducts)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setProducts(initialProducts)
  }, [initialProducts])

  const [productForm, setProductForm] = useState({ name: '', note: '' })
  const [editingProduct, setEditingProduct] = useState<string | null>(null)
  const [editingProductForm, setEditingProductForm] = useState({ name: '', note: '' })
  const [addingVariantFor, setAddingVariantFor] = useState<string | null>(null)
  const [variantForm, setVariantForm] = useState({ spec: '', color: '', unit: 'kg' })
  const [editingVariant, setEditingVariant] = useState<string | null>(null)
  const [editingVariantForm, setEditingVariantForm] = useState({ spec: '', color: '', unit: '' })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function refresh() {
    router.refresh()
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function addProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage('')
    if (!productForm.name.trim()) {
      setMessage('请填写名称')
      return
    }
    const { ok, data } = await jsonFetch('/api/yarns', 'POST', productForm)
    if (ok) {
      setProductForm({ name: '', note: '' })
      setMessage('产品已新增')
      refresh()
    } else {
      setMessage(data.error || '保存失败')
    }
  }

  function startEditProduct(p: Product) {
    setEditingProduct(p.id)
    setEditingProductForm({ name: p.name, note: p.note ?? '' })
  }

  async function saveEditProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editingProduct) return
    setMessage('')
    if (!editingProductForm.name.trim()) {
      setMessage('名称不能为空')
      return
    }
    const { ok, data } = await jsonFetch(`/api/yarns/${editingProduct}`, 'PATCH', editingProductForm)
    if (ok) {
      setEditingProduct(null)
      setMessage('产品已修改')
      refresh()
    } else {
      setMessage(data.error || '保存失败')
    }
  }

  async function addVariant() {
    if (!addingVariantFor) return
    setMessage('')
    if (!variantForm.spec.trim() || !variantForm.color.trim() || !variantForm.unit.trim()) {
      setMessage('请填写支数、色号与单位')
      return
    }
    const { ok, data } = await jsonFetch('/api/yarn-variants', 'POST', {
      yarnId: addingVariantFor,
      spec: variantForm.spec,
      color: variantForm.color,
      unit: variantForm.unit,
    })
    if (ok) {
      setAddingVariantFor(null)
      setVariantForm({ spec: '', color: '', unit: 'kg' })
      setMessage('变体已新增')
      refresh()
    } else {
      setMessage(data.error || '保存失败')
    }
  }

  function startEditVariant(v: Variant) {
    setEditingVariant(v.id)
    setEditingVariantForm({ spec: v.spec, color: v.color, unit: v.unit })
  }

  async function saveEditVariant() {
    if (!editingVariant) return
    setMessage('')
    if (
      !editingVariantForm.spec.trim() ||
      !editingVariantForm.color.trim() ||
      !editingVariantForm.unit.trim()
    ) {
      setMessage('请填写支数、色号与单位')
      return
    }
    const { ok, data } = await jsonFetch(`/api/yarn-variants/${editingVariant}`, 'PATCH', {
      ...editingVariantForm,
      active: true,
    })
    if (ok) {
      setEditingVariant(null)
      setMessage('变体已修改')
      refresh()
    } else {
      setMessage(data.error || '保存失败')
    }
  }

  async function toggleVariant(v: Variant) {
    setMessage('')
    const { ok, data } = await jsonFetch(`/api/yarn-variants/${v.id}`, 'PATCH', {
      active: !v.active,
    })
    if (ok) {
      setMessage(v.active ? '已停用' : '已启用')
      refresh()
    } else {
      setMessage(data.error || '操作失败')
    }
  }

  async function deleteProduct(p: Product) {
    if (!window.confirm(`确定删除纱线“${p.name}”吗？删除后不可恢复。`)) return
    setMessage('')
    const { ok, data } = await jsonFetch(`/api/yarns/${p.id}`, 'DELETE', null)
    if (ok) {
      setMessage('纱线已删除')
      refresh()
    } else {
      setMessage(data.error || '删除失败')
    }
  }

  async function deleteVariant(v: Variant) {
    if (!window.confirm(`确定删除变体（${v.spec} ${v.color}）吗？删除后不可恢复。`)) return
    setMessage('')
    const { ok, data } = await jsonFetch(`/api/yarn-variants/${v.id}`, 'DELETE', null)
    if (ok) {
      setMessage('变体已删除')
      refresh()
    } else {
      setMessage(data.error || '删除失败')
    }
  }

  return (
    <div className="space-y-4">
      {message && <p className="text-sm text-gray-600">{message}</p>}

      <form
        onSubmit={addProduct}
        className="grid items-end gap-3 rounded border bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]"
      >
        <label className="text-sm text-gray-600">
          名称
          <Input
            value={productForm.name}
            onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="如 棉纱"
            className="mt-1"
            required
          />
        </label>
        <label className="text-sm text-gray-600">
          备注（选填）
          <Input
            value={productForm.note}
            onChange={(e) => setProductForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="选填"
            className="mt-1"
          />
        </label>
        <Button type="submit" className="h-10 px-6">
          新增产品
        </Button>
      </form>

      <Table headers={['名称', '支数', '色号', '单位', '操作']}>
        {products.map((p) => (
          <ProductRows
            key={p.id}
            product={p}
            editingProduct={editingProduct === p.id}
            editingProductForm={editingProductForm}
            setEditingProductForm={setEditingProductForm}
            onEditProduct={() => startEditProduct(p)}
            onSaveProduct={saveEditProduct}
            onCancelProduct={() => setEditingProduct(null)}
            addingVariant={addingVariantFor === p.id}
            variantForm={variantForm}
            setVariantForm={setVariantForm}
            onAddVariant={() => setAddingVariantFor(p.id)}
            onSaveVariant={addVariant}
            onCancelVariant={() => setAddingVariantFor(null)}
            editingVariant={editingVariant}
            editingVariantForm={editingVariantForm}
            setEditingVariantForm={setEditingVariantForm}
            onEditVariant={startEditVariant}
            onSaveVariantEdit={saveEditVariant}
            onCancelVariantEdit={() => setEditingVariant(null)}
            onToggleVariant={toggleVariant}
            onDeleteProduct={() => deleteProduct(p)}
            onDeleteVariant={deleteVariant}
            expanded={expanded.has(p.id)}
            onToggleExpand={() => toggleExpand(p.id)}
          />
        ))}
      </Table>
    </div>
  )
}

function ProductRows({
  product,
  editingProduct,
  editingProductForm,
  setEditingProductForm,
  onEditProduct,
  onSaveProduct,
  onCancelProduct,
  addingVariant,
  variantForm,
  setVariantForm,
  onAddVariant,
  onSaveVariant,
  onCancelVariant,
  editingVariant,
  editingVariantForm,
  setEditingVariantForm,
  onEditVariant,
  onSaveVariantEdit,
  onCancelVariantEdit,
  onToggleVariant,
  onDeleteProduct,
  onDeleteVariant,
  expanded,
  onToggleExpand,
}: {
  product: Product
  editingProduct: boolean
  editingProductForm: { name: string; note: string }
  setEditingProductForm: (f: { name: string; note: string }) => void
  onEditProduct: () => void
  onSaveProduct: (e: FormEvent<HTMLFormElement>) => void
  onCancelProduct: () => void
  addingVariant: boolean
  variantForm: { spec: string; color: string; unit: string }
  setVariantForm: (f: { spec: string; color: string; unit: string }) => void
  onAddVariant: () => void
  onSaveVariant: () => void
  onCancelVariant: () => void
  editingVariant: string | null
  editingVariantForm: { spec: string; color: string; unit: string }
  setEditingVariantForm: (f: { spec: string; color: string; unit: string }) => void
  onEditVariant: (v: Variant) => void
  onSaveVariantEdit: () => void
  onCancelVariantEdit: () => void
  onToggleVariant: (v: Variant) => void
  onDeleteProduct: () => void
  onDeleteVariant: (v: Variant) => void
  expanded: boolean
  onToggleExpand: () => void
}) {
  const actionBtn =
    'px-3 py-1.5 text-xs'
  const editBtn = `${actionBtn} bg-gray-600 hover:bg-gray-700`
  const addBtn = `${actionBtn} bg-blue-600 hover:bg-blue-700`
  const saveBtn = `${actionBtn} bg-green-600 hover:bg-green-700`
  const cancelBtn = `${actionBtn} bg-gray-500 hover:bg-gray-600`

  return (
    <>
      <tr className="border-b border-gray-200 bg-gray-50">
        <td colSpan={5}>
          {editingProduct ? (
            <form onSubmit={onSaveProduct} className="flex flex-wrap items-center gap-2">
              <Input
                value={editingProductForm.name}
                onChange={(e) =>
                  setEditingProductForm({ ...editingProductForm, name: e.target.value })
                }
                placeholder="名称"
                className="max-w-40"
                required
              />
              <Input
                value={editingProductForm.note}
                onChange={(e) =>
                  setEditingProductForm({ ...editingProductForm, note: e.target.value })
                }
                placeholder="备注（选填）"
                className="max-w-56"
              />
              <Button type="submit" className={saveBtn}>
                保存
              </Button>
              <Button type="button" onClick={onCancelProduct} className={cancelBtn}>
                取消
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CollapseToggle
                  expanded={expanded}
                  onClick={onToggleExpand}
                  label={expanded ? '收起变体' : '展开变体'}
                  testId="expand-variants"
                />
                <span className="font-medium">{product.name}</span>
                {product.note && <span className="text-xs text-gray-500">{product.note}</span>}
                <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
                  {product.variants.length} 个变体
                </span>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={onEditProduct} className={editBtn}>
                  编辑产品
                </Button>
                {expanded && (
                  <Button type="button" onClick={onAddVariant} className={addBtn}>
                    新增变体
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={onDeleteProduct}
                  className={`${actionBtn} bg-red-600 hover:bg-red-700`}
                >
                  删除
                </Button>
              </div>
            </div>
          )}
        </td>
      </tr>

      {expanded && (
        <>
      {product.variants.map((v) => (
        <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50/60">
          <td className="text-gray-400">↳</td>
          <td>
            {editingVariant === v.id ? (
              <Input
                value={editingVariantForm.spec}
                onChange={(e) =>
                  setEditingVariantForm({ ...editingVariantForm, spec: e.target.value })
                }
                placeholder="支数"
                required
              />
            ) : (
              v.spec
            )}
          </td>
          <td>
            {editingVariant === v.id ? (
              <Input
                value={editingVariantForm.color}
                onChange={(e) =>
                  setEditingVariantForm({ ...editingVariantForm, color: e.target.value })
                }
                placeholder="色号"
                required
              />
            ) : (
              v.color
            )}
          </td>
          <td>
            {editingVariant === v.id ? (
              <Input
                value={editingVariantForm.unit}
                onChange={(e) =>
                  setEditingVariantForm({ ...editingVariantForm, unit: e.target.value })
                }
                placeholder="单位"
                required
              />
            ) : (
              v.unit
            )}
          </td>
          <td>
            {editingVariant === v.id ? (
              <div className="flex gap-2">
                <Button type="button" onClick={onSaveVariantEdit} className={saveBtn}>
                  保存
                </Button>
                <Button type="button" onClick={onCancelVariantEdit} className={cancelBtn}>
                  取消
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button type="button" onClick={() => onEditVariant(v)} className={editBtn}>
                  编辑
                </Button>
                <Button
                  type="button"
                  onClick={() => onToggleVariant(v)}
                  className={`${actionBtn} ${
                    v.active ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {v.active ? '停用' : '启用'}
                </Button>
                <Button
                  type="button"
                  onClick={() => onDeleteVariant(v)}
                  className={`${actionBtn} bg-red-600 hover:bg-red-700`}
                >
                  删除
                </Button>
              </div>
            )}
          </td>
        </tr>
      ))}

      {addingVariant && (
        <tr className="border-b border-gray-100 bg-blue-50/40">
          <td className="text-gray-400">＋</td>
          <td>
            <Input
              value={variantForm.spec}
              onChange={(e) => setVariantForm({ ...variantForm, spec: e.target.value })}
              placeholder="支数（如 20支）"
              required
            />
          </td>
          <td>
            <Input
              value={variantForm.color}
              onChange={(e) => setVariantForm({ ...variantForm, color: e.target.value })}
              placeholder="色号（如 白色）"
              required
            />
          </td>
          <td>
            <Input
              value={variantForm.unit}
              onChange={(e) => setVariantForm({ ...variantForm, unit: e.target.value })}
              placeholder="单位"
              required
            />
          </td>
          <td>
            <div className="flex gap-2">
              <Button type="button" onClick={onSaveVariant} className={saveBtn}>
                保存
              </Button>
              <Button type="button" onClick={onCancelVariant} className={cancelBtn}>
                取消
              </Button>
            </div>
          </td>
        </tr>
      )}
        </>
      )}
    </>
  )
}
