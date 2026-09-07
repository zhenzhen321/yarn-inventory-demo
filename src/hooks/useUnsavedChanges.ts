'use client'

import { useEffect, useRef } from 'react'

export function useUnsavedChanges() {
  const dirty = useRef(false)
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (dirty.current) { event.preventDefault(); event.returnValue = '' }
    }
    function beforeLink(event: MouseEvent) {
      if (!dirty.current || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return
      const link = (event.target as Element).closest('a[href]') as HTMLAnchorElement | null
      if (!link || link.target === '_blank' || link.hasAttribute('download') || link.href === window.location.href) return
      if (window.confirm('还有未保存的内容。确定离开并放弃本次填写吗？')) dirty.current = false
      else { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeLink, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeLink, true)
    }
  }, [])
  return {
    markDirty: () => { dirty.current = true },
    markSaved: () => { dirty.current = false },
    confirmDiscard: () => !dirty.current || window.confirm('还有未保存的内容。确定放弃本次填写吗？'),
  }
}
