import 'server-only'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
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

  plugins: [nextCookies()],
})
