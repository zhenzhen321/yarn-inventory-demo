import { describe, expect, it } from 'vitest'
import {
  counterpartySchema,
  counterpartyUpdateSchema,
  loginSchema,
  purchaseSchema,
  saleSchema,
  settlementSchema,
  stocktakeSchema,
  transferSchema,
  warehouseSchema,
  warehouseUpdateSchema,
  yarnSchema,
  yarnUpdateSchema,
  yarnVariantSchema,
  processingReturnSchema,
} from '@/lib/validation'

describe('校验', () => {
  it('纱线名称必填（一级只填名称）', () => {
    expect(yarnSchema.safeParse({ name: '' }).success).toBe(false)
    expect(yarnSchema.safeParse({ name: '棉纱' }).success).toBe(true)
  })

  it('入库单至少一条明细，重量必须大于 0', () => {
    const base = { date: '2026-08-01', supplierId: 's1', warehouseId: 'w1', handlerName: 'admin' }
    expect(purchaseSchema.safeParse({ ...base, items: [] }).success).toBe(false)
    expect(
      purchaseSchema.safeParse({ ...base, items: [{ variantId: 'v1', weight: 0, price: 20 }] }).success,
    ).toBe(false)
    expect(
      purchaseSchema.safeParse({ ...base, items: [{ variantId: 'v1', weight: 100, price: 20 }] }).success,
    ).toBe(true)
    // 无 variantId 时必须提供 纱线+支数+色号+单位
    expect(
      purchaseSchema.safeParse({
        ...base,
        items: [{ yarnId: 'y1', weight: 100, price: 20 }],
      }).success,
    ).toBe(false)
    expect(
      purchaseSchema.safeParse({
        ...base,
        items: [{ yarnId: 'y1', spec: '32支', color: '白色', unit: 'kg', weight: 100, price: 20 }],
      }).success,
    ).toBe(true)
  })

  it('往来单位类型必须合法', () => {
    expect(counterpartySchema.safeParse({ name: '甲', type: 'X' }).success).toBe(false)
    expect(counterpartySchema.safeParse({ name: '甲', type: 'SUPPLIER' }).success).toBe(true)
  })
})

describe('第二批校验', () => {
  it('卖出单至少一条明细且重量大于 0', () => {
    const base = { date: '2026-08-11', customerId: 'c1', warehouseId: 'w1', handlerName: 'admin' }
    expect(saleSchema.safeParse({ ...base, items: [] }).success).toBe(false)
    expect(
      saleSchema.safeParse({
        ...base,
        items: [{ inventoryId: 'i1', weight: 0, price: 20 }],
      }).success,
    ).toBe(false)
    expect(
      saleSchema.safeParse({
        ...base,
        items: [{ inventoryId: 'i1', weight: 10, price: 20 }],
      }).success,
    ).toBe(true)
  })

  it('调拨单来源与目标仓库必填', () => {
    expect(
      transferSchema.safeParse({
        date: '2026-08-11',
        fromWarehouseId: '',
        toWarehouseId: 'w2',
        handlerName: 'admin',
        items: [{ inventoryId: 'i1', weight: 10 }],
      }).success,
    ).toBe(false)
  })

  it('盘库实盘数不能为负', () => {
    expect(
      stocktakeSchema.safeParse({
        date: '2026-08-11',
        warehouseId: 'w1',
        handlerName: 'clerk',
        items: [{ inventoryId: 'i1', actualWeight: -1 }],
      }).success,
    ).toBe(false)
  })

  it('结算方向与金额校验', () => {
    expect(
      settlementSchema.safeParse({
        side: 'X',
        counterpartyId: 'c1',
        amount: 100,
        date: '2026-08-11',
        handlerName: 'admin',
      }).success,
    ).toBe(false)
    expect(
      settlementSchema.safeParse({
        side: 'PURCHASE',
        counterpartyId: 'c1',
        amount: 0,
        date: '2026-08-11',
        handlerName: 'admin',
      }).success,
    ).toBe(false)
  })

  it('经办人必填且不能为空', () => {
    const base = {
      date: '2026-08-11',
      customerId: 'c1',
      warehouseId: 'w1',
      items: [{ inventoryId: 'i1', weight: 10, price: 20 }],
    }
    expect(saleSchema.safeParse({ ...base, handlerName: '' }).success).toBe(false)
    expect(saleSchema.safeParse({ ...base, handlerName: 'admin' }).success).toBe(true)
    expect(saleSchema.safeParse({ ...base, handlerName: 'clerk' }).success).toBe(true)
    expect(
      settlementSchema.safeParse({
        side: 'SALE',
        counterpartyId: 'c1',
        amount: 100,
        date: '2026-08-11',
        handlerName: 'admin',
      }).success,
    ).toBe(true)
  })
})

