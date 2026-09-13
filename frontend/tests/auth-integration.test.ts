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

// clientIp привязывает каждый вызов к отдельному "бакету" рейт-лимита
// (lib/auth.ts: advanced.ipAddress.ipAddressHeaders: ['x-real-ip']). Без этого
// все sign-in из всех тестов файла делили бы один бакет /sign-in/email
// (окно 10с / max 3 — см. lib/auth.ts customRules) и пятый вызов в файле упал
// бы в 429 независимо от состояния отключённости аккаунта (ревью round 3,
// item 2/§4.1) — именно так и родился первый ложный RED в round 2. У каждого
// теста ниже свой IP, поэтому бюджет одного теста не тратится другими.
async function signIn(password: string, clientIp: string): Promise<Response> {
  const { auth } = await import('@/lib/auth')
  const request = new Request('http://localhost:7622/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': clientIp },
    body: JSON.stringify({ email: EMAIL, password }),
  })
  // auth.handler — та же точка входа, что и настоящий HTTP-запрос через
  // app/api/auth/[...all]/route.ts (toNextJsHandler зовёт именно её), поэтому
  // ctx._flag === 'router' выставляется по-настоящему, а не по предположению.
  return auth.handler(request)
}

async function httpGetSession(cookieHeader: Headers, clientIp: string): Promise<Response> {
  const { auth } = await import('@/lib/auth')
  const headers = new Headers(cookieHeader)
  headers.set('x-real-ip', clientIp)
  const request = new Request('http://localhost:7622/api/auth/get-session', {
    method: 'GET',
    headers,
  })
  return auth.handler(request)
}

async function clearRateLimitRows(): Promise<void> {
  // Без фильтра по пути: этот файл — единственный во всём наборе, который
  // проходит через настоящий auth.handler, поэтому единственные строки
  // RateLimit в events_test вообще — его собственные (/sign-in/email от
  // signIn, /get-session от httpGetSession — под глобальным правилом).
  // Фильтрация только по '/sign-in/email' однажды уже оставляла после себя
  // строку по /get-session.
  const { prisma } = await import('@/lib/db')
  await prisma.rateLimit.deleteMany({})
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
  // Очистка ЗДЕСЬ, а не только в afterAll (ревью round 3, item 2): teardown не
  // выполняется, если прогон убит; setup выполняется всегда. Оставшаяся с
  // прошлого раза строка RateLimit не должна влиять на результат этого прогона.
  await clearRateLimitRows()
})

afterAll(async () => {
  const { prisma } = await import('@/lib/db')
  await prisma.user.deleteMany({ where: { email: EMAIL } })
  await clearRateLimitRows()
  await prisma.$disconnect()
})

