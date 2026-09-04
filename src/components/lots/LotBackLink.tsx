'use client'

import { useRouter } from 'next/navigation'

export function LotBackLink() {
  const router = useRouter()

  function goBack() {
    if (window.history.length > 1) router.back()
    else router.replace('/app/inventory')
  }

  return (
    <button type="button" onClick={goBack} className="text-sm text-blue-700 hover:underline">
      ← 返回上一界面
    </button>
  )
}
