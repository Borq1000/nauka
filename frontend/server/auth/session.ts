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

// Ранг роли для allowlist-сравнения в requireRole (I-2, ревью round 1).
// ADMIN(2) удовлетворяет требованию EDITOR(1); любое значение, которого нет
// в этой карте (в т.ч. будущий третий вариант enum), не удовлетворяет ничему —
// см. requireRole ниже, где отсутствие в карте трактуется как отказ, а не как
// "не меньше требуемого".
const ROLE_RANK: Record<Role, number> = {
  EDITOR: 1,
  ADMIN: 2,
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

// Сырое чтение сессии — БЕЗ проверки isActive. Не экспортируется: единственный
// потребитель — requireUser, которому нужно различать UNAUTHENTICATED и
// INACTIVE. Любой другой код обязан идти через getSessionUser/requireUser
// ниже, ни один из которых не может вернуть отключённого пользователя
// (I-1, ревью round 1).
async function readSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  // Явный объект, а не `as SessionUser` поверх всего session.user: так наружу
  // не утекают лишние колонки User (emailVerified, image, createdAt, updatedAt
  // и что угодно, что появится в будущем) — только то, что описано в типе
  // (M-1, ревью round 1). role по-прежнему приходится сузить кастом: у
  // better-auth additionalFields с type:'string' выводится как string, а не
  // как литеральный union — но это безопасно (role — непустой Prisma-enum,
  // а requireRole ниже в любом случае не доверяет значению вслепую).
  const { id, email, name, role, isActive } = session.user
  return { id, email, name, role: role as Role, isActive }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const user = await readSessionUser()
  // Отключённый пользователь неотличим от невошедшего для ЛЮБОГО потребителя
  // этой функции. Без этого идиома `if (!user) redirect('/login')` (именно
  // так Task 6 читает эту функцию на странице админки) пустила бы отключённого
  // пользователя внутрь — isActive лежал бы полем в объекте, но никто из
  // вызывающих не обязан был бы его проверять (I-1, ревью round 1).
  return user?.isActive ? user : null
}

export async function requireUser(): Promise<SessionUser> {
  const user = await readSessionUser()
  if (!user) throw new AuthError('UNAUTHENTICATED', 'Требуется вход в систему')

  // Проверка на КАЖДОМ запросе, а не только при входе:
  // отключение пользователя должно прекращать действующую сессию.
  // readSessionUser() выше не кэширует пользователя между запросами (нет
  // secondaryStorage и session.cookieCache выключен — см. lib/auth.ts),
  // поэтому isActive здесь всегда свежее значение из базы.
  if (!user.isActive) throw new AuthError('INACTIVE', 'Учётная запись отключена')

  return user
}

export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser()
  const userRank = ROLE_RANK[user.role]
  // Allowlist по рангу, а не отдельное условие на каждую роль (I-2, ревью
  // round 1): ADMIN удовлетворяет требованию EDITOR, а роль, которой нет в
  // ROLE_RANK, — userRank будет undefined — не удовлетворяет НИЧЕМУ, вместо
  // того чтобы молча пройти, как было раньше при role === 'EDITOR'.
  if (userRank === undefined || userRank < ROLE_RANK[role]) {
    throw new AuthError('FORBIDDEN', 'Недостаточно прав')
  }
  return user
}
