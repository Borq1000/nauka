import { defineConfig, env } from 'prisma/config'

// Prisma 7 перенесла адреса подключения из схемы сюда.
// Подпуть 'prisma/config' реэкспортирует defineConfig и env — проверено
// в node_modules/prisma/config.d.ts установленной версии 7.10.0.
export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
})
