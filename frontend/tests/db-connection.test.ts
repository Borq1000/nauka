import { describe, it, expect } from 'vitest'

describe('окружение', () => {
  it('валидирует обязательные переменные и не падает молча', async () => {
    const { env } = await import('@/lib/env')
    expect(env.DATABASE_URL).toMatch(/^postgresql:\/\//)
    expect(env.BASE_URL).toMatch(/^https?:\/\//)
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32)
  })
})

describe('подключение к базе', () => {
  it('выполняет запрос к реальной PostgreSQL', async () => {
    const { prisma } = await import('@/lib/db')
    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 as one`
    expect(rows[0].one).toBe(1)
  })
})
