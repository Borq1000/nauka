import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'

// Интеграционный тест на РЕАЛЬНЫЕ хуки better-auth и реальную базу events_test —
// в отличие от tests/auth-guards.test.ts, здесь НЕ мокается @/lib/auth. Ревью
// round 2 отметило, что мок в auth-guards.test.ts прятал I-1: тесты там были
// зелёными, пока проверка isActive в проде (через хук в lib/auth.ts) вообще не
// работала для прямых вызовов auth.api.getSession(). Единственное, что здесь
// мокается — next/headers: headers() читает cookie текущего запроса Next и вне
// реального запроса бросает исключение, а тест не выполняется внутри такого
// запроса. Это платформенный примитив Next, а не наша логика — то же самое
// делает и оригинальный тест из брифа.
const sessionHeaders = vi.hoisted(() => ({ current: new Headers() }))

vi.mock('next/headers', () => ({
  headers: async () => sessionHeaders.current,
}))

const EMAIL = 'it-auth-hooks@test.local'
const PASSWORD = 'CorrectHorseBattery9!'
let userId: string

function extractCookieHeader(response: Response): Headers {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('sign-in не установил cookie — тест не может продолжаться')
  return new Headers({ cookie: setCookie.split(';')[0] ?? '' })
}

async function signIn(password: string): Promise<Response> {
  const { auth } = await import('@/lib/auth')
  const request = new Request('http://localhost:7622/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password }),
  })
  // auth.handler — та же точка входа, что и настоящий HTTP-запрос через
  // app/api/auth/[...all]/route.ts (toNextJsHandler зовёт именно её), поэтому
  // ctx._flag === 'router' выставляется по-настоящему, а не по предположению.
  return auth.handler(request)
}

beforeAll(async () => {
  const { prisma } = await import('@/lib/db')
  await prisma.user.deleteMany({ where: { email: EMAIL } })
  userId = randomUUID()
  await prisma.user.create({
    data: {
      id: userId,
      email: EMAIL,
      emailVerified: true,
      name: 'IT Guard',
      role: 'EDITOR',
      isActive: true,
    },
  })
  await prisma.account.create({
    data: {
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: await hashPassword(PASSWORD),
    },
  })
})

afterAll(async () => {
  const { prisma } = await import('@/lib/db')
  await prisma.user.deleteMany({ where: { email: EMAIL } })
  // Реальные вызовы /sign-in/email в этом файле проходят через настоящий
  // рейт-лимитер better-auth (storage: 'database'), который заводит строку в
  // RateLimit по ключу "<ip>|<path>". Не наши тестовые данные по сути, но
  // events_test должна оставаться такой же пустой, какой была до прогона.
  await prisma.rateLimit.deleteMany({ where: { key: { contains: '/sign-in/email' } } })
  await prisma.$disconnect()
})

describe('интеграция: реальные хуки better-auth (без мока @/lib/auth)', () => {
  it('getSessionUser/requireUser видят отключённого пользователя правильно', async () => {
    const { prisma } = await import('@/lib/db')

    const signInResponse = await signIn(PASSWORD)
    expect(signInResponse.status).toBe(200)
    sessionHeaders.current = extractCookieHeader(signInResponse)

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } })

    const { getSessionUser, requireUser, AuthError } = await import('@/server/auth/session')

    // I-1: getSessionUser должен вернуть null, а НЕ отклонить промис —
    // до фикса round 2 хук в lib/auth.ts бросал бы APIError('ACCOUNT_DISABLED')
    // прямо из auth.api.getSession(), и этот await бы упал с посторонней ошибкой.
    await expect(getSessionUser()).resolves.toBeNull()

    // requireUser обязан по-прежнему различать коды: INACTIVE, а не что-то ещё.
    await expect(requireUser()).rejects.toBeInstanceOf(AuthError)
    await expect(requireUser()).rejects.toMatchObject({ code: 'INACTIVE' })

    // Восстановить для следующего теста.
    await prisma.user.update({ where: { id: userId }, data: { isActive: true } })
  })

  it('вход с верным паролем на отключённом аккаунте побайтово неотличим от неверного пароля', async () => {
    const { prisma } = await import('@/lib/db')

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } })

    const correctPasswordResponse = await signIn(PASSWORD)
    const wrongPasswordResponse = await signIn('совершенно-неверный-пароль')

    expect(correctPasswordResponse.status).toBe(wrongPasswordResponse.status)

    // Сравнение именно сериализованных тел, а не статусов и не "на глаз" —
    // ревью round 2 указало, что порядок ключей JSON.stringify — тоже байты
    // ответа, и что предыдущий раунд напечатал их в разном порядке, но в
    // прозе назвал "побайтово неотличимыми".
    const correctBody = await correctPasswordResponse.text()
    const wrongBody = await wrongPasswordResponse.text()
    expect(correctBody).toBe(wrongBody)

    // Ни одна из двух попыток не должна была создать строку Session:
    // единственная сессия — та, что осталась от предыдущего теста.
    const sessionCount = await prisma.session.count({ where: { userId } })
    expect(sessionCount).toBe(1)

    await prisma.user.update({ where: { id: userId }, data: { isActive: true } })
  })
})
