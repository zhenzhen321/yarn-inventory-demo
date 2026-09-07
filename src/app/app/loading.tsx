export default function Loading() {
  return <div className="space-y-4" role="status" aria-label="正在加载页面">
    <p className="text-slate-600">正在加载，请稍候…</p>
    <div className="h-24 animate-pulse rounded-2xl bg-slate-200" />
    <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
  </div>
}
