import 'server-only'
// Prisma 7: клиент импортируется из СГЕНЕРИРОВАННОГО каталога, а не из
// пакета '@prisma/client'. Путь задан полем output в prisma/schema.prisma.
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { env } from './env'

// В dev-режиме Next.js перезагружает модули при каждом изменении файла.
// Без кеша в globalThis каждая перезагрузка создавала бы новый пул соединений,
// и PostgreSQL быстро упёрся бы в лимит подключений.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient() {
  // Driver adapter в Prisma 7 обязателен: new PrismaClient() без него — ошибка,
  // а устаревшее свойство datasourceUrl тоже даёт ошибку.
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
