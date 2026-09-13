import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'

// Node runtime обязателен: драйвер PostgreSQL не работает на Edge.
export const runtime = 'nodejs'

export const { GET, POST } = toNextJsHandler(auth)
