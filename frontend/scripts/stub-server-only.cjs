'use strict'

// Запасной вариант из брифа Task 5, а не основной план: сначала было
// эмпирически проверено `node --conditions=react-server --import tsx
// scripts/create-admin.ts` (без этого файла) — упало НЕ с сообщением про
// Client Component, которое предполагал бриф, а с `Cannot find module
// 'server-only'` (MODULE_NOT_FOUND, стек — node:internal/modules/cjs/loader).
//
// Причина: пакет 'server-only' в этом проекте вообще не установлен —
// `npm ls server-only` печатает "(empty)", в package.json/package-lock.json
// его нет, а `require.resolve('server-only')` бросает MODULE_NOT_FOUND.
// Внутри Next.js `import 'server-only'` работает только потому, что
// собственный бандлер Next (webpack/turbopack) во время `next dev`/`next
// build` подменяет этот голый спецификатор на встроенную копию
// (next/dist/compiled/server-only) — это приватный алиас бандлера,
// недоступный обычному Node/tsx. Поэтому `--conditions=react-server`
// (условие ВЫБОРА экспорта уже НАЙДЕННОГО пакета) не может помочь: пакета
// нет вовсе, и до выбора условия дело не доходит.
//
// Второе следствие того же факта: в package.json НЕТ "type": "module", и
// стек ошибки явно проходит через node:internal/modules/cjs/loader
// (Function._load, Module._compile) — lib/db.ts и его цепочка импортов
// исполняются tsx как CommonJS, а не ESM. Поэтому ESM-хуки
// (`node:module`.`register`, загружаемые через --import и описанные в
// брифе как "regestering a substitution") НЕ подходят: они перехватывают
// только резолвинг через ESM-загрузчик. Проверено отдельно: --import с
// таким ESM-хуком, зарегистрированным на 'server-only', падает с ТОЙ ЖЕ
// ошибкой MODULE_NOT_FOUND — хук просто не вызывается для require().
// Подходит только патч самого CJS-резолвера, загруженный через --require
// (а не --import), — то, что сделано ниже.
//
// Module._load — стандартная, некспериментальная точка подмены для CJS
// (её использует, например, mock-require/proxyquire). Патч должен быть
// применён ДО того, как tsx (--import tsx) поставит свой собственный слой
// поверх Module._resolveFilename: --require обрабатывается раньше --import
// на той же командной строке — проверено: та же подмена, применённая через
// --import вместо --require, НЕ работает, потому что tsx успевает
// подключиться первым и захватывает более ранний (ещё не пропатченный)
// оригинал.
// Этот файл обязан оставаться CommonJS и грузиться через --require раньше
// tsx (см. комментарий выше); import здесь недоступен.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('node:module')

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') {
    // Внутри lib/db.ts, lib/auth.ts и т.д. этот импорт — только ради
    // побочного эффекта (`import 'server-only'`), ни одно имя из него не
    // читается. Форма модуля не важна — важно лишь не бросить.
    return {}
  }
  return originalLoad.call(this, request, parent, isMain)
}
