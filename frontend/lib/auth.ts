import 'server-only'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { BASE_ERROR_CODES } from '@better-auth/core/error'
import { prisma } from './db'
import { env } from './env'

// Конфигурация сверена с документацией better-auth@1.7.4 через Context7
// (mcp__plugin_context7_context7__query-docs), а не написана по памяти —
// см. отчёт Task 4 для точных источников и цитат по каждому пункту ниже.
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  emailAndPassword: {
    enabled: true,
    // Публичной регистрации нет: пользователей заводит ADMIN,
    // первого — CLI-команда create-admin (Task 5).
    // Подтверждено документацией: better-auth/docs/reference/errors/signup_disabled.mdx
    // — при disableSignUp запрос к /sign-up/email завершается ошибкой,
    // а не молча игнорируется.
    disableSignUp: true,
    minPasswordLength: 12,
  },

  session: {
    // Сессии хранятся в таблице Session и проверяются на каждом запросе.
    // JWT не используется: подписанный токен невозможно отозвать,
    // а ТЗ требует, чтобы отключение пользователя прекращало активную сессию.
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // cookieCache НЕ включается (остаётся выключенным по умолчанию) —
    // это не упущение, а прямое следствие документации:
    // "When enabled, revoked sessions may remain active on other devices
    // until the cache duration (maxAge) expires ... If immediate session
    // revocation is critical, applications should disable cookie cache."
    // (better-auth/docs/concepts/session-management.mdx). Включение кэша
    // нарушило бы требование ТЗ п. про отключение пользователя.
  },

  rateLimit: {
    enabled: true,
    storage: 'database', // не память: она не переживает перезапуск
    window: 60,
    max: 10,
    customRules: {
      // /sign-in* уже получает окно 10с/max 3 от встроенного специального
      // правила better-auth (dist/api/rate-limiter/index.mjs,
      // getDefaultSpecialRules() — проверено в исходнике установленной
      // версии), которое строже глобального. Прописываем то же самое явно,
      // а не полагаемся на недокументированный для нас дефолт: значение не
      // должно тихо зависеть от того, останется ли это правило в будущих
      // версиях библиотеки (I-3, ревью round 1).
      '/sign-in/email': { window: 10, max: 3 },
    },
  },

  // Из какого заголовка брать IP клиента для rate limiting (I-3, ревью round 1).
  // По умолчанию (x-forwarded-for без trustedProxies) доверяется ЛЮБОЕ
  // одиночное значение заголовка — если приложение достижимо напрямую,
  // атакующий сам ставит этот заголовок и получает новый "бакет" на каждый
  // запрос, полностью обходя лимит (проверено в
  // @better-auth/core/dist/utils/ip.mjs, getIPFromHeader). x-real-ip решает
  // это тем, что обратный прокси обязан ПЕРЕЗАПИСЫВАТЬ его целиком, а не
  // добавлять к клиентскому значению — требование к прокси задокументировано
  // в README.md ("Продакшен: обратный прокси").
  //
  // Без этого заголовка (как в локальной разработке, где прокси нет вообще)
  // getIP() в dev/test возвращает фиксированный "127.0.0.1" — один общий
  // "бакет" на все локальные запросы, что безопасно: локально и так всегда
  // один реальный клиент. В проде без прокси, выставляющего этот заголовок,
  // getIP() вернёт null, и рейт-лимит выше упадёт на один общий "бакет" на
  // путь — better-auth сам логирует это предупреждение при первом же таком
  // запросе (resolveRateLimitConfig в том же файле).
  advanced: {
    ipAddress: {
      ipAddressHeaders: ['x-real-ip'],
    },
  },

  user: {
    additionalFields: {
      // input: false — обязательное условие: без него оба поля можно было бы
      // передать телом запроса на регистрацию/обновление профиля и получить
      // себе роль ADMIN. Подтверждено документацией (concepts/typescript.mdx,
      // concepts/database.mdx) и исходным тестом самого better-auth
      // (packages/better-auth/src/api/routes/sign-up.test.ts) — именно
      // такое написание (`type: 'string'`, `input: false`) используется
      // там для аналогичного поля role.
      role: { type: 'string', defaultValue: 'EDITOR', input: false },
      isActive: { type: 'boolean', defaultValue: true, input: false },
    },
  },

  // C-1 (ревью round 1): isActive — понятие ТОЛЬКО этого проекта, better-auth
  // о нём ничего не знает (`grep -rn "isActive" node_modules/better-auth/dist/`
  // не находит ни одного упоминания) и не проверяет его нигде сам. До этого
  // блока проверка стояла только в server/auth/session.ts::requireUser, а
  // сам HTTP-эндпоинт better-auth (app/api/auth/[...all]/route.ts) был
  // смонтирован без единой проверки — отключённый пользователь сохранял
  // рабочую сессию и мог даже войти заново. Нужны ДВЕ разные ветки, а не одна:
  // на момент входа личность ещё не установлена (это анонимное утверждение в
  // теле запроса), а на всех остальных эндпоинтах вызывающий уже держит
  // валидный токен именно этого аккаунта.
  hooks: {
    // Ветка A: эндпоинты, работающие с УЖЕ существующей сессией
    // (/get-session, /update-user, /change-password, /list-sessions,
    // /revoke-*, ...). /sign-in* и /sign-up* сюда намеренно не попадают —
    // видят их ветка B (databaseHooks.session.create.before) и сам
    // disableSignUp. Причина в разнице момента: здесь вызывающий уже
    // предъявил валидный токен именно этого аккаунта, поэтому отдельный ответ
    // "аккаунт отключён" ничего нового не раскрывает — и, что важнее,
    // проверка ДО обработчика гарантирует, что побочный эффект эндпоинта
    // (смена пароля, выпуск обновлённой сессии) вообще не выполнится.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path.startsWith('/sign-in') || ctx.path.startsWith('/sign-up')) return

      const session = await getSessionFromCtx(ctx)
      if (session?.user && session.user.isActive === false) {
        throw new APIError('FORBIDDEN', {
          code: 'ACCOUNT_DISABLED',
          message: 'Учётная запись отключена',
        })
      }
    }),
  },

  databaseHooks: {
    session: {
      create: {
        // Ветка B: /sign-in/email. НЕ before-хук верхнего уровня — на этом
        // этапе аккаунт ещё не подтверждён (пароль не проверен), и различимый
        // ответ "аккаунт отключён" превратил бы эндпоинт в оракул
        // существования аккаунта для анонимного вызывающего. Здесь же, в
        // database hook на создание Session, better-auth уже проверил пароль
        // (dist/api/routes/sign-in.mjs:329-335 выполняется раньше вызова
        // internalAdapter.createSession, который и запускает этот хук) — и
        // именно поэтому строка ниже бросает ТОТ ЖЕ ответ, что и неверный
        // пароль (BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD), а не отдельное
        // сообщение: отличать "отключён" от "неверный пароль" сообщило бы
        // анонимному наблюдателю, что пароль был верным — это утечка серьёзнее,
        // чем факт существования аккаунта. Бросок здесь же, ДО записи строки в
        // Session (createWithHooks сначала прогоняет before-хуки и только
        // потом создаёт запись — db/with-hooks.mjs), гарантирует, что у
        // отключённого пользователя не появится ни одной сессии ни на миг.
        before: async (session, ctx) => {
          if (!ctx) return
          // internalAdapter.findUserById не параметризован нашими
          // additionalFields (role/isActive) — тот же паттерн сужения типа,
          // что использует сам better-auth в своём admin-плагине для
          // аналогичной проверки banned (plugins/admin/admin.ts: `as
          // UserWithRole | null`). В рантайме поле присутствует: findUserById
          // читает через адаптер без select и без фильтрации по `returned`.
          const user = (await ctx.context.internalAdapter.findUserById(session.userId)) as {
            isActive?: boolean
          } | null
          if (user && user.isActive === false) {
            throw new APIError('UNAUTHORIZED', BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD)
          }
        },
      },
    },
  },

  plugins: [nextCookies()],
})