describe('update 校验', () => {
  it('update schema 允许部分字段', () => {
    expect(warehouseUpdateSchema.safeParse({ name: '新仓库' }).success).toBe(true)
    expect(warehouseUpdateSchema.safeParse({}).success).toBe(true)
    expect(counterpartyUpdateSchema.safeParse({ type: 'X' }).success).toBe(false)
    expect(yarnUpdateSchema.safeParse({ name: '棉纱2' }).success).toBe(true)
    expect(yarnVariantSchema.safeParse({ yarnId: 'y1', spec: '32支', color: '白色' }).success).toBe(true)
    expect(yarnVariantSchema.safeParse({ yarnId: 'y1', color: '白色' }).success).toBe(false)
    expect(yarnVariantSchema.safeParse({ yarnId: 'y1', spec: '32支', color: '' }).success).toBe(false)
  })
})

describe('加工收回校验', () => {
  it('加工费/运费非负，明细必填', () => {
    const base = {
      date: '2026-08-13',
      factoryId: 'f1',
      warehouseId: 'w1',
      handlerName: 'admin',
      items: [
        {
          inventoryId: 'i1',
          weight: 100,
          spec: '20支',
          color: '紫',
          unit: 'kg',
          batchNo: 'P-1',
          outputWeight: 800,
        },
      ],
    }
    expect(processingReturnSchema.safeParse(base).success).toBe(true)
    expect(processingReturnSchema.safeParse({ ...base, processingFeePerKg: -1 }).success).toBe(false)
    expect(processingReturnSchema.safeParse({ ...base, freight: -1 }).success).toBe(false)
    expect(processingReturnSchema.safeParse({ ...base, items: [] }).success).toBe(false)
    expect(
      processingReturnSchema.safeParse({
        ...base,
        items: [
          {
            inventoryId: 'i1',
            weight: 100,
            spec: '20支',
            color: '紫',
            outputWeight: 800,
          },
        ],
      }).success,
    ).toBe(false)
  })
})

describe('运费与加工厂校验', () => {
  it('运费非负且可缺省', () => {
    expect(
      purchaseSchema.safeParse({
        date: '2026-08-11',
        supplierId: 's1',
        warehouseId: 'w1',
        handlerName: 'admin',
        items: [{ variantId: 'v1', weight: 10, price: 20 }],
        freight: -1,
      }).success,
    ).toBe(false)
    expect(
      saleSchema.safeParse({
        date: '2026-08-11',
        customerId: 'c1',
        warehouseId: 'w1',
        handlerName: 'admin',
        items: [{ inventoryId: 'i1', weight: 10, price: 20 }],
        freight: 300,
      }).success,
    ).toBe(true)
  })

  it('仓库类型合法，加工费非负', () => {
    expect(warehouseSchema.safeParse({ name: '染厂一', type: 'X' }).success).toBe(false)
    expect(warehouseSchema.safeParse({ name: '染厂一', type: 'FACTORY' }).success).toBe(true)
    expect(
      transferSchema.safeParse({
        date: '2026-08-11',
        fromWarehouseId: 'w1',
        toWarehouseId: 'f1',
        handlerName: 'admin',
        items: [{ inventoryId: 'i1', weight: 10 }],
        processingFeePerKg: -1,
      }).success,
    ).toBe(false)
  })
})

describe('登录校验', () => {
  it('remember 默认为 true', () => {
    expect(loginSchema.safeParse({ username: 'admin', password: 'x' }).data?.remember).toBe(true)
    expect(
      loginSchema.safeParse({ username: 'admin', password: 'x', remember: false }).data?.remember,
    ).toBe(false)
  })
})
