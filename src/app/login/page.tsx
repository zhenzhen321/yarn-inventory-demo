import { LoginForm } from '@/components/auth/LoginForm'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow">
        <h1 className="mb-1 text-xl font-bold">纱线进销存管理系统</h1>
        <p className="mb-4 text-sm text-gray-500">请登录</p>
        <LoginForm />
      </div>
    </main>
  )
}
