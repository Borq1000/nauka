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

  // I-4 (ревью round 1): requireRole('EDITOR') раньше был байт-в-байт эквивалентен
  // requireUser() — не выполнял вообще никакого сравнения и пропускал любое
  // значение role, включая нераспознанное. Этот тест ловит именно такую регрессию:
  // он падает и до, и после исправления одинаково для ADMIN/EDITOR, но должен
  // отличать их от роли, которой нет в enum.
  it('отклоняет роль, которая не является ни ADMIN, ни EDITOR', async () => {
    mockSession.value = {
      user: { id: 'u1', email: 'a@b.c', name: 'Хз', role: 'MODERATOR', isActive: true },
    }
    const { requireRole } = await import('@/server/auth/session')
    await expect(requireRole('EDITOR')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
