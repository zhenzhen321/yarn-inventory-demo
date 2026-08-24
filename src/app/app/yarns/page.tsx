import { prisma } from '@/lib/prisma'
import { YarnManager } from '@/components/yarns/YarnManager'

export default async function YarnsPage() {
  const products = await prisma.yarn.findMany({
    include: { variants: { orderBy: [{ spec: 'asc' }, { color: 'asc' }, { unit: 'asc' }] } },
    orderBy: { name: 'asc' },
  })
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">纱线档案</h1>
      <YarnManager
        initialProducts={products.map((p) => ({
          id: p.id,
          name: p.name,
          note: p.note,
          active: p.active,
          variants: p.variants.map((v) => ({
            id: v.id,
            spec: v.spec,
            color: v.color,
            unit: v.unit,
            active: v.active,
          })),
        }))}
      />
    </div>
  )
}
