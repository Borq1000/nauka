# Фундамент «ВАУ! НАУКА»: проект, схема БД, аутентификация — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Получить запускающееся Next.js-приложение с полной схемой CMS в существующей базе `events`, работающим входом и проверкой ролей на сервере.

**Architecture:** Одно Next.js-приложение (App Router) с Server Components по умолчанию. Доступ к PostgreSQL — только на сервере через singleton Prisma Client. Аутентификация — better-auth с сессиями в БД (не JWT), чтобы отключение пользователя немедленно прекращало действующую сессию. Инварианты, где проверка в коде создаёт гонку, обеспечиваются ограничениями PostgreSQL.

**Tech Stack:** Next.js 16.3.5, React 19.2.8 (версию задаёт Next), TypeScript strict, Tailwind CSS 4, Prisma 7.10.0 (CLI в devDependencies, client в dependencies), `@prisma/adapter-pg` 7.10.0 + `pg` 8.23.0, better-auth 1.7.4, Zod 4.6.4, Vitest 5.0.0, tsx 4.23.13.

**Spec:** `docs/superpowers/specs/2026-09-13-nauka-cms-design.md`

**Требования заказчика:** `mds/claude-event-website-spec.md` (источник истины; при расхождении со спекой побеждает он)

---

## Global Constraints

Требования, действующие на **каждую** задачу плана. Значения скопированы из спеки дословно.

- **Каталог проекта — `frontend` в нижнем регистре.** Не создавать вложенный `frontend/frontend` или параллельный `Frontend`.
- **Компоненты — в каталоге `Components` с заглавной `C`**, разделённом по доменным сущностям. Единый регистр путей во всех импортах (проект поедет на Linux, где регистр значим).
- **Версии фиксируются точно, без диапазона `^`:** `prisma@7.10.0`, `@prisma/client@7.10.0`. Причина: тег `latest` у пакета `prisma` указывает на `8.0.0-rc.14` (release candidate), а `better-auth@1.7.4` объявляет peer `prisma: ^5 || ^6 || ^7` — восьмёрка несовместима.
- **База — существующая `events` на `localhost:5432`, пользователь `postgres`.** Не создавать другую базу вместо неё, не заменять PostgreSQL на SQLite. Существующие данные не удалять.
- **Запрещено:** `prisma migrate reset`, `prisma db push` на базе `events`, любые деструктивные операции.
- **Секреты — только в `.env`**, который исключён из Git. В репозиторий попадает только `.env.example` с заглушками. Реквизиты не выводить в логи.
- **`NEXT_PUBLIC_`** не используется для доступа к базе, секретов сессий и серверных ключей.
- **Node runtime** для всех маршрутов, работающих с БД и сессиями. Не Edge.
- **Ни одного `dangerouslySetInnerHTML`** в проекте.
- **Язык интерфейса и контента — русский.** Сообщения об ошибках для пользователя — на русском.
- **Node.js ≥ 20.9.0** (требование `next@16.3.5`). Фактически установлен v22.16.0.
- **Конвенции Prisma 7 обязательны** — шестая версия писалась иначе, и примеры из памяти не заработают. Проверено по документации и по установленному пакету:
  - `datasource` содержит **только** `provider`. URL базы задаётся в `prisma.config.ts`, а не в схеме.
  - `generator client` использует провайдер **`prisma-client`** (не `prisma-client-js`), поле `output` **обязательно**.
  - Клиент импортируется из сгенерированного каталога, а не из `@prisma/client`.
  - **Driver adapter обязателен:** `new PrismaClient()` без адаптера — ошибка, свойство `datasourceUrl` устарело и тоже даёт ошибку. Для PostgreSQL используется `PrismaPg` из `@prisma/adapter-pg`.

---

## Структура файлов

Что создаётся этим планом и за что отвечает каждый файл.

| Файл | Ответственность |
|---|---|
| `frontend/lib/env.ts` | Разбор и валидация переменных окружения через Zod. Единственное место, где читается `process.env` |
| `frontend/lib/db.ts` | Singleton Prisma Client, переживающий hot reload |
| `frontend/lib/auth.ts` | Конфигурация better-auth: Prisma-адаптер, сессии в БД, лимит попыток входа |
| `frontend/lib/auth-client.ts` | Клиентская часть better-auth для формы входа |
| `frontend/server/auth/session.ts` | `getSessionUser` / `requireUser` / `requireRole` — единственный способ получить пользователя в серверном коде |
| `frontend/prisma/schema.prisma` | Схема всех сущностей CMS |
| `frontend/prisma/migrations/**` | Версионированные миграции, включая SQL-инварианты |
| `frontend/scripts/create-admin.ts` | CLI создания первого ADMIN со скрытым вводом пароля |
| `frontend/app/(admin)/admin/login/page.tsx` | Страница входа |
| `frontend/Components/auth/LoginForm.tsx` | Client Component формы входа |
| `frontend/tests/setup.ts` | Подготовка тестовой БД `events_test` |
| `frontend/tests/db-invariants.test.ts` | Проверки ограничений уровня БД |
| `frontend/tests/auth-guards.test.ts` | Проверки отказа без сессии и с недостаточной ролью |

**Про тестовую базу.** Интеграционные тесты работают с отдельной базой `events_test`, а не с `events`. Это не нарушает требование «не создавай другую базу вместо предоставленной»: `events` остаётся рабочей базой приложения, `events_test` существует только для тестов и пересоздаётся свободно. Прогонять тесты по `events` нельзя — они очищают таблицы и уничтожили бы контент владелицы.

---

## Task 1: Создание проекта и фиксация зависимостей

**Files:**
- Create: `frontend/**` (генератор)
- Modify: `frontend/package.json`
- Modify: `frontend/tsconfig.json`

**Interfaces:**
- Consumes: ничего (первая задача)
- Produces: каталог `frontend` с Next.js 16.3.5, App Router, TypeScript strict, Tailwind 4; alias `@/*` на корень `frontend`

- [ ] **Шаг 1: Проверить версию Node**

```bash
node -v
```

Ожидается `v20.9.0` или выше. Фактически в этом окружении `v22.16.0`. Если ниже — остановиться и сообщить, `next@16` не запустится.

