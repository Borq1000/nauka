import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Используется тот же singleton, что и в приложении: tests/setup.ts уже
// перенаправил DATABASE_URL на events_test до загрузки этого модуля,
// поэтому клиент подключается к тестовой базе, а не к рабочей.
// Собственный new PrismaClient() здесь не создаётся: в Prisma 7 он требует
// driver adapter, и дублировать его настройку в тестах незачем.
import { prisma } from '@/lib/db'

beforeAll(async () => {
  await prisma.page.deleteMany({ where: { slug: { startsWith: 'test-' } } })
  await prisma.service.deleteMany({ where: { slug: { startsWith: 'test-' } } })
})

afterAll(async () => {
  await prisma.page.deleteMany({ where: { slug: { startsWith: 'test-' } } })
  await prisma.service.deleteMany({ where: { slug: { startsWith: 'test-' } } })
  await prisma.$disconnect()
})

describe('инварианты уровня базы данных', () => {
  it('не допускает двух главных страниц', async () => {
    await prisma.page.create({
      data: { title: 'Первая главная', slug: 'test-home-a', isHome: true },
    })

    // Вторая главная должна быть отвергнута самой базой, а не кодом приложения
    await expect(
      prisma.page.create({
        data: { title: 'Вторая главная', slug: 'test-home-b', isHome: true },
      }),
    ).rejects.toThrow()
  })

  it('допускает много страниц с isHome = false', async () => {
    await prisma.page.create({ data: { title: 'Обычная 1', slug: 'test-p1', isHome: false } })
    await prisma.page.create({ data: { title: 'Обычная 2', slug: 'test-p2', isHome: false } })

    const count = await prisma.page.count({ where: { slug: { startsWith: 'test-p' } } })
    expect(count).toBe(2)
  })

  it('не допускает двух услуг с одинаковым path', async () => {
    await prisma.service.create({
      data: { title: 'Наука', slug: 'test-science', path: 'test-science' },
    })
    // Отдельного cleanup здесь больше нет: если это упадёт по-настоящему
    // (уникальность path не сработает), строка останется в базе, но её
    // подчистит beforeAll/afterAll выше при следующем запуске — тест не
    // должен маскировать свой собственный провал ошибкой очистки.
    await expect(
      prisma.service.create({
        data: { title: 'Дубль', slug: 'test-science-2', path: 'test-science' },
      }),
    ).rejects.toThrow()
  })
})
