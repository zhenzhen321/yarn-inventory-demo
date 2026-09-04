import Link from 'next/link'

export function OrderTraceLink({
  orderNo,
  orderType,
  className = '',
}: {
  orderNo: string
  orderType: 'PURCHASE' | 'SALE'
  className?: string
}) {
  const params = new URLSearchParams()
  params.set('type', orderType)
  params.set('q', orderNo)
  params.set('focus', orderNo)

  return (
    <Link
      href={'/app/orders?' + params.toString()}
      className={`font-medium text-blue-700 underline-offset-2 hover:underline ${className}`.trim()}
      title={`查看单据明细：${orderNo}`}
    >
      {orderNo}
    </Link>
  )
}
