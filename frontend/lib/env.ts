import 'server-only'
import { z } from 'zod'

// Zod 4: z.string().url() устарел в пользу отдельной функции z.url()
// (проверено по документации и по node_modules/zod/v4/classic/schemas.d.ts
// установленного пакета 4.6.4). .startsWith() не затронут устареванием —
// он остаётся обычным методом _ZodString, от которого наследует ZodURL,
// поэтому цепочка z.url().startsWith(...) работает как раньше.
const schema = z.object({
  DATABASE_URL: z.url().startsWith('postgresql://'),
  DATABASE_URL_TEST: z.url().startsWith('postgresql://').optional(),
  BASE_URL: z.url(),
  MEDIA_ROOT: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'Секрет сессий должен быть не короче 32 символов'),
  BETTER_AUTH_URL: z.url(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  // Перечисляем только ИМЕНА переменных — значения содержат пароль базы
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  throw new Error(`Некорректные переменные окружения: ${missing}. Сверьтесь с .env.example`)
}

export const env = parsed.data
