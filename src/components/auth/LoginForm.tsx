'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData(e.currentTarget)
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.get('username'),
        password: form.get('password'),
        remember: form.get('remember') === 'on',
      }),
    })
    if (res.ok) {
      router.push('/app/dashboard')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || '登录失败')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Input name="username" placeholder="账号" required autoComplete="username" />
      <Input
        name="password"
        type="password"
        placeholder="密码"
        required
        autoComplete="current-password"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="remember" defaultChecked />
        记住我（7 天内免登录）
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? '登录中…' : '登录'}
      </Button>
    </form>
  )
}
