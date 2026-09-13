import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'
import { LoginForm } from '@/Components/auth/LoginForm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // страница входа не кешируется

export const metadata = {
  title: 'Вход в панель управления',
  robots: { index: false, follow: false },
}

export default async function LoginPage() {
  const user = await getSessionUser()
  // getSessionUser() уже возвращает null для отключённого пользователя
  // (см. server/auth/session.ts) — отдельная проверка user.isActive здесь
  // не нужна.
  if (user) redirect('/admin')

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-2xl font-bold">Панель управления</h1>
        <LoginForm />
      </div>
    </main>
  )
}
