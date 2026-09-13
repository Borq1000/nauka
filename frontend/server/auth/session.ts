import 'server-only'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

export type Role = 'ADMIN' | 'EDITOR'

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
  isActive: boolean
}

export class AuthError extends Error {
  constructor(
    public code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INACTIVE',
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  return session.user as SessionUser
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new AuthError('UNAUTHENTICATED', 'Требуется вход в систему')

  // Проверка на КАЖДОМ запросе, а не только при входе:
  // отключение пользователя должно прекращать действующую сессию.
  // getSessionUser() выше не кэширует пользователя между запросами (нет
  // secondaryStorage и session.cookieCache выключен — см. lib/auth.ts),
  // поэтому isActive здесь всегда свежее значение из базы.
  if (!user.isActive) throw new AuthError('INACTIVE', 'Учётная запись отключена')

  return user
}

export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser()
  // ADMIN имеет доступ ко всему, что доступно EDITOR
  if (role === 'ADMIN' && user.role !== 'ADMIN') {
    throw new AuthError('FORBIDDEN', 'Недостаточно прав')
  }
  return user
}
