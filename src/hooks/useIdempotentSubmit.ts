'use client'

import { useRef, useState } from 'react'

export function useIdempotentSubmit() {
  const inFlight = useRef(false)
  const retryKey = useRef<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(request: (idempotencyKey: string) => Promise<Response>) {
    if (inFlight.current) return null
    inFlight.current = true
    setSubmitting(true)
    const key = retryKey.current ?? crypto.randomUUID()
    retryKey.current = key
    try {
      const response = await request(key)
      // 4xx 表示服务端明确拒绝，2xx 表示完成；5xx 与网络中断保留原键供安全重试。
      if (response.status < 500) retryKey.current = null
      return response
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return { submit, submitting }
}