- [ ] **Шаг 2: Создать проект строго указанной командой**

Из корня `C:\Users\Boris\Desktop\projects-p\nauka`:

```bash
npx create-next-app@latest frontend --yes
```

ТЗ требует именно эту команду. Флаг `--yes` может подставить сохранённые настройки предыдущих запусков, поэтому результат обязательно проверяется следующим шагом.

- [ ] **Шаг 3: Проверить, что генератор дал нужную конфигурацию**

```bash
cd frontend
cat package.json
ls app 2>/dev/null || ls src/app
cat tsconfig.json | grep -A2 '"strict"'
```

Проверить три вещи:
1. `next` версии `16.x`, в зависимостях есть `typescript` и `tailwindcss` версии `4.x`;
2. существует каталог `app` (App Router), а не `pages`;
3. `"strict": true` в `tsconfig.json`.

Если TypeScript, Tailwind или App Router отсутствуют — **исправить конфигурацию вручную**, не пересоздавая проект (требование ТЗ п. 2).

- [ ] **Шаг 4: Привести структуру к соглашению ТЗ**

Если генератор создал `src/` — перенести содержимое в корень `frontend`:

```bash
# выполнять только если каталог src существует
mv src/app app
rmdir src 2>/dev/null || true
```

Затем убедиться, что в `tsconfig.json` alias указывает на корень:

```json
{
  "compilerOptions": {
    "paths": { "@/*": ["./*"] }
  }
}
```

- [ ] **Шаг 5: Создать доменные каталоги**

```bash
mkdir -p Components/ui Components/layout Components/pages Components/services \
         Components/blog Components/categories Components/media Components/inquiries \
         Components/auth Components/settings Components/editor \
         server lib scripts tests
```

Каталог `Components` — с заглавной `C`. На Windows регистр в именах не различается при обращении, но Git его запоминает, и на Linux-сервере неверный регистр в импорте сломает сборку.

- [ ] **Шаг 6: Установить зависимости точными версиями**

```bash
npm i prisma@7.10.0 @prisma/client@7.10.0 better-auth@1.7.4 zod@4.6.4
npm i -D vitest@5.0.0 tsx@4.23.13 dotenv-cli@11.0.0
```

Версии Prisma указаны **точно**, без `^`. Проверить, что npm не подтянул другое:

```bash
npm ls prisma @prisma/client
```

Ожидается `prisma@7.10.0` и `@prisma/client@7.10.0`. Если видно `8.0.0-rc` — установка пошла не так, повторить с точными версиями.

- [ ] **Шаг 7: Проверить, что проект собирается**

```bash
npm run build
```

Ожидается успешная сборка без ошибок TypeScript.

- [ ] **Шаг 8: Коммит**

```bash
cd ..
git add frontend
git commit -m "feat: создан проект Next.js 16 с зафиксированными версиями зависимостей"
```

---

## Task 2: Окружение и подключение к базе

**Files:**
- Create: `frontend/.env` (не коммитится)
- Create: `frontend/.env.example`
- Create: `frontend/lib/env.ts`
- Create: `frontend/lib/db.ts`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/tests/setup.ts`
- Create: `frontend/tests/stubs/server-only.ts` (пустой файл)
- Create: `frontend/prisma/schema.prisma` (минимальный, модели добавит Task 3)
- Create: `frontend/prisma.config.ts`
- Test: `frontend/tests/db-connection.test.ts`

**Interfaces:**
- Consumes: каталог `frontend` из Task 1
- Produces:
  - `lib/env.ts` → `export const env: { DATABASE_URL: string; DATABASE_URL_TEST?: string; BASE_URL: string; MEDIA_ROOT: string; BETTER_AUTH_SECRET: string; BETTER_AUTH_URL: string }`
  - `lib/db.ts` → `export const prisma: PrismaClient` (клиент импортируется из `@/generated/prisma/client`, создаётся с адаптером `PrismaPg`)
  - сгенерированный клиент Prisma в `frontend/generated/prisma/` (в Git не попадает)

- [ ] **Шаг 1: Проверить, что `.env` исключён из Git**

```bash
cd C:/Users/Boris/Desktop/projects-p/nauka
git check-ignore -v frontend/.env
```

Ожидается строка, показывающая правило `.env` из корневого `.gitignore`. **Если команда ничего не вывела — остановиться и починить `.gitignore` до создания файла.** Пароль базы, попавший в коммит, удаляется из истории болезненно.

- [ ] **Шаг 2: Создать `.env.example` с заглушками**

`frontend/.env.example`:

```bash
# Подключение к PostgreSQL. Спецсимволы в пароле кодировать percent-encoding.
DATABASE_URL="postgresql://ПОЛЬЗОВАТЕЛЬ:ПАРОЛЬ@localhost:5432/ИМЯ_БАЗЫ?schema=public"

# Отдельная база ТОЛЬКО для автотестов. Тесты очищают таблицы,
# поэтому направлять их на рабочую базу нельзя.
DATABASE_URL_TEST="postgresql://ПОЛЬЗОВАТЕЛЬ:ПАРОЛЬ@localhost:5432/ИМЯ_БАЗЫ_test?schema=public"

# Базовый адрес сайта. На проде — реальный домен, не localhost.
BASE_URL="http://localhost:3000"

# Каталог хранения загруженных файлов. Должен быть ВНЕ frontend/,
# иначе пересборка Next.js его затрёт.
MEDIA_ROOT="../media"

# Секрет подписи сессий. Сгенерировать: openssl rand -base64 32
BETTER_AUTH_SECRET="ЗАМЕНИТЬ_НА_СЛУЧАЙНУЮ_СТРОКУ"
BETTER_AUTH_URL="http://localhost:3000"
```

- [ ] **Шаг 3: Создать реальный `.env`**

`frontend/.env` — реквизиты предоставлены заказчиком: база `events`, пользователь `postgres`, пароль `REDACTED`. Спецсимволов, требующих кодирования, в пароле нет.

```bash
DATABASE_URL="postgresql://postgres:REDACTED@localhost:5432/events?schema=public"
DATABASE_URL_TEST="postgresql://postgres:REDACTED@localhost:5432/events_test?schema=public"
BASE_URL="http://localhost:3000"
MEDIA_ROOT="../media"
BETTER_AUTH_SECRET="<подставить вывод команды ниже>"
BETTER_AUTH_URL="http://localhost:3000"
```

Секрет сгенерировать командой, не придумывать:

```bash
openssl rand -base64 32
```

- [ ] **Шаг 3a: Создать тестовую базу**

```bash
"/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d postgres \
  -c "CREATE DATABASE events_test;"
