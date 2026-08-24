const OP_PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 }

function applyOp(a: number, op: string, b: number): number | null {
  if (op === '+') return a + b
  if (op === '-') return a - b
  if (op === '*') return a * b
  if (op === '/') return b === 0 ? null : a / b
  return null
}

/**
 * 解析并计算简单的四则运算算式（数字、小数、+ - * / 与括号）。
 * 不用 eval/Function；非法输入一律返回 null。
 * 结果四舍五入保留 4 位小数。
 */
export function evaluateExpression(input: string): number | null {
  // 数字之间不允许有空格（如 "1 2" 视为非法，而不是拼接成 12）
  if (/\d\s+\d/.test(input)) return null
  const src = input.replace(/\s+/g, '')
  if (!src) return null
  if (!/^[\d.()+\-*/]+$/.test(src)) return null
  const tokens: string[] = []
  const re = /[0-9]+(?:\.[0-9]+)?|[()+\-*/]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    if (m.index !== last) return null
    last = m.index + m[0].length
    tokens.push(m[0])
  }
  if (last !== src.length) return null

  const values: number[] = []
  const ops: string[] = []
  let expectOperand = true
  for (const t of tokens) {
    if (/^\d/.test(t)) {
      if (!expectOperand) return null
      values.push(Number(t))
      expectOperand = false
    } else if (t === '(') {
      if (!expectOperand) return null
      ops.push(t)
      expectOperand = true
    } else if (t === ')') {
      if (expectOperand) return null
      let found = false
      while (ops.length) {
        const op = ops.pop()!
        if (op === '(') {
          found = true
          break
        }
        const b = values.pop()!
        const a = values.pop()!
        const r = applyOp(a, op, b)
        if (r === null) return null
        values.push(r)
      }
      if (!found) return null
      expectOperand = false
    } else {
      if (expectOperand) return null
      while (
        ops.length &&
        ops[ops.length - 1] !== '(' &&
        OP_PREC[ops[ops.length - 1]] >= OP_PREC[t]
      ) {
        const op = ops.pop()!
        const b = values.pop()!
        const a = values.pop()!
        const r = applyOp(a, op, b)
        if (r === null) return null
        values.push(r)
      }
      ops.push(t)
      expectOperand = true
    }
  }
  if (expectOperand) return null
  while (ops.length) {
    const op = ops.pop()!
    if (op === '(') return null
    const b = values.pop()!
    const a = values.pop()!
    const r = applyOp(a, op, b)
    if (r === null) return null
    values.push(r)
  }
  if (values.length !== 1 || !Number.isFinite(values[0])) return null
  return Math.round(values[0] * 10000) / 10000
}

/** 算式或纯数字都解析为 number；空串/非法值返回 null。 */
export function resolveNumeric(value: string): number | null {
  const expr = evaluateExpression(value)
  if (expr !== null) return expr
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
