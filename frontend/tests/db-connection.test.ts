import { describe, it, expect, afterEach, vi } from 'vitest'

describe('подключение к базе', () => {
  it('выполняет запрос к реальной PostgreSQL', async () => {
    const { prisma } = await import('@/lib/db')
    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 as one`
    expect(rows[0].one).toBe(1)
  })
})

describe('валидатор окружения (lib/env)', () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
    vi.resetModules()
  })

  // M-4 (финальное ревью): предыдущая версия этого файла утверждала, что
  // env.DATABASE_URL начинается с "postgresql://" — то, что lib/env.ts уже
  // гарантирует, бросая при импорте. Такой тест не может провалиться: он
  // проверяет собственный .env разработчика, а не сам валидатор. Ниже —
  // настоящий негативный тест: он ломает одно конкретное поле и требует,
  // чтобы импорт модуля упал именно из-за него. Проверено вручную (см.
  // отчёт): при временном ослаблении .min(32) до .min(1) в lib/env.ts этот
  // тест падает (RED), после возврата .min(32) — снова проходит (GREEN).
  it('бросает при импорте, если BETTER_AUTH_SECRET короче 32 символов', async () => {
    vi.resetModules()
    process.env.BETTER_AUTH_SECRET = 'слишком-короткий-секрет'

    await expect(import('@/lib/env')).rejects.toThrow(/Некорректные переменные окружения/)
  })

  it('не бросает, если все переменные корректны', async () => {
    vi.resetModules()
    const { env } = await import('@/lib/env')
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32)
  })
})