describe('интеграция: реальные хуки better-auth (без мока @/lib/auth)', () => {
  it('getSessionUser/requireUser видят отключённого пользователя правильно', async () => {
    const { prisma } = await import('@/lib/db')
    const clientIp = '10.0.0.1'

    const signInResponse = await signIn(PASSWORD, clientIp)
    expect(signInResponse.status).toBe(200)
    sessionHeaders.current = extractCookieHeader(signInResponse)

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } })

    // try/finally: реактивация — в finally, а не последней строкой (замечено
    // на собственной верификации round 3 — упавшая проверка выше по коду
    // раньше оставляла пользователя отключённым для СЛЕДУЮЩЕГО теста файла,
    // превращая один осмысленный красный прогон в путающий каскад из
    // нескольких). Так падение именно этой проверки не задевает остальные тесты.
    try {
      const { getSessionUser, requireUser, AuthError } = await import('@/server/auth/session')

      // I-1: getSessionUser должен вернуть null, а НЕ отклонить промис —
      // до фикса round 2 хук в lib/auth.ts бросал бы APIError('ACCOUNT_DISABLED')
      // прямо из auth.api.getSession(), и этот await бы упал с посторонней ошибкой.
      await expect(getSessionUser()).resolves.toBeNull()

      // requireUser обязан по-прежнему различать коды: INACTIVE, а не что-то ещё.
      await expect(requireUser()).rejects.toBeInstanceOf(AuthError)
      await expect(requireUser()).rejects.toMatchObject({ code: 'INACTIVE' })
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { isActive: true } })
    }
  })

  // Ревью round 3, item 1: предыдущий раунд доказал только пропускающее
  // направление ветки A (прямой вызов проходит мимо хука) — ни один тест не
  // проверял, что хук ДЕЙСТВИТЕЛЬНО блокирует настоящий HTTP-запрос. Ветка A
  // целиком держится на ctx._flag === 'router' — признаке, которого нет в
  // публичных типах better-call; если будущая версия библиотеки переименует
  // или уберёт его, `'_flag' in ctx` станет false, хук будет возвращаться на
  // первой строке — и ни сборка, ни линт, ни остальные тесты этого не заметят.
  // Только этот тест — заметит.
  it('Branch A отклоняет настоящий HTTP-запрос к /get-session с cookie отключённого пользователя', async () => {
    const { prisma } = await import('@/lib/db')
    const clientIp = '10.0.0.2'

    const signInResponse = await signIn(PASSWORD, clientIp)
    expect(signInResponse.status).toBe(200)
    const cookieHeader = extractCookieHeader(signInResponse)

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } })

    try {
      const response = await httpGetSession(cookieHeader, clientIp)

      // Абсолютное значение, не относительное — именно это отличает "хук
      // сработал" от "хук молча пропустил, и что-то другое случайно вернуло
      // не 200".
      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body).toMatchObject({ code: 'ACCOUNT_DISABLED' })
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { isActive: true } })
    }
  })

  it('вход с верным паролем на отключённом аккаунте побайтово неотличим от неверного пароля', async () => {
    const { prisma } = await import('@/lib/db')
    const clientIp = '10.0.0.3'

    // Тест самодостаточен (ревью round 3, item 3): раньше sessionCount === 1
    // проверялся против сессии, оставленной ДРУГИМ тестом файла — при запуске
    // этого теста в одиночку, в другом порядке или после ДРУГИХ тестов файла
    // (каждый из которых тоже успешно входит и оставляет свою Session-строку)
    // проверка ловила бы не то число и падала бы без всякой связи с проверяемым
    // свойством. Явно убираем чужие сессии этого пользователя, прежде чем
    // создать свою единственную ожидаемую.
    await prisma.session.deleteMany({ where: { userId } })
    const baselineSignIn = await signIn(PASSWORD, clientIp)
    expect(baselineSignIn.status).toBe(200)

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } })

    try {
      const correctPasswordResponse = await signIn(PASSWORD, clientIp)
      const wrongPasswordResponse = await signIn('совершенно-неверный-пароль', clientIp)

      // Абсолютный якорь (ревью round 3, item 2 / §4.1): раньше единственной
      // проверкой статуса было equality двух ответов друг с другом — под тем же
      // рейт-лимитом два 429 тоже равны друг другу, и тест зеленел бы, не
      // доказав ничего. 401 — это именно код ответа better-auth на неверные
      // учётные данные (BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD), а не
      // "что-то, что совпало".
      expect(correctPasswordResponse.status).toBe(401)
      expect(wrongPasswordResponse.status).toBe(401)

      // Сравнение именно сериализованных тел, а не статусов и не "на глаз" —
      // ревью round 2 указало, что порядок ключей JSON.stringify — тоже байты
      // ответа, и что предыдущий раунд напечатал их в разном порядке, но в
      // прозе назвал "побайтово неотличимыми".
      const correctBody = await correctPasswordResponse.text()
      const wrongBody = await wrongPasswordResponse.text()
      expect(correctBody).toBe(wrongBody)
      expect(correctBody).toContain('INVALID_EMAIL_OR_PASSWORD')

      // Ни одна из двух попыток не должна была создать строку Session —
      // единственная сессия — та, что создал сам этот тест строкой выше.
      const sessionCount = await prisma.session.count({ where: { userId } })
      expect(sessionCount).toBe(1)
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { isActive: true } })
    }
  })
})
