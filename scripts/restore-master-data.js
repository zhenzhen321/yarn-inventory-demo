// 从 backups/master-*.json 恢复主数据（仓库 / 往来单位 / 纱线 / 变体）
// 用法：node scripts/restore-master-data.js [文件路径]（不带参数用最新一份）
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { PrismaClient } = require('@prisma/client')

const p = new PrismaClient()
const cwd = process.cwd()

;(async () => {
  const backupDir = join(cwd, 'backups')
  const files = readdirSync(backupDir).filter((f) => /^master-\d{8}-\d{6}\.json$/.test(f)).sort()
  const arg = process.argv[2]
  const chosen = arg ? join(cwd, arg) : join(backupDir, files[files.length - 1])
  if (!arg && !files.length) throw new Error('没有找到主数据备份文件')

  const payload = JSON.parse(readFileSync(chosen, 'utf8'))
  let warehouseCreated = 0
  let warehouseUpdated = 0
  let counterpartyCreated = 0
  let counterpartyUpdated = 0
  let yarnCreated = 0
  let yarnUpdated = 0
  let variantCreated = 0
  let variantUpdated = 0

  for (const row of payload.warehouses || []) {
    const existing = await p.warehouse.findFirst({ where: { name: row.name } })
    if (existing) {
      await p.warehouse.update({
        where: { id: existing.id },
        data: {
          type: row.type,
          address: row.address,
          manager: row.manager,
          active: row.active,
        },
      })
      warehouseUpdated++
    } else {
      await p.warehouse.create({
        data: {
          name: row.name,
          type: row.type,
          address: row.address,
          manager: row.manager,
          active: row.active,
        },
      })
      warehouseCreated++
    }
  }

  for (const row of payload.counterparties || []) {
    const existing = await p.counterparty.findFirst({ where: { name: row.name } })
    if (existing) {
      await p.counterparty.update({
        where: { id: existing.id },
        data: {
          type: row.type,
          contact: row.contact,
          phone: row.phone,
          active: row.active,
        },
      })
      counterpartyUpdated++
    } else {
      await p.counterparty.create({
        data: {
          name: row.name,
          type: row.type,
          contact: row.contact,
          phone: row.phone,
          active: row.active,
        },
      })
      counterpartyCreated++
    }
  }

  for (const row of payload.yarns || []) {
    let yarn = await p.yarn.findFirst({ where: { name: row.name } })
    if (yarn) {
      await p.yarn.update({ where: { id: yarn.id }, data: { note: row.note, active: row.active } })
      yarnUpdated++
    } else {
      yarn = await p.yarn.create({
        data: { name: row.name, note: row.note, active: row.active },
      })
      yarnCreated++
    }
    for (const v of row.variants || []) {
      const existing = await p.yarnVariant.findFirst({
        where: { yarnId: yarn.id, spec: v.spec, color: v.color, unit: v.unit },
      })
      if (existing) {
        await p.yarnVariant.update({
          where: { id: existing.id },
          data: { active: v.active },
        })
        variantUpdated++
      } else {
        await p.yarnVariant.create({
          data: {
            yarnId: yarn.id,
            spec: v.spec,
            color: v.color,
            unit: v.unit,
            active: v.active,
          },
        })
        variantCreated++
      }
    }
  }

  console.log(`恢复来源：${chosen}`)
  console.log(
    `仓库 新增 ${warehouseCreated} / 更新 ${warehouseUpdated}；` +
      `往来单位 新增 ${counterpartyCreated} / 更新 ${counterpartyUpdated}；` +
      `纱线 新增 ${yarnCreated} / 更新 ${yarnUpdated}；` +
      `变体 新增 ${variantCreated} / 更新 ${variantUpdated}`,
  )
})().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => p.$disconnect())
