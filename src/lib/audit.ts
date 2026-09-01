import { prisma } from '@/lib/prisma'

export interface AuditEntry {
  userId?: string
  userName: string
  action: string
  target: string
  detail?: string
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        userName: entry.userName,
        action: entry.action,
        target: entry.target,
        detail: entry.detail ?? null,
      },
    })
  } catch (e) {
    console.error('审计日志写入失败', e)
  }
}
