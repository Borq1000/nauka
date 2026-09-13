import 'server-only'
import { z } from 'zod'

// `next build` устанавливает NODE_ENV=production даже локально (проверено:
// `npm run build` без TRUST_PROXY_SETS_CLIENT_IP падал бы, хотя развёртывание
// ещё не произошло, а машина, на которой собирают образ, может быть не той,
// на которой его потом запускают). Next.js на время сборки дополнительно
// ставит NEXT_PHASE=phase-production-build — это ЕДИНСТВЕННОЕ место, где
// NEXT_PHASE вообще присваивается (проверено: `grep -rn "NEXT_PHASE\s*="
// node_modules/next/` в установленной 16.3.5 даёт ровно одно совпадение,
// в build/index.js). При `next start` переменная НЕ устанавливается ни во
// что — она просто не определена, никакого "phase-production-server" нигде
// не пишется. Поэтому условие ниже — отрицание (`!== 'phase-production-build'`),
// а не сравнение с каким-либо значением "рантайма": так неопределённая на
// старте переменная тоже проходит проверку и включает guard. Написать это
// как `=== 'phase-production-server'` было бы неверно и тихо отключило бы
// guard целиком, потому что такого значения Next никогда не присваивает.
function isProductionServerRuntime(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build'
}

// Zod 4: z.string().url() устарел в пользу отдельной функции z.url()
// (проверено по документации и по node_modules/zod/v4/classic/schemas.d.ts
// установленного пакета 4.6.4). .startsWith() не затронут устареванием —
// он остаётся обычным методом _ZodString, от которого наследует ZodURL,
// поэтому цепочка z.url().startsWith(...) работает как раньше.
const schema = z
  .object({
    DATABASE_URL: z.url().startsWith('postgresql://'),
    DATABASE_URL_TEST: z.url().startsWith('postgresql://').optional(),
    BASE_URL: z.url(),
    MEDIA_ROOT: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32, 'Секрет сессий должен быть не короче 32 символов'),
    BETTER_AUTH_URL: z.url(),
    // I-3 (финальное ревью): подтверждение топологии развёртывания человеком,
    // а не обещание в README. Рейт-лимит better-auth (lib/auth.ts) строит
    // ключ бакета по X-Real-IP; если обратный прокси не перезаписывает этот
    // заголовок реальным адресом клиента, все клиенты делят один бакет на
    // /sign-in/email (3 попытки / 10с) — и три попытки входа от кого угодно
    // закрывают вход в CMS для всех, включая владелицу, без единого следа,
    // кроме одной строки в логе при старте процесса. Обязателен только в
    // проде: локально getIP() в dev/test всегда отдаёт фиксированный
    // 127.0.0.1, прокси нет вообще, и проблема не возникает в принципе.
    TRUST_PROXY_SETS_CLIENT_IP: z.string().optional(),
  })
  .refine((v) => v.BASE_URL === v.BETTER_AUTH_URL, {
    // M-8: оба значения — «адрес сайта». Разойдутся — origin check
    // better-auth начнёт отвергать вход способом, который ничего не скажет
    // о причине.
    message: 'BASE_URL и BETTER_AUTH_URL должны совпадать (сейчас различаются)',
    path: ['BETTER_AUTH_URL'],
  })
  .refine((v) => !isProductionServerRuntime() || v.TRUST_PROXY_SETS_CLIENT_IP === 'true', {
    message:
      'В продакшене обязательна переменная TRUST_PROXY_SETS_CLIENT_IP=true — ' +
      'ей вы подтверждаете, что обратный прокси перед приложением перезаписывает ' +
      'заголовок X-Real-IP настоящим адресом клиента (см. README, раздел про прокси). ' +
      'Без этого подтверждения рейт-лимит входа в один момент делит общий лимит ' +
      'попыток на всех посетителей сразу, и вход в панель управления можно ' +
      'заблокировать для владелицы, зная только адрес страницы входа.',
    path: ['TRUST_PROXY_SETS_CLIENT_IP'],
  })

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  // Перечисляем только ИМЕНА переменных — значения содержат пароль базы
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  throw new Error(`Некорректные переменные окружения: ${missing}. Сверьтесь с .env.example`)
}

export const env = parsed.data
