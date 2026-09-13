import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    // Vite резервирует BASE_URL для import.meta.env (публичный базовый путь,
    // по умолчанию "/") и Vitest зеркалит его в process.env ДО setupFiles —
    // без этой строки наш BASE_URL из .env затирался бы значением "/" ещё
    // до того, как lib/env.ts успевал его прочитать. Значение берём здесь,
    // в момент загрузки конфига, пока process.env.BASE_URL ещё не перезаписан.
    env: { BASE_URL: process.env.BASE_URL },
    setupFiles: ['./tests/setup.ts'],
    // Тесты пишут в общую базу, поэтому параллельные файлы мешали бы друг другу
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      // Пакет server-only состоит из безусловного throw и обезвреживается
      // только условием разрешения react-server, которое выставляет Next.js
      // при сборке RSC. Vitest его не выставляет, поэтому любой импорт
      // lib/env.ts или lib/db.ts падал бы с сообщением про Client Component,
      // не имеющим отношения к настоящей причине. Подменяем пустышкой.
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
})
