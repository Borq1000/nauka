import { describe, it, expect, vi, beforeEach } from 'vitest'

// Подменяем источник сессии, чтобы проверять именно логику охраны,
// а не работу HTTP-слоя better-auth.
const mockSession = vi.hoisted(() => ({ value: null as unknown }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: async () => mockSession.value } },
}))

// getSessionUser вызывает headers() ДО обращения к auth. Вне контекста
// запроса Next это исключение, и тест падал бы по причине, не имеющей
// отношения к проверяемой логике охраны ролей.
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

beforeEach(() => {
  mockSession.value = null
})

describe('requireUser', () => {
  it('отклоняет вызов без сессии', async () => {
    const { requireUser, AuthError } = await import('@/server/auth/session')
    await expect(requireUser()).rejects.toBeInstanceOf(AuthError)
    await expect(requireUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('отклоняет сессию отключённого пользователя', async () => {
    mockSession.value = {
      user: { id: 'u1', email: 'a@b.c', name: 'Тест', role: 'ADMIN', isActive: false },
    }
    const { requireUser } = await import('@/server/auth/session')
    await expect(requireUser()).rejects.toMatchObject({ code: 'INACTIVE' })
  })

  it('пропускает активного пользователя', async () => {
    mockSession.value = {
      user: { id: 'u1', email: 'a@b.c', name: 'Тест', role: 'EDITOR', isActive: true },
    }
    const { requireUser } = await import('@/server/auth/session')
    const user = await requireUser()
    expect(user.id).toBe('u1')
  })
})

describe('requireRole', () => {
  it('отклоняет EDITOR там, где требуется ADMIN', async () => {
    mockSession.value = {
      user: { id: 'u1', email: 'a@b.c', name: 'Редактор', role: 'EDITOR', isActive: true },
    }
    const { requireRole } = await import('@/server/auth/session')
    await expect(requireRole('ADMIN')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('пропускает ADMIN там, где требуется EDITOR', async () => {
    mockSession.value = {
      user: { id: 'u1', email: 'a@b.c', name: 'Админ', role: 'ADMIN', isActive: true },
    }
    const { requireRole } = await import('@/server/auth/session')
    const user = await requireRole('EDITOR')
    expect(user.role).toBe('ADMIN')
  })
})