```

Это **не** замена предоставленной базы: `events` остаётся рабочей базой приложения. `events_test` существует отдельно и только для автотестов, которые очищают таблицы и потому не могут работать с рабочими данными.

Если база уже существует — команда вернёт ошибку `already exists`, это нормально, переходите дальше.

- [ ] **Шаг 4: Написать падающий тест на разбор окружения**

`frontend/tests/db-connection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('окружение', () => {
  it('валидирует обязательные переменные и не падает молча', async () => {
    const { env } = await import('@/lib/env')
    expect(env.DATABASE_URL).toMatch(/^postgresql:\/\//)
    expect(env.BASE_URL).toMatch(/^https?:\/\//)
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32)
  })
})

describe('подключение к базе', () => {
  it('выполняет запрос к реальной PostgreSQL', async () => {
    const { prisma } = await import('@/lib/db')
    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 as one`
    expect(rows[0].one).toBe(1)
  })
})
```

- [ ] **Шаг 5: Запустить тест и убедиться, что он падает**

Сначала создать `frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
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
```

Создать пустой файл-заглушку:

```bash
mkdir -p tests/stubs
echo "// Заглушка server-only для тестовой среды. Намеренно пуст." > tests/stubs/server-only.ts
```

И `frontend/tests/setup.ts`:

```ts
// Перенаправляет ВСЕ тесты на events_test до того, как какой-либо модуль
// прочитает DATABASE_URL. Без этого тесты работали бы с рабочей базой:
// удаляли бы контент владелицы, а тест «две главные страницы запрещены»
// начал бы падать, как только в events появится настоящая главная —
// частичный уникальный индекс просто не дал бы создать тестовую.
if (!process.env.DATABASE_URL_TEST) {
  throw new Error('DATABASE_URL_TEST не задан — тесты отказываются работать с рабочей базой')
}

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST
```

Проверка на отсутствие переменной намеренно жёсткая: тихий откат на рабочую базу — именно та ошибка, которую этот файл предотвращает.

Добавить в `package.json` скрипт:

```json
{ "scripts": { "test": "dotenv -e .env -- vitest run" } }
```

`dotenv-cli` нужен, потому что Vitest не читает `.env` сам, а Prisma CLI и приложение должны получать одинаковую конфигурацию окружения (требование ТЗ п. 3).

```bash
npm test
```

Ожидается FAIL: `Cannot find module '@/lib/env'`.

- [ ] **Шаг 6: Реализовать `lib/env.ts`**

```ts
import 'server-only'
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  DATABASE_URL_TEST: z.string().url().startsWith('postgresql://').optional(),
  BASE_URL: z.string().url(),
  MEDIA_ROOT: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'Секрет сессий должен быть не короче 32 символов'),
  BETTER_AUTH_URL: z.string().url(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  // Перечисляем только ИМЕНА переменных — значения содержат пароль базы
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  throw new Error(`Некорректные переменные окружения: ${missing}. Сверьтесь с .env.example`)
}

export const env = parsed.data
```

Обратите внимание: в сообщение об ошибке попадают только имена переменных. Вывод значений напечатал бы пароль в лог — прямой запрет ТЗ п. 3.

- [ ] **Шаг 7: Реализовать `lib/db.ts`**

```ts
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
```

Уровень логирования `query` намеренно не включён: Prisma печатает параметры запросов, а среди них бывают пароли и персональные данные заявок.

- [ ] **Шаг 7a: Установить driver adapter для PostgreSQL**

```bash
npm i --save-exact @prisma/adapter-pg@7.10.0 pg@8.23.0
```

Версия адаптера совпадает с ядром Prisma намеренно — это одна выпускаемая пара. Обе зависимости рантаймовые (`dependencies`), в отличие от CLI `prisma`, который живёт в `devDependencies`.

- [ ] **Шаг 8: Создать схему Prisma и `prisma.config.ts`**

**Не запускать `prisma init`.** Эта команда создаёт собственный `.env` с плейсхолдером `DATABASE_URL`, а `.env` уже создан на шаге 3 — возможна вторая строка `DATABASE_URL`, и какая победит, зависит от парсера.

Конвенции ниже проверены по документации Prisma 7 и по содержимому установленного пакета; они **отличаются** от привычных по шестой версии. Писать по памяти нельзя.

`frontend/prisma/schema.prisma` — два блока, без моделей (модели добавит Task 3):

```prisma
generator client {
  // Prisma 7: провайдер prisma-client (НЕ prisma-client-js), output обязателен.
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  // Prisma 7: в блоке остаётся ТОЛЬКО provider.
  // URL задаётся в prisma.config.ts.
  provider = "postgresql"
}
```

`frontend/prisma.config.ts` — в корне `frontend`, рядом с `package.json`:

```ts
import { defineConfig, env } from 'prisma/config'

// Prisma 7 перенесла адреса подключения из схемы сюда.
// Подпуть 'prisma/config' реэкспортирует defineConfig и env — проверено
// в node_modules/prisma/config.d.ts установленной версии 7.10.0.
export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

Исключить сгенерированный клиент из Git — это артефакт сборки, а не исходный код. Добавить в `frontend/.gitignore`:

```
# сгенерированный клиент Prisma (создаётся командой prisma generate)
/generated/
```

Чтобы сборка работала на свежем клоне, добавить в `frontend/package.json`:

```json
{ "scripts": { "postinstall": "prisma generate" } }
```

Затем:

```bash
npx prisma generate
npm test
```

Ожидается PASS обоих тестов. Второй тест подтверждает **реальное** подключение к PostgreSQL, а не предположение о нём.

Две ситуации и что делать:
- Если `prisma generate` откажется работать на схеме без моделей — добавить временную модель `model _Bootstrap { id String @id }`, сгенерировать клиент и удалить её в Task 3.
- Если `postinstall` упадёт из-за отсутствия переменных окружения при установке — убрать этот скрипт и вместо него задокументировать в отчёте, что перед сборкой требуется ручной `npx prisma generate`. Не заставлять установку зависеть от наличия `.env`.

- [ ] **Шаг 9: Проверить, что `.env` не попал в индекс**

```bash
cd ..
git status --short frontend/
```

В выводе **не должно быть** `frontend/.env`. Если он там есть — остановиться и исправить `.gitignore`.

- [ ] **Шаг 10: Коммит**

```bash
git add frontend/lib frontend/.env.example frontend/tests frontend/vitest.config.ts frontend/package.json frontend/prisma
git commit -m "feat: валидация окружения и singleton Prisma Client с проверкой подключения"
```

---

## Task 3: Схема базы данных

**Files:**
- Modify: `frontend/prisma/schema.prisma`
- Create: `frontend/prisma/migrations/<timestamp>_init/migration.sql`

**Interfaces:**
- Consumes: `lib/db.ts` из Task 2
- Produces: модели `User`, `Session`, `Account`, `Verification`, `Media`, `Page`, `Service`, `Post`, `Category`, `PostCategory`, `Inquiry`, `SiteSettings`, `Menu`, `MenuItem`, `Redirect`, `RateLimit`; перечисления `Role`, `PublishStatus`, `InquiryStatus`

- [ ] **Шаг 1: Проверить состояние базы до миграции**

```bash
cd frontend
npx prisma db pull --print
```

Ожидается пустая схема — база `events` не содержит таблиц. **Если таблицы обнаружены — остановиться и сообщить заказчику.** ТЗ п. 3 запрещает удалять и перезаписывать существующие данные.

- [ ] **Шаг 2: Написать схему**

`frontend/prisma/schema.prisma`:

Блоки `generator` и `datasource` уже созданы в Task 2 по конвенциям Prisma 7 — **оставить их как есть**, не переписывать под шестую версию:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum Role {
  ADMIN
  EDITOR
}

enum PublishStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

enum InquiryStatus {
  NEW
  IN_PROGRESS
  DONE
  SPAM
}

// ---------- Пользователи и сессии (структура под better-auth) ----------

model User {
  id            String    @id @default(uuid())
  email         String    @unique          // хранится в нижнем регистре
  emailVerified Boolean   @default(false)
  name          String
  image         String?
  role          Role      @default(EDITOR)
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  sessions      Session[]
  accounts      Account[]
  posts         Post[]    @relation("PostAuthor")

  @@index([isActive])
}

model Session {
  id        String   @id @default(uuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
}

model Account {
  id                    String    @id @default(uuid())
  userId                String
  accountId             String
  providerId            String
  accessToken           String?
  refreshToken          String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  idToken               String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([providerId, accountId])
  @@index([userId])
}

model Verification {
  id         String   @id @default(uuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
}

model RateLimit {
  id        String   @id @default(uuid())
  key       String   @unique
  count     Int      @default(0)
  lastReset BigInt

  @@index([key])
}

// ---------- Медиа ----------

model Media {
  id           String   @id @default(uuid())
  storageKey   String   @unique
  originalName String
  mimeType     String
  sizeBytes    Int
  width        Int?
  height       Int?
  alt          String   @default("")
  createdAt    DateTime @default(now())

  pagesCover   Page[]    @relation("PageCover")
  pagesOg      Page[]    @relation("PageOg")
  servicesCover Service[] @relation("ServiceCover")
  servicesOg   Service[] @relation("ServiceOg")
  postsCover   Post[]    @relation("PostCover")
  postsOg      Post[]    @relation("PostOg")
}

// ---------- Обычные страницы ----------

model Page {
  id             String        @id @default(uuid())
  title          String
  slug           String        @unique
  status         PublishStatus @default(DRAFT)
  excerpt        String?
  content        Json?
  coverMediaId   String?
  seoTitle       String?
  seoDescription String?
  ogMediaId      String?
  noIndex        Boolean       @default(false)
  templateKey    String        @default("default")
  templateData   Json?
  isHome         Boolean       @default(false)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  publishedAt    DateTime?
  createdById    String?
  updatedById    String?

  coverMedia     Media?        @relation("PageCover", fields: [coverMediaId], references: [id], onDelete: Restrict)
  ogMedia        Media?        @relation("PageOg", fields: [ogMediaId], references: [id], onDelete: Restrict)

  @@index([status, publishedAt])
}

// ---------- Услуги ----------

model Service {
  id              String        @id @default(uuid())
  title           String
  slug            String        @unique
  path            String        @unique   // материализованный путь: "science/tesla"
  status          PublishStatus @default(DRAFT)
  excerpt         String?
  content         Json?
  coverMediaId    String?
  seoTitle        String?
  seoDescription  String?
  ogMediaId       String?
  noIndex         Boolean       @default(false)
  parentId        String?
  sortOrder       Int           @default(0)
  templateKey     String        @default("service-default")
  templateData    Json?
  isFeatured      Boolean       @default(false)
  priceFrom       Decimal?      @db.Decimal(10, 2)
  currency        String?       @default("RUB")
  durationMinutes Int?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  publishedAt     DateTime?
  createdById     String?
  updatedById     String?

  parent          Service?      @relation("ServiceTree", fields: [parentId], references: [id], onDelete: Restrict)
  children        Service[]     @relation("ServiceTree")
  coverMedia      Media?        @relation("ServiceCover", fields: [coverMediaId], references: [id], onDelete: Restrict)
  ogMedia         Media?        @relation("ServiceOg", fields: [ogMediaId], references: [id], onDelete: Restrict)
  inquiries       Inquiry[]

  @@index([parentId, sortOrder])
  @@index([status, publishedAt])
}
```

`onDelete: Restrict` у `parent` — прямое требование ТЗ п. 4.3: удаление родителя с детьми должно блокироваться, а не каскадировать.

- [ ] **Шаг 3: Дописать оставшиеся модели**

Продолжение `schema.prisma`:

```prisma
// ---------- Блог ----------

model Post {
  id             String         @id @default(uuid())
  title          String
  slug           String         @unique
  status         PublishStatus  @default(DRAFT)
  excerpt        String?
  content        Json?
  coverMediaId   String?
  seoTitle       String?
  seoDescription String?
  ogMediaId      String?
  noIndex        Boolean        @default(false)
  authorId       String
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  publishedAt    DateTime?
  createdById    String?
  updatedById    String?

  author         User           @relation("PostAuthor", fields: [authorId], references: [id], onDelete: Restrict)
  coverMedia     Media?         @relation("PostCover", fields: [coverMediaId], references: [id], onDelete: Restrict)
  ogMedia        Media?         @relation("PostOg", fields: [ogMediaId], references: [id], onDelete: Restrict)
  categories     PostCategory[]

  @@index([status, publishedAt])
  @@index([authorId])
}

model Category {
  id             String         @id @default(uuid())
  name           String
  slug           String         @unique
  description    String?
  seoTitle       String?
  seoDescription String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  posts          PostCategory[]
}

model PostCategory {
  postId     String
  categoryId String

  post       Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  category   Category @relation(fields: [categoryId], references: [id], onDelete: Restrict)

  @@id([postId, categoryId])
  @@index([categoryId])
}

// ---------- Заявки ----------

model Inquiry {
  id          String        @id @default(uuid())
  name        String
  phone       String
  email       String?
  message     String?
  serviceId   String?
  desiredDate DateTime?
  status      InquiryStatus @default(NEW)
  sourcePath  String
  ipHash      String?
  createdAt   DateTime      @default(now())

  service     Service?      @relation(fields: [serviceId], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
}

// ---------- Настройки, меню, редиректы ----------

model SiteSettings {
  id             String   @id @default("singleton")
  siteName       String
  siteDescription String?
  logoMediaId    String?
  phone          String?
  email          String?
  address        String?
  socialLinks    Json?
  timezone       String   @default("Europe/Moscow")
  seoTitle       String?
  seoDescription String?
  updatedAt      DateTime @updatedAt
}

model Menu {
  id        String     @id @default(uuid())
  key       String     @unique   // "header" | "footer"
  title     String
  items     MenuItem[]
}

model MenuItem {
  id         String     @id @default(uuid())
  menuId     String
  parentId   String?
  label      String
  entityType String?    // "page" | "service" | "post" | "category"
  entityId   String?    // ссылка на id сущности, НЕ на slug
  externalUrl String?
  sortOrder  Int        @default(0)

  menu       Menu       @relation(fields: [menuId], references: [id], onDelete: Cascade)
  parent     MenuItem?  @relation("MenuTree", fields: [parentId], references: [id], onDelete: Cascade)
  children   MenuItem[] @relation("MenuTree")

  @@index([menuId, sortOrder])
  @@index([parentId])
}

model Redirect {
  id         String   @id @default(uuid())
  sourcePath String   @unique
  targetPath String
  code       Int      @default(301)
  createdAt  DateTime @default(now())

  @@index([targetPath])
}
```

`MenuItem` хранит `entityId`, а не скопированный slug — требование ТЗ п. 4.5. При рендере URL строится из актуальных данных, поэтому переименование страницы не ломает меню.

- [ ] **Шаг 4: Создать миграцию**

```bash
npx dotenv -e .env -- npx prisma migrate dev --name init
```

Prisma создаст shadow database для проверки дрейфа схемы. Право `CREATEDB` у роли `postgres` подтверждено, поэтому это сработает.

Убедиться, что в выводе **нет** слов `reset`, `drop database` или предупреждения о потере данных. База пуста, миграция должна быть чисто создающей.

- [ ] **Шаг 4a: Применить миграции к тестовой базе**

Выполнить напрямую, с inline-переменной окружения. Отдельный npm-скрипт для этого не заводится: он потребовал бы `cross-env-shell`, которого нет в зависимостях.

```bash
DATABASE_URL="postgresql://postgres:REDACTED@localhost:5432/events_test?schema=public" \
  npx prisma migrate deploy
```

Ожидается применение тех же миграций к `events_test`. Эту команду нужно повторять после каждой новой миграции.

- [ ] **Шаг 5: Написать падающий тест на инварианты уровня БД**

`frontend/tests/db-invariants.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Используется тот же singleton, что и в приложении: tests/setup.ts уже
// перенаправил DATABASE_URL на events_test до загрузки этого модуля,
// поэтому клиент подключается к тестовой базе, а не к рабочей.
// Собственный new PrismaClient() здесь не создаётся: в Prisma 7 он требует
// driver adapter, и дублировать его настройку в тестах незачем.
import { prisma } from '@/lib/db'

beforeAll(async () => {
  await prisma.page.deleteMany({ where: { slug: { startsWith: 'test-' } } })
})

afterAll(async () => {
  await prisma.page.deleteMany({ where: { slug: { startsWith: 'test-' } } })
  await prisma.$disconnect()
})

describe('инварианты уровня базы данных', () => {
  it('не допускает двух главных страниц', async () => {
    await prisma.page.create({
      data: { title: 'Первая главная', slug: 'test-home-a', isHome: true },
    })

    // Вторая главная должна быть отвергнута самой базой, а не кодом приложения
    await expect(
      prisma.page.create({
        data: { title: 'Вторая главная', slug: 'test-home-b', isHome: true },
      }),
    ).rejects.toThrow()
  })

  it('допускает много страниц с isHome = false', async () => {
    await prisma.page.create({ data: { title: 'Обычная 1', slug: 'test-p1', isHome: false } })
    await prisma.page.create({ data: { title: 'Обычная 2', slug: 'test-p2', isHome: false } })

    const count = await prisma.page.count({ where: { slug: { startsWith: 'test-p' } } })
    expect(count).toBe(2)
  })

  it('не допускает двух услуг с одинаковым path', async () => {
    const a = await prisma.service.create({
      data: { title: 'Наука', slug: 'test-science', path: 'test-science' },
    })
    await expect(
      prisma.service.create({
        data: { title: 'Дубль', slug: 'test-science-2', path: 'test-science' },
      }),
    ).rejects.toThrow()
    await prisma.service.delete({ where: { id: a.id } })
  })
})
```

- [ ] **Шаг 6: Запустить тест и убедиться, что первый падает**

```bash
npm test -- tests/db-invariants.test.ts
```

Ожидается FAIL первого теста: вторая главная **создастся**, потому что частичного уникального индекса ещё нет. Это и есть та самая гонка, которую нельзя закрыть проверкой в коде.

- [ ] **Шаг 7: Добавить миграцию с частичным уникальным индексом**

Prisma не умеет выражать частичный уникальный индекс в схеме, поэтому пишем SQL вручную:

```bash
npx dotenv -e .env -- npx prisma migrate dev --create-only --name page_single_home
```

В созданный файл `prisma/migrations/<timestamp>_page_single_home/migration.sql` записать:

```sql
-- Единственная главная страница обеспечивается базой, а не кодом приложения.
-- Проверка "нет ли уже главной?" в коде гоночная: два одновременных
-- сохранения пройдут её оба и создадут две главные.
CREATE UNIQUE INDEX "Page_isHome_unique" ON "Page" ("isHome") WHERE "isHome" = true;
```

Применить к обеим базам — рабочей и тестовой:

```bash
npx dotenv -e .env -- npx prisma migrate deploy

DATABASE_URL="postgresql://postgres:REDACTED@localhost:5432/events_test?schema=public" \
  npx prisma migrate deploy
```

- [ ] **Шаг 8: Запустить тест и убедиться, что он проходит**

```bash
npm test -- tests/db-invariants.test.ts
```

Ожидается PASS всех трёх тестов.

- [ ] **Шаг 9: Проверить таблицы в реальной базе**

```bash
"/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d events -c "\dt"
```

Ожидается список всех созданных таблиц. Это подтверждение, что схема применена к реальной базе, а не только описана в файле.

- [ ] **Шаг 10: Коммит**

```bash
cd ..
git add frontend/prisma frontend/tests
git commit -m "feat: схема CMS и инвариант единственной главной страницы на уровне БД"
```

---

## Task 4: Аутентификация с сессиями в базе

**Files:**
- Create: `frontend/lib/auth.ts`
- Create: `frontend/app/api/auth/[...all]/route.ts`
- Create: `frontend/server/auth/session.ts`
- Test: `frontend/tests/auth-guards.test.ts`

(`lib/auth-client.ts` создаётся в Task 6 — здесь он не нужен.)

**Interfaces:**
- Consumes: `prisma` из `lib/db.ts`, `env` из `lib/env.ts`, модели `User`/`Session`/`Account` из Task 3
- Produces:
  - `lib/auth.ts` → `export const auth`
  - `server/auth/session.ts` →
    - `export type SessionUser = { id: string; email: string; name: string; role: 'ADMIN' | 'EDITOR'; isActive: boolean }`
    - `export async function getSessionUser(): Promise<SessionUser | null>`
    - `export async function requireUser(): Promise<SessionUser>` — бросает при отсутствии сессии
    - `export async function requireRole(role: 'ADMIN' | 'EDITOR'): Promise<SessionUser>` — бросает при недостаточной роли
    - `export class AuthError extends Error` с полем `code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INACTIVE'`

- [ ] **Шаг 1: Свериться с документацией better-auth**

Перед написанием конфигурации проверить актуальный API версии 1.7.4 через Context7 (`mcp__plugin_context7_context7__resolve-library-id` → `query-docs`) по темам: Prisma adapter, email and password, session management, rate limiting, additional fields.

Три пункта требуют явной сверки, потому что от них зависит схема БД:

1. **Модель `RateLimit`** — какие имена и типы полей ожидает `rateLimit.storage: 'database'`. В Task 3 заведены `key`, `count`, `lastReset: BigInt`; если документация требует другого — привести схему в соответствие миграцией.
2. **`additionalFields` с типом `string` поверх Prisma-enum `Role`.** Проверить, что адаптер корректно пишет и читает enum-колонку. Если нет — колонку `role` сделать `String` с проверкой значений на уровне приложения, зафиксировав это в отчёте.
3. **Имя пакета next-плагина** — `better-auth/next-js` и экспорт `toNextJsHandler`.

Не писать конфигурацию по памяти: ТЗ п. 14 прямо требует сверяться с документацией фактически установленной версии, а не с устаревшими примерами.

- [ ] **Шаг 2: Написать падающий тест на охрану ролей**

`frontend/tests/auth-guards.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Подменяем источник сессии, чтобы проверять именно логику охраны,
// а не работу HTTP-слоя better-auth.
const mockSession = vi.hoisted(() => ({ value: null as unknown }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: async () => mockSession.value } },
}))

// getSessionUser вызывает headers() ДО обращения к auth. Вне контекста
// запроса Next это исключение, и тест падал бы по причине, не имеющей
// отношения к проверяемой логике охраны ролей.
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

beforeEach(() => {
  mockSession.value = null
})

describe('requireUser', () => {
  it('отклоняет вызов без сессии', async () => {
    const { requireUser, AuthError } = await import('@/server/auth/session')
    await expect(requireUser()).rejects.toBeInstanceOf(AuthError)
    await expect(requireUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('отклоняет сессию отключённого пользователя', async () => {
    mockSession.value = {
      user: { id: 'u1', email: 'a@b.c', name: 'Тест', role: 'ADMIN', isActive: false },
    }
    const { requireUser } = await import('@/server/auth/session')
    await expect(requireUser()).rejects.toMatchObject({ code: 'INACTIVE' })
  })

  it('пропускает активного пользователя', async () => {
    mockSession.value = {
      user: { id: 'u1', email: 'a@b.c', name: 'Тест', role: 'EDITOR', isActive: true },
    }
    const { requireUser } = await import('@/server/auth/session')
    const user = await requireUser()
    expect(user.id).toBe('u1')
  })
})

describe('requireRole', () => {
  it('отклоняет EDITOR там, где требуется ADMIN', async () => {
    mockSession.value = {
      user: { id: 'u1', email: 'a@b.c', name: 'Редактор', role: 'EDITOR', isActive: true },
    }
    const { requireRole } = await import('@/server/auth/session')
    await expect(requireRole('ADMIN')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('пропускает ADMIN там, где требуется EDITOR', async () => {
    mockSession.value = {
      user: { id: 'u1', email: 'a@b.c', name: 'Админ', role: 'ADMIN', isActive: true },
    }
    const { requireRole } = await import('@/server/auth/session')
    const user = await requireRole('EDITOR')
    expect(user.role).toBe('ADMIN')
  })
})
```

Последний тест фиксирует правило: ADMIN имеет доступ ко всему, что доступно EDITOR (ТЗ п. 7).

- [ ] **Шаг 3: Запустить тест и убедиться, что он падает**

```bash
npm test -- tests/auth-guards.test.ts
```

Ожидается FAIL: `Cannot find module '@/server/auth/session'`.

- [ ] **Шаг 4: Реализовать конфигурацию better-auth**

`frontend/lib/auth.ts` (сверить с документацией из шага 1 перед написанием):

```ts
import 'server-only'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { prisma } from './db'
import { env } from './env'

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  emailAndPassword: {
    enabled: true,
    // Публичной регистрации нет: пользователей заводит ADMIN,
    // первого — CLI-команда create-admin.
    disableSignUp: true,
    minPasswordLength: 12,
  },

  session: {
    // Сессии хранятся в таблице Session и проверяются на каждом запросе.
    // JWT не используется: подписанный токен невозможно отозвать,
    // а ТЗ требует, чтобы отключение пользователя прекращало активную сессию.
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  rateLimit: {
    enabled: true,
    storage: 'database',   // не память: она не переживает перезапуск
    window: 60,
    max: 10,
  },

  user: {
    additionalFields: {
      role:     { type: 'string', defaultValue: 'EDITOR', input: false },
      isActive: { type: 'boolean', defaultValue: true,    input: false },
    },
  },

  plugins: [nextCookies()],
})
```

`input: false` у `role` и `isActive` критично: иначе поля можно было бы передать в запросе регистрации или обновления профиля и назначить себе роль ADMIN.

- [ ] **Шаг 5: Создать Route Handler для better-auth**

`frontend/app/api/auth/[...all]/route.ts`:

```ts
import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'

// Node runtime обязателен: драйвер PostgreSQL не работает на Edge.
export const runtime = 'nodejs'

export const { GET, POST } = toNextJsHandler(auth)
```

- [ ] **Шаг 6: Реализовать охрану сессии и ролей**

`frontend/server/auth/session.ts`:

```ts
import 'server-only'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

export type Role = 'ADMIN' | 'EDITOR'

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
  isActive: boolean
}

export class AuthError extends Error {
  constructor(
    public code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INACTIVE',
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  return session.user as SessionUser
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new AuthError('UNAUTHENTICATED', 'Требуется вход в систему')

  // Проверка на КАЖДОМ запросе, а не только при входе:
  // отключение пользователя должно прекращать действующую сессию.
  if (!user.isActive) throw new AuthError('INACTIVE', 'Учётная запись отключена')

  return user
}

export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser()
  // ADMIN имеет доступ ко всему, что доступно EDITOR
  if (role === 'ADMIN' && user.role !== 'ADMIN') {
    throw new AuthError('FORBIDDEN', 'Недостаточно прав')
  }
  return user
}
```

- [ ] **Шаг 7: Запустить тест и убедиться, что он проходит**

```bash
npm test -- tests/auth-guards.test.ts
```

Ожидается PASS всех пяти тестов.

- [ ] **Шаг 8: Применить миграцию, если better-auth требует изменений схемы**

```bash
npx @better-auth/cli generate
```

Сравнить вывод с текущей `schema.prisma`. Если требуются поля, которых нет — добавить их и создать миграцию:

```bash
npx dotenv -e .env -- npx prisma migrate dev --name better_auth_fields
```

Не применять `db push` — только версионированные миграции (ТЗ п. 3).

- [ ] **Шаг 9: Коммит**

```bash
cd ..
git add frontend/lib frontend/server frontend/app frontend/tests frontend/prisma
git commit -m "feat: аутентификация better-auth с сессиями в БД и серверной проверкой ролей"
```

---

## Task 5: Команда создания первого администратора

**Files:**
- Create: `frontend/scripts/create-admin.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: `auth` из `lib/auth.ts`, `prisma` из `lib/db.ts`
- Produces: npm-скрипт `npm run create-admin`

- [ ] **Шаг 1: Реализовать скрипт**

`frontend/scripts/create-admin.ts`:

```ts
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { prisma } from '../lib/db'
import { auth } from '../lib/auth'

// Ввод пароля без эха: символы не попадают ни на экран, ни в историю терминала.
async function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true })
  const onData = (char: Buffer) => {
    const s = char.toString()
    if (s === '\n' || s === '\r' || s === '\u0004') return
    stdout.write('\x1B[2K\x1B[200D' + question)
  }
  stdin.on('data', onData)
  const answer = await rl.question(question)
  stdin.off('data', onData)
  rl.close()
  stdout.write('\n')
  return answer
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout })

  const email = (await rl.question('Email администратора: ')).trim().toLowerCase()
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

  // Пароль хешируется самим better-auth — собственную криптографию
  // ТЗ п. 2 запрещает разрабатывать.
  await auth.api.signUpEmail({ body: { email, password, name } })

  // Роль назначается отдельно: поле помечено input: false и через
  // публичный API его установить нельзя.
  await prisma.user.update({ where: { email }, data: { role: 'ADMIN', isActive: true } })

  console.log(`Администратор ${email} создан`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('Ошибка:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
```

- [ ] **Шаг 2: Добавить npm-скрипт**

В `frontend/package.json`:

```json
{
  "scripts": {
    "create-admin": "dotenv -e .env -- node --conditions=react-server --import tsx scripts/create-admin.ts"
  }
}
```

Флаг `--conditions=react-server` обязателен. Скрипт импортирует `lib/db` → `lib/env`, а те начинаются с `import 'server-only'`. Этот пакет состоит из безусловного `throw` и обезвреживается единственным способом — условием разрешения `react-server`, которое Next.js выставляет при сборке RSC, а обычный Node — нет. Без флага скрипт падает с сообщением про Client Component, не имеющим отношения к настоящей причине.

Проверить, что флаг подействовал, нужно на шаге 3: если скрипт падает с текстом «This module cannot be imported from a Client Component module» — флаг не сработал под `tsx`. Запасной вариант: создать `scripts/stub-server-only.mjs`, регистрирующий подмену модуля, и запускать `node --import ./scripts/stub-server-only.mjs --import tsx …`. О применении запасного варианта сообщить в отчёте.

- [ ] **Шаг 3: Проверить создание администратора вручную**

```bash
cd frontend
npm run create-admin
```

Ввести email, имя и пароль. Убедиться, что **символы пароля не отображаются** при вводе.

- [ ] **Шаг 4: Проверить результат в базе**

```bash
"/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d events \
  -c "SELECT email, role, \"isActive\" FROM \"User\";"
```

Ожидается одна строка с `role = ADMIN` и `isActive = t`.

Затем убедиться, что пароль **не** хранится в открытом виде:

```bash
"/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d events \
  -c "SELECT \"providerId\", left(password, 12) AS hash_prefix FROM \"Account\";"
```

Ожидается хеш, а не введённый пароль.

- [ ] **Шаг 5: Проверить защиту от повторного создания**

```bash
npm run create-admin
```

Ввести тот же email. Ожидается сообщение «Пользователь … уже существует» и код выхода 1.

- [ ] **Шаг 6: Коммит**

```bash
cd ..
git add frontend/scripts frontend/package.json
git commit -m "feat: CLI создания первого администратора со скрытым вводом пароля"
```

---

## Task 6: Страница входа

**Files:**
- Create: `frontend/app/(admin)/admin/login/page.tsx`
- Create: `frontend/lib/auth-client.ts`
- Create: `frontend/Components/auth/LoginForm.tsx`
- Create: `frontend/app/(admin)/admin/layout.tsx`
- Create: `frontend/app/(admin)/admin/page.tsx`

**Interfaces:**
- Consumes: `auth` из `lib/auth.ts`, `getSessionUser` из `server/auth/session.ts`
- Produces: рабочая страница `/admin/login`; `lib/auth-client.ts` → `export const authClient`

- [ ] **Шаг 1: Создать клиент better-auth**

`frontend/lib/auth-client.ts`:

```ts
'use client'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()
```

Секрет сюда не попадает: клиент обращается к `/api/auth/**`, где проверка выполняется на сервере.

- [ ] **Шаг 2: Создать форму входа**

`frontend/Components/auth/LoginForm.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)

    const { error } = await authClient.signIn.email({ email: email.trim().toLowerCase(), password })

    if (error) {
      // Намеренно не уточняем, неверен email или пароль:
      // это позволило бы перебором выяснить, какие адреса зарегистрированы.
      setError('Неверный email или пароль')
      setPending(false)
      return
    }

    router.push('/admin')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Пароль</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-violet-700 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Вход…' : 'Войти'}
      </button>
    </form>
  )
}
```

Поля подписаны через `<label>`, ошибка помечена `role="alert"`, фокус виден — требования доступности из ТЗ п. 8.

- [ ] **Шаг 3: Создать страницу входа**

`frontend/app/(admin)/admin/login/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'
import { LoginForm } from '@/Components/auth/LoginForm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'   // страница входа не кешируется

export const metadata = {
  title: 'Вход в панель управления',
  robots: { index: false, follow: false },
}

export default async function LoginPage() {
  const user = await getSessionUser()
  if (user?.isActive) redirect('/admin')

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-2xl font-bold">Панель управления</h1>
        <LoginForm />
      </div>
    </main>
  )
}
```

- [ ] **Шаг 4: Создать layout админки**

`frontend/app/(admin)/admin/layout.tsx`:

```tsx
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50">{children}</div>
}
```

Layout **не** выполняет проверку доступа. Она живёт в серверных функциях каждого раздела: Server Action публикуется как собственный endpoint и вызывается напрямую, минуя любой layout.

- [ ] **Шаг 4a: Создать минимальную страницу панели**

Без неё успешный вход ведёт на несуществующий `/admin` и проверить результат невозможно. Полноценная панель приходит следующим планом.

`frontend/app/(admin)/admin/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Панель управления',
  robots: { index: false, follow: false },
}

export default async function AdminHomePage() {
  const user = await getSessionUser()

  // Проверка здесь, а не в layout: layout не выполняется при прямом
  // обращении к Server Action, поэтому полагаться на него нельзя.
  if (!user || !user.isActive) redirect('/admin/login')

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">Панель управления</h1>
      <p className="mt-2 text-slate-600">
        {user.name} · {user.email} · роль: {user.role}
      </p>
      <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
        Разделы управления содержимым появятся на следующем этапе.
      </p>
    </main>
  )
}
```

- [ ] **Шаг 5: Проверить вход вручную**

```bash
cd frontend
npm run dev
```

Открыть `http://localhost:3000/admin/login`, войти под созданным администратором. Ожидается переход на `/admin`.

Затем проверить отзыв сессии — ключевое требование ТЗ:

```bash
"/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d events \
  -c "UPDATE \"User\" SET \"isActive\" = false;"
```

Обновить страницу админки. Пользователь должен потерять доступ **без** повторного входа. Вернуть обратно:

```bash
"/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d events \
  -c "UPDATE \"User\" SET \"isActive\" = true;"
```

- [ ] **Шаг 6: Проверить сборку и типы**

```bash
npm run build
npx tsc --noEmit
npm run lint
```

Все три должны пройти без ошибок. Отключать проверки для прохождения сборки запрещено (ТЗ п. 12).

- [ ] **Шаг 7: Коммит**

```bash
cd ..
git add frontend
git commit -m "feat: страница входа в панель управления"
```

---

## Результат плана

По завершении шести задач:

- приложение запускается из `frontend` на Next.js 16 с App Router и Tailwind 4;
- схема CMS применена к реальной базе `events` версионированными миграциями;
- единственность главной страницы обеспечена частичным уникальным индексом и подтверждена тестом;
- вход работает, роли проверяются на сервере, отзыв сессии отключённого пользователя подтверждён вручную;
- первый ADMIN создаётся документированной командой без пароля по умолчанию;
- секретов в репозитории нет.

**Следующий план** (пишется после выполнения этого): CMS — страницы и шаблоны, дерево услуг с защитой от циклов, блог и категории, медиабиблиотека, настройки и меню.
