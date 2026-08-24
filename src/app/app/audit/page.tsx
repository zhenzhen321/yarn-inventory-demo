import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { Table } from '@/components/ui/Table'
import { AutoRefresh } from '@/components/audit/AutoRefresh'

const ACTION_LABEL: Record<string, string> = {
  LOGIN_SUCCESS: '登录成功',
  LOGIN_FAILED: '登录失败',
  LOGOUT: '退出登录',
  YARN_CREATE: '新增纱线',
  YARN_UPDATE: '修改纱线',
  YARN_VARIANT_CREATE: '新增纱线规格',
  YARN_VARIANT_UPDATE: '修改纱线规格',
  WAREHOUSE_CREATE: '新增仓库',
  WAREHOUSE_UPDATE: '修改仓库',
  WAREHOUSE_DELETE: '删除仓库',
    COUNTERPARTY_CREATE: '新增往来单位',
    COUNTERPARTY_UPDATE: '修改往来单位',
    COUNTERPARTY_DELETE: '删除往来单位',
    PURCHASE_CREATE: '买入入库',
    PURCHASE_UPDATE: '修改买入单',
    SALE_CREATE: '卖出出库',
  TRANSFER_CREATE: '仓库调拨',
  PROCESSING_RETURN_CREATE: '加工收回',
  STOCKTAKE_CREATE: '盘库',
  SETTLEMENT_CREATE: '登记结算',
  YARN_DELETE: '删除纱线',
  YARN_VARIANT_DELETE: '删除纱线变体',
}

function formatLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default async function AuditPage() {
  const user = await getSessionUser()
  if (!user || user.role !== 'OWNER') redirect('/app/dashboard')
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return (
    <div className="space-y-4">
      <AutoRefresh />
      <h1 className="text-xl font-bold">安全日志</h1>
      <p className="text-sm text-gray-600">日志只追加、不可修改删除；仅最高管理员可见。</p>
      <Table headers={['时间', '操作人', '动作', '对象', '详情']}>
        {logs.map((l) => (
          <tr key={l.id}>
            <td>{formatLocal(l.createdAt)}</td>
            <td>{l.userName}</td>
            <td>{ACTION_LABEL[l.action] ?? l.action}</td>
            <td>{l.target}</td>
            <td>{l.detail ?? '-'}</td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
