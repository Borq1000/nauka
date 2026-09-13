import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Панель управления',
  robots: { index: false, follow: false },
}

export default async function AdminHomePage() {
  const user = await getSessionUser()

  // Проверка здесь, а не в layout: layout не выполняется при прямом
  // обращении к Server Action, поэтому полагаться на него нельзя.
  // getSessionUser() уже возвращает null для отключённого пользователя,
  // так что достаточно проверить !user (см. server/auth/session.ts).
  if (!user) redirect('/admin/login')

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">Панель управления</h1>
      <p className="mt-2 text-slate-600">
        {user.name} · {user.email} · роль: {user.role}
      </p>
      <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
        Разделы управления содержимым появятся на следующем этапе.
      </p>
    </main>
  )
}
