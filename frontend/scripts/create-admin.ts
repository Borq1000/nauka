import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { prisma } from '../lib/db'
import { auth } from '../lib/auth'
import { normalizeEmail } from '../lib/normalize-email'

// Ввод пароля без эха.
//
// Первая версия пыталась использовать readline с terminal:true и перехватом
// 'data' поверх штатного эха readline (расчёт был на то, что наш слушатель
// подписывается позже встроенного и потому видит символ уже после того, как
// readline его вывел, и может тут же стереть строку). Проверка на реальном
// псевдотерминале (node-pty, не файловый редирект — тот вообще не
// показателен для TTY-поведения) это опровергла: readline на Windows
// перерисовывает промпт по всей видимой области построчно (множество
// `\x1B[K` на строку), и порядок, в котором наш обработчик видит уже
// нарисованный символ, не гарантирован относительно этой перерисовки —
// пароль оставался в потоке байтов терминала целиком, а не только первый
// символ. Полагаться на порядок подписчиков одного и того же 'data' —
// внутренняя деталь реализации readline, а не документированный контракт.
//
// Рабочий способ — тот, которым пользуются read/prompts/inquirer:
// перевести stdin в raw-режим самостоятельно и НИКОГДА не отдавать readline
// сырые байты пароля. Символы читаются по одному напрямую из stdin и вообще
// не выводятся (даже как '*') — readline тут не участвует, поэтому нет
// гонки с чужим эхом. Backspace стирает последний накопленный символ.
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(
        new Error(
          'Скрытый ввод пароля требует интерактивного терминала (TTY); запустите команду напрямую в терминале, не через перенаправление ввода',
        ),
      )
      return
    }

    stdout.write(question)
    let input = ''

    const cleanup = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
    }

    const onData = (chunk: Buffer) => {
      const str = chunk.toString('utf8')
      for (const ch of str) {
        if (ch === '\r' || ch === '\n') {
          cleanup()
          stdout.write('\n')
          resolve(input)
          return
        }
        if (ch === '') {
          // Ctrl+C: выйти как обычно прервал бы интерактивный ввод.
          cleanup()
          stdout.write('\n')
          process.exit(130)
        }
        if (ch === '' || ch === '\b') {
          input = input.slice(0, -1)
          continue
        }
        input += ch
      }
    }

    stdin.resume()
    stdin.setRawMode(true)
    stdin.on('data', onData)
  })
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout })

  const email = normalizeEmail(await rl.question('Email администратора: '))
  const name = (await rl.question('Имя: ')).trim()
  rl.close()

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Некорректный email')
    process.exit(1)
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.error(`Пользователь ${email} уже существует`)
    process.exit(1)
  }

  const password = await askHidden('Пароль (минимум 12 символов): ')
  const confirm = await askHidden('Повторите пароль: ')

  if (password !== confirm) {
    console.error('Пароли не совпадают')
    process.exit(1)
  }
  if (password.length < 12) {
    console.error('Пароль короче 12 символов')
    process.exit(1)
  }

  // `auth.api.signUpEmail` здесь не работает — проверено чтением исходников
  // установленной better-auth@1.7.4, а не по памяти — по двум независимым
  // причинам:
  //   1. `disableSignUp: true` (lib/auth.ts) проверяется ВНУТРИ обработчика
  //      /sign-up/email (better-auth/dist/api/routes/sign-up.mjs), поэтому
  //      прямой серверный вызов auth.api.signUpEmail отклоняется так же, как
  //      обычный HTTP-запрос — этот путь для CLI не работает вообще.
  //   2. Даже без disableSignUp: role/isActive в lib/auth.ts объявлены как
  //      additionalFields с `input: false` — значение из тела запроса для
  //      них отбрасывается при разборе входных данных парсером сайнапа, и в
  //      базу всегда попадает default (role: EDITOR) — иначе кто угодно мог
  //      бы прислать role: "ADMIN" при обычной регистрации.
  //
  // Рабочий путь — внутренний адаптер better-auth: createUser/createAccount
  // строят запись без этого разбора входных данных, поэтому role/isActive
  // попадают в базу как есть.
  const ctx = await auth.$context

  // Хеширование делает сам better-auth: ctx.password.hash — обёртка над тем
  // же scrypt-хешированием, что better-auth/crypto:hashPassword (см.
  // node_modules/better-auth/dist/context/init.mjs:182-184 установленной
  // версии — `hash: options.emailAndPassword?.password?.hash || hashPassword`).
  // Собственная криптография не пишется.
  const passwordHash = await ctx.password.hash(password)

  const user = await ctx.internalAdapter.createUser(
    {
      email,
      name,
      emailVerified: false,
      role: 'ADMIN',
      isActive: true,
    },
    // Второй аргумент отсутствовал в первоначальном плане брифа; в
    // установленной версии он ОБЯЗАТЕЛЕН по типу — InternalAdapter.createUser
    // (user, source: UserProvisioningSource), без `?` и без `| undefined`
    // (node_modules/@better-auth/core/dist/types/context.d.mts). На рантайме
    // он используется только веткой options.user.validateUserInfo (в
    // lib/auth.ts она не настроена), поэтому здесь это исключительно вопрос
    // типов, не поведения. 'admin' — одно из штатных значений
    // ValidateUserInfoMethod (init-options.d.mts) и точнее всего описывает
    // происхождение записи: не самостоятельная регистрация, а создание
    // административным процессом.
    { method: 'admin' },
  )

  await ctx.internalAdapter.createAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: passwordHash,
  })

  console.log(`Администратор ${email} создан`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('Ошибка:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
