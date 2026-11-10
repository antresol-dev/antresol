# GrayMatter — План 2: каркас приложения

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устанавливаемое PWA на Nuxt 4. В нём:
- настройки: источники, имя устройства, тема;
- инвентари, загружаемые из источников, с копией на устройстве и режимом только чтения без сети;
- экран папки с мгновенным поиском;
- управление инвентарями и папками.

Всё в стиле E, светлая и тёмная темы, английский интерфейс через i18n.

**Architecture:**
- **Логика приложения** живёт в чистых TypeScript-модулях `packages/app/app/lib/` и тестируется Vitest без Nuxt. Модули:
  - `device-db` — данные на устройстве;
  - `sources` — драйверы источников;
  - `workspace` — состояние и действия;
  - `views` — данные для экранов.
- **Компоненты Vue** тонкие: показывают `views` и вызывают действия `workspace`.
- **В Neon** ходим через HTTP-исполнитель: так решил спайк, см. `docs/superpowers/spikes/2026-11-neon-browser.md`. Снимок инвентаря загружается одним запросом.
- **Для разработки** есть демо-источник на PGlite в браузере (только `nuxt dev`). На нём экраны проверяются без секретов.

**Tech Stack:**
- Node ≥ 24.15, pnpm workspaces.
- Nuxt 4.6 (`ssr: false`, `nuxt generate`).
- Tailwind CSS 4 через `@tailwindcss/vite`.
- shadcn-vue: `shadcn-nuxt`, Reka UI, `lucide-vue-next`.
- Модули Nuxt: `@nuxtjs/color-mode`, `@nuxt/fonts` (Manrope), `@nuxtjs/i18n` 10, `@vite-pwa/nuxt` (+ `@vite-pwa/assets-generator@^1`).
- Данные на устройстве: `idb-keyval`; в тестах `fake-indexeddb`.
- Линтер: ESLint (`@nuxt/eslint` + `@intlify/eslint-plugin-vue-i18n`).
- Тесты: Vitest 5.

Версии — последние стабильные на момент установки, фактические фиксируются в `package.json`.

**Spec:** `docs/superpowers/specs/2026-11-10-graymatter-revival-design.md`

**Предыдущий план:** `docs/superpowers/plans/2026-11-10-graymatter-1-core-storage.md` выполнен. Пакеты `@graymatter/core` и `@graymatter/storage-postgres` готовы, тесты на реальном Neon проходят.

## Последовательность планов

1. Ядро и хранилище (готово).
2. **Каркас приложения** (этот). В нём нет:
   - кнопки «+» быстрого добавления;
   - карточки предмета;
   - фото, архива и справочников.

   Строки предметов в списке пока не нажимаются.
3. **Предметы:** быстрое добавление и кнопка «+», карточка, журнал, варианты, атрибуты, теги, единицы. Экран «Архив» с восстановлением и удалением. Фото: интерфейс файлов в `core` и адаптер Uploadcare (ключ уже хранится в источнике с этого плана).
4. **Выпуск:**
   - GitHub Pages, включая базовый путь и запасную `404.html` для глубоких ссылок;
   - удаление `api/` и `web/`, README, e2e.

## Перед началом

1. **Node ≥ 24.15.** Nuxt 4.6 требует `^22.22.3 || ^24.15.0 || >=26`, а на машине владельца через nvm стоит 24.14.0. Контроллер уже выполнил `nvm install 24 && nvm alias default 24` (откат: `nvm alias default 24.14.0`). Но shell инструментов наследует PATH с 24.14. Поэтому Task 3 закрепляет Node в проекте через `devEngines.runtime`: pnpm сам ставит нужную версию в `node_modules/.bin`, и все скрипты `pnpm …` работают на ней независимо от PATH.
2. **Пакеты** ставятся из публичного реестра через проектный `.npmrc`. pnpm запускается из корня.
3. **Тестовая база Neon есть.** `GM_NEON_TEST_URL` лежит в git-ignored `.env.local` в корне. Тесты на реальном Neon сами пропускаются, если переменной нет.

## Global Constraints

- **Своего сервера нет.** Всё работает в браузере. Node-only API — только в конфигах и тестах.
- **Секреты только на устройстве.** Строка подключения и ключ Uploadcare хранятся только в IndexedDB. Они не попадают в код, URL, логи консоли и тексты ошибок: пароль вырезается. Пользовательский контент не вставляется через `v-html` (правило ESLint `vue/no-v-html`: error).
- **Тексты интерфейса только через i18n**, единственная локаль `en`. Сырой текст в шаблонах запрещён (`@intlify/vue-i18n/no-raw-text`: error), отсутствующие ключи тоже (`no-missing-keys`: error). Это относится и к скопированным компонентам shadcn-vue, включая скрытые подписи `sr-only`.
- **Не клиент базы данных.** В интерфейсе слова «source» и «inventory». Слова «database», «schema», «table» допустимы только в подсказке к полю строки подключения и в сообщении о несовместимой базе.
- **Основной драйвер Neon — HTTP** (`createNeonHttpExecutor`). WebSocket в приложении не используется.
- **Без оптимистичных обновлений.** Запись идёт сразу в источник. Пока она идёт, интерфейс показывает сохранение. После подтверждения снимок перезагружается.
- **Стиль E** — значения ниже, они точные:

  | Роль | Светлая | Тёмная |
  |---|---|---|
  | фон | `#F7F7F8` | `#0E0E10` |
  | поверхность | `#FFFFFF` | `#18181B` |
  | рамка | `#EDEDF0` | `#27272A` |
  | разделитель | `#F0F0F2` | `#222225` |
  | текст | `#18181B` | `#F4F4F5` |
  | вторичный текст на поверхности | `#71717A` | `#A1A1AA` |
  | вторичный текст на фоне | `#63636B` | `#A1A1AA` |
  | чип пути | `#ECECEF` | `#232327` |
  | акцент | `#4F46E5` | `#818CF8` |
  | текст на акценте | `#FFFFFF` | `#0E0E10` |
  | мягкая подложка акцента | `#EEF2FF` | `#1E1B4B` |
  | акцент на подложке | `#4F46E5` | `#A5B4FC` |
  | подложка миниатюры | `#F4F4F5` | `#232327` |
  | иконка миниатюры | `#A1A1AA` | `#71717A` |
  | приглушённое имя «нет в наличии» | `#52525B` | `#D4D4D8` |
  | иконка кнопки | `#3F3F46` | `#D4D4D8` |
  | ошибка | `#DC2626` | `#F87171` |
  | зарезервирован под «мало» | `#B45309` | `#FBBF24` |

  Тёмная палитра — **[решение Claude]**: спека отдаёт её исполнителю, но фиксирует контраст текста ≥ 4.5:1.
- **Размеры:**
  - шрифт Manrope 400/500/600/700;
  - скругления: поля 14, карточки 16, миниатюры 12, иконка папки 10, плавающая кнопка 18;
  - строки: папки 50 px, предметы 62 px;
  - зоны нажатия ≥ 44 px;
  - заголовок 24 px, жирный, letter-spacing −0.02em;
  - отступы экрана `10px 16px`, вертикальный шаг 14 px.
- **Ширина.** На 360 px нет горизонтальной прокрутки. От 1024 px — боковая панель с деревом папок.
- **Окружение:**
  - `api/` и `web/` не трогаем;
  - глобальный конфиг npm не меняем;
  - коммиты без трейлеров `Claude-Session` и `Co-Authored-By`.
- **Проверки:** `pnpm test`, `pnpm typecheck`, `pnpm lint` зелёные после каждой задачи начиная с Task 3.

## Review Focus

1. **Нет сети при запуске или пропала посреди работы.**
   - Ожидание: открывается копия с устройства, баннер «только чтение» со временем копии, запись отклоняется без обращения к источнику, при появлении сети данные обновляются.
   - Тесты в Task 6.
2. **Сменился пароль Neon** (телефон потерян, спека, риск 4) **или строка подключения неверна.**
   - Ожидание: источник в статусе ошибки с понятной причиной, остальные источники работают, копия видна только для чтения. Строку можно заменить, не теряя текущий инвентарь.
   - Тесты в Task 5 и Task 6.
3. **Инвентарь или папку архивировали или удалили на другом устройстве.**
   - Ожидание: приложение не падает. Текущий инвентарь переключается на другой. Открытая папка показывает «не найдена» со ссылкой в корень.
   - Тесты в Task 6 и Task 8.
4. **База не от GrayMatter или от более новой версии приложения.**
   - Ожидание: чужая база не изменяется ни одним запросом, добавить её нельзя, понятное объяснение. Более новая схема даёт только чтение с просьбой обновить приложение.
   - Тесты в Task 1 и Task 6.
5. **Длинные, кириллические и эмодзи-имена, глубокие пути на 360 px.**
   - Ожидание: имена обрезаются многоточием, путь сворачивается, горизонтальной прокрутки нет.
   - Тест `collapseCrumbs` и ручная проверка в Task 8.

---

## Структура файлов

```
.nvmrc                                   24
package.json                             + engines, скрипты dev/build/lint
packages/core/src/storage.ts             + STORAGE_ERROR_CODES, SchemaInspection
packages/core/src/validate.ts            + DOMAIN_ERROR_CODES
packages/core/src/units.ts               + formatAmountParts
packages/storage-postgres/src/
  inspect.ts                             inspectSchema
  executor.ts                            + readBatch
  executors/errors.ts                    распознавание сетевых ошибок
  executors/{pglite,neon-http,neon-ws}.ts + readBatch, сетевые ошибки → StorageError('unavailable')
  queries.ts                             loadInventory одним readBatch, not_found
  storage.ts                             проверка схемы до записи, обёртка ошибок чтения
packages/app/
  package.json, nuxt.config.ts, vitest.config.ts, eslint.config.mjs, components.json, pwa-assets.config.ts
  i18n/locales/en.json
  public/favicon.svg
  app/app.vue
  app/assets/css/main.css                токены тем, Tailwind
  app/layouts/default.vue                оболочка: колонка на телефоне, боковая панель на компьютере
  app/plugins/workspace.client.ts        создаёт workspace, обновление по сети и видимости
  app/composables/useWorkspace.ts
  app/middleware/onboarding.global.ts    без источников → /welcome
  app/pages/index.vue                    корень текущего инвентаря
  app/pages/folder/[id].vue
  app/pages/welcome.vue
  app/pages/settings/index.vue
  app/pages/settings/sources/new.vue
  app/pages/settings/sources/[id].vue
  app/components/ui/…                    копии shadcn-vue
  app/components/…                       компоненты приложения (имена в задачах)
  app/lib/types.ts                       InventoryRef и общие типы
  app/lib/device-db.ts
  app/lib/device-name.ts
  app/lib/sources.ts
  app/lib/dev/demo-source.ts             PGlite-источник и демо-данные (только dev)
  app/lib/workspace.ts
  app/lib/errors.ts
  app/lib/views.ts
  app/lib/currencies.ts
  test/*.test.ts
```

---

### Task 1: Хранилище — проверка схемы и типизированные ошибки

**Files:**
- Modify: `packages/core/src/storage.ts`, `packages/core/src/validate.ts`, `packages/core/src/index.ts`
- Create: `packages/storage-postgres/src/inspect.ts`, `packages/storage-postgres/src/executors/errors.ts`
- Modify: `packages/storage-postgres/src/storage.ts`, `src/queries.ts`, `src/executors/neon-http.ts`, `src/executors/neon-ws.ts`, `src/index.ts`
- Test: `packages/core/test/codes.test.ts`, `packages/storage-postgres/test/inspect.test.ts`, `test/read-errors.test.ts`, `test/neon-http-errors.test.ts`

**Interfaces:**
- Produces (core):
  ```ts
  export const STORAGE_ERROR_CODES = ['read_only', 'unavailable', 'not_found', 'incompatible', 'failed'] as const
  export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number]
  export const DOMAIN_ERROR_CODES = [/* те же 14 кодов, что сейчас в union DomainErrorCode, в том же порядке */] as const
  export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]
  export type SchemaInspection =
    | { state: 'empty' }
    | { state: 'foreign' }
    | { state: 'current' | 'older' | 'newer'; dbVersion: number; appVersion: number }
  ```
- Produces (storage-postgres):
  - `inspectSchema(exec: PgExecutor): Promise<SchemaInspection>`. Ничего не пишет.
  - `openPostgresStorage(exec)`: сигнатура прежняя. Перед любой записью вызывает `inspectSchema`. На `foreign` отклоняется с `StorageError('incompatible')`, ничего не создав. На `empty` и `older` применяет миграции, как раньше.
  - Чтения (`listInventories`, `loadInventory`, `loadMovements`):
    - пропускают `StorageError` как есть;
    - любую другую ошибку оборачивают в `StorageError('failed')` с `cause`;
    - `loadInventory` несуществующего id → `StorageError('not_found')`.
  - Исполнители Neon сами превращают сетевые сбои в `StorageError('unavailable')`. Ошибки SQL пробрасывают как есть.
    - HTTP: `TypeError`, или `NeonDbError`, у которого `sourceError` — `TypeError`.
    - WS: любая ошибка `pool.connect()`.

Правила `inspectSchema`. Один запрос:
```sql
select (select count(*) from information_schema.tables where table_schema = 'public')::int as tables,
       (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'gm_meta')::int as meta
```
- `tables = 0` → `empty`;
- `meta = 0` → `foreign`;
- иначе версия из `gm_meta`, нет строки — это 0:
  - меньше `APP_SCHEMA_VERSION` → `older`;
  - равна → `current`;
  - больше → `newer`.

- [ ] **Step 1: Write the failing tests**
  - `codes.test.ts`:
    - `DOMAIN_ERROR_CODES` содержит ровно 14 кодов, включая `'folder_cycle'` и `'unit_in_use'`;
    - `STORAGE_ERROR_CODES` равен массиву из Interfaces.
  - `inspect.test.ts`, PGlite:
    - новая база → `{ state: 'empty' }`;
    - после `openPostgresStorage` → `{ state: 'current', dbVersion: APP_SCHEMA_VERSION, appVersion: APP_SCHEMA_VERSION }`;
    - после `update gm_meta set value = '<APP+1>'` → `newer` с `dbVersion: APP_SCHEMA_VERSION + 1`;
    - после `update gm_meta set value = '0'` → `older` с `dbVersion: 0`;
    - база с одной `create table customers (id int)` → `foreign`;
    - `openPostgresStorage` на такой базе отклоняется с `code === 'incompatible'`, и после этого `gm_meta` не существует.
  - `read-errors.test.ts`:
    - `loadInventory(newId())` → `StorageError` с `code === 'not_found'`;
    - исполнитель-обёртка, у которого `query` после открытия бросает `new Error('boom')`: `listInventories()` → `StorageError`, `code === 'failed'`, `cause.message === 'boom'`.
  - `neon-http-errors.test.ts`:
    - подменить `neonConfig.fetchFunction = async () => { throw new TypeError('Failed to fetch') }` (в `afterEach` вернуть прежнее значение);
    - `createNeonHttpExecutor('postgresql://u:secret@ep-x.eu-central-1.aws.neon.tech/db_test')`: и `query(sql\`select 1\`)`, и `batch([...])` отклоняются со `StorageError`, `code === 'unavailable'`, а `message` не содержит `secret`;
    - `fetchFunction`, отвечающий `new Response(JSON.stringify({ message: 'syntax error', code: '42601' }), { status: 400 })`: отклонение **не** `StorageError`.
- [ ] **Step 2: Run** `pnpm test`. Expected: новые тесты FAIL (нет экспортов и кодов), остальные зелёные.
- [ ] **Step 3: Implement** по Interfaces. Тип union `DomainErrorCode` заменяется производным от массива, существующий код не меняется.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: всё зелёное, тесты на Neon проходят при наличии `.env.local`.
- [ ] **Step 5: Commit** — `feat(storage-postgres): inspect schema before writing, typed read and network errors`

### Task 2: Снимок инвентаря одним запросом

**Files:**
- Modify: `packages/storage-postgres/src/executor.ts`, `src/executors/{pglite,neon-http,neon-ws}.ts`, `src/queries.ts`
- Test: `packages/storage-postgres/test/read-batch.test.ts`, `test/neon.conformance.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface PgExecutor {
    // …как было
    /** Read-only statements in one REPEATABLE READ READ ONLY transaction; rows of each statement, in order. One round trip on Neon HTTP. */
    readBatch(statements: Statement[]): Promise<Record<string, unknown>[][]>
  }
  ```
  - PGlite: внутри `db.transaction` первым выражением идёт `set transaction isolation level repeatable read, read only`.
  - HTTP: `sql.transaction(queries, { isolationLevel: 'RepeatableRead', readOnly: true })`.
  - WS: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` … `COMMIT` на одном клиенте.
- `loadInventory` выполняет свои 11 выражений одним `readBatch`.
- `readBatch` в исполнителях Neon превращает сетевые сбои в `StorageError('unavailable')` по тем же правилам, что `query` и `batch` из Task 1.

- [ ] **Step 1: Write the failing tests**
  - `read-batch.test.ts` (PGlite):
    - `readBatch([sql\`select 1 as a\`, sql\`select 2 as b\`])` → `[[{ a: 1 }], [{ b: 2 }]]`;
    - `readBatch([sql\`insert into gm_meta (key, value) values ('x', 'y')\`])` отклоняется, и строки `x` в `gm_meta` нет.
  - В `neon.conformance.test.ts` для HTTP-сценария:
    - обернуть `neonConfig.fetchFunction` счётчиком, который вызывает настоящий `fetch`;
    - `loadInventory` созданного инвентаря делает **ровно 1** вызов `fetch`;
    - `inspectSchema` возвращает `current`.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL (`readBatch` нет).
- [ ] **Step 3: Implement** `readBatch` в трёх исполнителях и перевести `loadInventory` на него.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: всё зелёное, включая тесты на Neon.
- [ ] **Step 5: Commit** — `perf(storage-postgres): load an inventory snapshot in one read-only transaction`

### Task 3: Каркас Nuxt — стиль, темы, шрифт, i18n, линтер

**Files:**
- Create: `.nvmrc` (`24`)
- Modify: корневой `package.json`:
  - `"engines": { "node": ">=24.15" }`;
  - `"devEngines": { "runtime": { "name": "node", "version": "^24.15.0", "onFail": "download" } }`: pnpm ставит Node этой версии в `node_modules/.bin`, скрипты не зависят от PATH;
  - скрипты `dev` = `pnpm --filter @graymatter/app dev`, `build` = `pnpm --filter @graymatter/app generate`, `lint` = `pnpm -r lint`.
- Create: `packages/app/{package.json,nuxt.config.ts,vitest.config.ts,eslint.config.mjs,components.json}`
- Create: `packages/app/i18n/locales/en.json`, `app/app.vue`, `app/layouts/default.vue`, `app/pages/index.vue` (временная страница), `app/assets/css/main.css`
- Create: `app/components/ui/*` через CLI `shadcn-vue`: `button`, `input`, `label`, `dialog`, `dropdown-menu`, `radio-group`, `select`, `combobox`, `sonner`, `skeleton`
- Test: `packages/app/test/theme.test.ts`

**Interfaces:**
- `@graymatter/app`: `private`, `"type": "module"`. Скрипты:
  - `dev` = `nuxt dev`;
  - `generate` = `nuxt generate`;
  - `postinstall` = `nuxt prepare`;
  - `typecheck` = `nuxt typecheck`;
  - `lint` = `eslint .`.

  Зависимости: `nuxt`, `vue`, модули Nuxt из Tech Stack, `tailwindcss`, `@tailwindcss/vite`, зависимости shadcn-vue (`reka-ui`, `lucide-vue-next`, `class-variance-authority`, `clsx`, `tailwind-merge`, `vue-sonner` — что попросит CLI), `@graymatter/core` и `@graymatter/storage-postgres` (`workspace:*`), `@neondatabase/serverless`, `idb-keyval`. Devdeps: `typescript`, `vue-tsc`, `eslint`, `@nuxt/eslint`, `@intlify/eslint-plugin-vue-i18n`, `@electric-sql/pglite`, `fake-indexeddb`.
- `nuxt.config.ts`:
  - `ssr: false`;
  - modules `@nuxtjs/color-mode`, `@nuxt/fonts`, `@nuxtjs/i18n`, `shadcn-nuxt`;
  - `vite.plugins: [tailwindcss()]`, `css: ['~/assets/css/main.css']`;
  - `colorMode: { classSuffix: '', preference: 'system', fallback: 'light', storageKey: 'gm-color-mode' }`;
  - `fonts: { families: [{ name: 'Manrope', provider: 'google', weights: [400, 500, 600, 700] }] }`;
  - `i18n: { defaultLocale: 'en', strategy: 'no_prefix', locales: [{ code: 'en', file: 'en.json' }] }`;
  - `shadcn: { prefix: '', componentDir: './app/components/ui' }`;
  - `vite.optimizeDeps.exclude: ['@electric-sql/pglite']`;
  - `app.head.title = 'GrayMatter'`: это имя продукта, оно не переводится.
- `main.css`:
  - `@import "tailwindcss"` и `@custom-variant dark (&:where(.dark, .dark *))`;
  - токены из таблицы Global Constraints как CSS-переменные в `:root` (светлая) и `.dark` (тёмная). Имена: `--background`, `--surface`, `--border`, `--divider`, `--foreground`, `--muted-foreground`, `--subtle-foreground` (вторичный на фоне), `--chip`, `--primary`, `--primary-foreground`, `--accent-soft`, `--accent-soft-foreground`, `--thumb`, `--thumb-foreground`, `--dimmed-foreground`, `--icon`, `--destructive`, `--warning`;
  - переменные shadcn-vue сводятся к ним: `--card`/`--popover` = `--surface`, `--secondary` = `--chip`, `--muted` = `--thumb`, `--accent` = `--accent-soft`, `--input` = `--border`, `--ring` = `--primary`;
  - `@theme inline` даёт классы Tailwind (`bg-surface`, `text-subtle-foreground`, …) и радиусы `--radius-field: 14px`, `--radius-card: 16px`, `--radius-thumb: 12px`, `--radius-icon: 10px`, `--radius-fab: 18px`;
  - `body`: фон `--background`, шрифт `'Manrope', system-ui, sans-serif`.
- `eslint.config.mjs`:
  - `withNuxt()` плюс `@intlify/eslint-plugin-vue-i18n`;
  - правила `@intlify/vue-i18n/no-raw-text: ['error', { ignorePattern: '^[\\s·…/—–:+-]+$' }]`, `@intlify/vue-i18n/no-missing-keys: 'error'`, `vue/no-v-html: 'error'`;
  - `settings['vue-i18n'].localeDir = './i18n/locales/*.json'`.

  Сырые подписи в скопированных компонентах UI (например `sr-only` «Close») переводятся на ключи `ui.*`.
- `vitest.config.ts` (app): `name: '@graymatter/app'`, `environment: 'node'`, `include: ['test/**/*.test.ts']`, `setupFiles: ['fake-indexeddb/auto']`.
- Временная `index.vue` показывает `t('app.name')`. Task 7 добавит в неё имя текущего инвентаря, а Task 8 заменит её экраном папки.

- [ ] **Step 1: Write the failing test** — `theme.test.ts`.
  - `import css from '../app/assets/css/main.css?raw'`. Разобрать переменные `:root` и `.dark` регуляркой `--([\w-]+):\s*(#[0-9a-fA-F]{6})`.
  - Посчитать контраст WCAG: относительная яркость sRGB, `(L1 + 0.05) / (L2 + 0.05)`.
  - Для **каждой** темы проверить ≥ 4.5 у пар:
    - `foreground`/`background`, `foreground`/`surface`;
    - `muted-foreground`/`surface`;
    - `subtle-foreground`/`background`, `subtle-foreground`/`chip`;
    - `primary-foreground`/`primary`;
    - `accent-soft-foreground`/`accent-soft`;
    - `dimmed-foreground`/`surface`;
    - `destructive`/`surface`.
  - Отдельно проверить точные светлые значения из спеки: `background` = `#F7F7F8`, `border` = `#EDEDF0`, `primary` = `#4F46E5`.
- [ ] **Step 2: Run** `pnpm install && pnpm test`. Expected: FAIL (нет пакета или файла).
- [ ] **Step 3: Создать пакет** по Interfaces: `pnpm dlx nuxi@latest init` не используется, файлы пишутся вручную. Компоненты shadcn-vue добавить через `pnpm dlx shadcn-vue@latest add …` из `packages/app`. Ключи `en.json`: `app.name` = `GrayMatter` и `ui.*` для подписей компонентов.
- [ ] **Step 4: Run**
  ```
  pnpm install && pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @graymatter/app generate
  ```
  Expected: всё зелёное, `packages/app/.output/public/index.html` существует.
- [ ] **Step 5: Проверить в браузере.** `pnpm dev`, открыть `http://localhost:3000`. Заголовок набран Manrope, фон `#F7F7F8`. При эмуляции `prefers-color-scheme: dark` фон `#0E0E10`. Снимки экрана обеих тем приложить к отчёту.
- [ ] **Step 6: Commit** — `feat(app): scaffold Nuxt SPA with theme tokens, Manrope, i18n and lint`

### Task 4: PWA

**Files:**
- Modify: `packages/app/nuxt.config.ts`, `packages/app/package.json`
- Create: `packages/app/public/favicon.svg`, `packages/app/pwa-assets.config.ts`

**Interfaces:**
- Модуль `@vite-pwa/nuxt`, devdep `@vite-pwa/assets-generator@^1`. Конфигурация:
  - `pwaAssets: { config: true }`, `pwa-assets.config.ts` с `preset: minimal2023Preset`, `images: ['public/favicon.svg']`;
  - `registerType: 'autoUpdate'`;
  - `manifest: { name: 'GrayMatter', short_name: 'GrayMatter', description: 'Personal inventory of anything', display: 'standalone', background_color: '#F7F7F8', theme_color: '#F7F7F8', start_url: '.', scope: '.' }`;
  - `workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'], navigateFallback: '/' }`;
  - `devOptions.enabled: false`.
- `favicon.svg`:
  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="112" fill="#4F46E5"/>
    <g fill="#FFFFFF">
      <rect x="120" y="120" width="120" height="120" rx="28"/><rect x="272" y="120" width="120" height="120" rx="28"/>
      <rect x="120" y="272" width="120" height="120" rx="28"/><rect x="272" y="272" width="120" height="120" rx="28" opacity=".55"/>
    </g>
  </svg>
  ```

- [ ] **Step 1: Run** `pnpm --filter @graymatter/app generate`. Expected: в `.output/public` нет `manifest.webmanifest` и `sw.js`. Это проверка «до».
- [ ] **Step 2: Implement** по Interfaces.
- [ ] **Step 3: Run** ту же сборку и проверку:
  ```
  pnpm --filter @graymatter/app generate && node -e "const m=JSON.parse(require('fs').readFileSync('./packages/app/.output/public/manifest.webmanifest','utf8'));if(m.name!=='GrayMatter'||!m.icons.some(i=>i.sizes==='512x512'))process.exit(1)" && test -f packages/app/.output/public/sw.js
  ```
  Expected: exit 0.
- [ ] **Step 4: Проверить в браузере.**
  1. `pnpm dlx serve packages/app/.output/public -l 4173`, открыть `http://localhost:4173`.
  2. DevTools → Application: манифест без ошибок установки, service worker активен.
  3. Включить Offline, перезагрузить: страница открывается.
- [ ] **Step 5: Commit** — `feat(app): installable PWA with offline app shell`

### Task 5: Устройство и источники

**Files:**
- Create: `packages/app/app/lib/{types,device-db,device-name,sources}.ts`, `app/lib/dev/demo-source.ts`
- Test: `packages/app/test/{device-db,device-name,sources,demo-source}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface InventoryRef { sourceId: string; inventoryId: Id }
  export type SourceKind = 'neon' | 'dev-pglite'
  export interface SourceConfig { id: string; kind: SourceKind; name: string; connectionString: string; uploadcarePublicKey: string | null; createdAt: string }

  // device-db.ts
  export interface DeviceSettings { deviceName: string | null; current: InventoryRef | null }
  export interface CachedSnapshot { snapshot: InventorySnapshot; savedAt: string }
  export interface DeviceDb {
    readonly persistent: boolean
    getSources(): Promise<SourceConfig[]>
    putSource(s: SourceConfig): Promise<void>          // insert or replace by id
    deleteSource(id: string): Promise<void>            // also deletes this source's cached snapshots
    getSettings(): Promise<DeviceSettings>             // defaults: { deviceName: null, current: null }
    putSettings(patch: Partial<DeviceSettings>): Promise<void>
    getSnapshot(ref: InventoryRef): Promise<CachedSnapshot | null>
    putSnapshot(ref: InventoryRef, value: CachedSnapshot): Promise<void>
    deleteSnapshot(ref: InventoryRef): Promise<void>
  }
  /** IndexedDB (idb-keyval store 'graymatter'/'kv'); calls navigator.storage.persist() best-effort; falls back to memory (persistent=false) when IndexedDB is missing or the probe write fails. */
  export function openDeviceDb(): Promise<DeviceDb>
  export function createMemoryDeviceDb(): DeviceDb

  // device-name.ts
  export function defaultDeviceName(userAgent: string): string

  // sources.ts
  export type ConnectionStringProblem = 'empty' | 'not_postgres_url' | 'missing_password' | 'missing_database'
  export function checkConnectionString(input: string): ConnectionStringProblem | null
  export const PROBE_FAILURES = ['unreachable', 'auth', 'no_database', 'failed'] as const
  export type ProbeFailure = (typeof PROBE_FAILURES)[number]
  export type SourceProbe = { ok: true; inspection: SchemaInspection } | { ok: false; reason: ProbeFailure; message: string }
  export interface SourceConnection { storage: InventoryStorage; status: SchemaStatus; close(): Promise<void> }
  export interface SourceDriver {
    /** Read-only: inspects the schema, never writes. */
    probe(config: SourceConfig): Promise<SourceProbe>
    /** openPostgresStorage: creates or upgrades the schema; rejects StorageError('incompatible') for a foreign database. */
    connect(config: SourceConfig): Promise<SourceConnection>
  }
  export function createNeonDriver(makeExecutor?: (connectionString: string) => PgExecutor): SourceDriver   // default createNeonHttpExecutor
  export function redactSecret(message: string, connectionString: string): string                            // replaces the password with '***'

  // dev/demo-source.ts
  /** Dev only: PGlite in the browser (idb://graymatter-dev-<sourceId>) or in memory when memory=true; seeds demo data on an empty database. */
  export function createDemoDriver(options?: { memory?: boolean }): SourceDriver
  export async function seedDemo(storage: InventoryStorage, actor: Actor): Promise<void>
  ```
- Ключи в IndexedDB:
  - `sources` → `SourceConfig[]`;
  - `settings` → `DeviceSettings`;
  - `snapshot:<sourceId>:<inventoryId>` → `CachedSnapshot`.
- Причины в `probe`:
  - `StorageError('unavailable')` → `unreachable`;
  - ошибка с `code === '28P01'` → `auth`;
  - `code === '3D000'` → `no_database`;
  - остальное → `failed`.

  `message` всегда проходит через `redactSecret`.
- `defaultDeviceName` → `«<ОС> · <браузер>»`.
  - ОС проверяется по порядку: Android, iOS (iPhone/iPad), Windows, macOS, Linux.
  - Браузер проверяется по порядку: Edge (`Edg/`), Samsung Internet, Chrome, Firefox, Safari.
  - Ничего не узнано → `Browser`.
- `seedDemo` создаёт:
  - инвентарь **Electronics (USD)**:
    - папки «ICs» → «Op-amps», «Passive components» → «Resistors», а также пустая папка «Очень длинное название папки для проверки обрезки на узком экране 🧪»;
    - предметы:
      - TL072 в «Op-amps», получение 37 шт. на сумму 230;
      - LM13700 в «ICs», 6 шт.;
      - NE555 в «ICs»: получение 5, затем использование 5, остаток 0;
      - «Резистор 0,25 Вт» в «Resistors» с вариантами `1k, 10k, 100k`, у варианта 10k получение 100;
  - второй инвентарь **Workshop (EUR)** без папок.

- [ ] **Step 1: Write the failing tests**
  - `device-db.test.ts` (fake-indexeddb):
    - `putSource` → `getSources` возвращает источник;
    - `putSnapshot` для двух источников, затем `deleteSource(a)` удаляет только снимки `a`;
    - `putSettings({ deviceName: 'X' })` не стирает `current`;
    - при `globalThis.indexedDB = undefined` `openDeviceDb()` возвращает `persistent === false`, и запись и чтение работают в памяти.
  - `device-name.test.ts`:
    - UA Android Chrome → `Android · Chrome`;
    - macOS Chrome → `macOS · Chrome`;
    - Windows Edge → `Windows · Edge`;
    - iPhone Safari → `iOS · Safari`;
    - Samsung → `Android · Samsung Internet`;
    - `''` → `Browser`.
  - `sources.test.ts`:
    - `checkConnectionString`: `''` → `empty`; `'https://x'` → `not_postgres_url`; `'postgresql://u@h/db'` → `missing_password`; `'postgresql://u:p@h'` → `missing_database`; `'postgresql://u:p@h/db?sslmode=require'` → `null`;
    - `createNeonDriver(() => pgliteExec)` на пустой базе: `probe` → `{ ok: true, inspection: { state: 'empty' } }` и база осталась пустой; `connect` → `status.state === 'ready'`; повторный `probe` → `current`;
    - чужая база → `connect` отклоняется с `incompatible`;
    - исполнитель, бросающий `StorageError('unavailable')` → `probe` даёт `{ ok: false, reason: 'unreachable' }`;
    - исполнитель, бросающий `Object.assign(new Error('password authentication failed for user "u" (secret)'), { code: '28P01' })` при строке с паролем `secret` → `reason: 'auth'`, и в `message` нет `secret`.
  - `demo-source.test.ts`: `createDemoDriver({ memory: true }).connect(cfg)`, затем `listInventories()` → имена `['Electronics', 'Workshop']`. В снимке Electronics остаток TL072 равен `'37'`, NE555 — `'0'`.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** по Interfaces. Демо-драйвер импортирует `@electric-sql/pglite` динамически, внутри функции. Подключение в приложении делает Task 7, только под `import.meta.dev`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: зелёное.
- [ ] **Step 5: Commit** — `feat(app): device storage, source drivers and dev demo source`

### Task 6: Workspace — состояние и действия

**Files:**
- Create: `packages/app/app/lib/workspace.ts`
- Test: `packages/app/test/workspace.test.ts`

**Interfaces:**
- Consumes: Task 5 (`DeviceDb`, `SourceDriver`, `SourceConfig`, `InventoryRef`, `defaultDeviceName`); core `validateCommand`, `normalizeCommand`, `newId`, `DomainError`, `StorageError`.
- Produces:
  ```ts
  export interface InventoryEntry { ref: InventoryRef; inventory: Inventory; sourceName: string }
  export type SourceStatus = 'connecting' | 'ready' | 'read_only' | 'unreachable' | 'error'
  export interface SourceState { config: SourceConfig; status: SourceStatus; error: string | null }   // error is already redacted
  export type ReadOnlyReason = 'offline' | 'schema_newer' | 'source_error'
  export interface WorkspaceState {
    started: boolean
    persistent: boolean
    deviceName: string
    sources: SourceState[]
    inventories: InventoryEntry[]          // active only, sorted by name (localeCompare, numeric, base)
    current: InventoryRef | null
    snapshot: InventorySnapshot | null
    snapshotOrigin: 'cache' | 'live' | null
    snapshotSavedAt: string | null         // ISO time the shown data was loaded from the source
    lastRefreshAt: string | null           // last fully successful refresh
    refreshing: boolean
    saving: boolean
    readOnly: ReadOnlyReason | null
  }
  export interface WorkspaceDeps { db: DeviceDb; drivers: Partial<Record<SourceKind, SourceDriver>>; userAgent: string; now?: () => Date }
  export interface Workspace {
    readonly state: Readonly<WorkspaceState>          // Vue reactive()
    startFromCache(): Promise<void>                   // device data + cached snapshot of `current`; no network
    refresh(): Promise<void>                          // connect sources, list inventories, load current snapshot
    refreshIfStale(maxAgeMs: number): Promise<void>
    start(): Promise<void>                            // startFromCache() then refresh()
    selectInventory(ref: InventoryRef): Promise<void> // cached copy first, then live
    apply(command: Command): Promise<void>            // throws DomainError | StorageError; serialized
    createInventory(input: { sourceId: string; name: string; currency: string }): Promise<InventoryRef>
    addSource(input: Omit<SourceConfig, 'id' | 'createdAt'>): Promise<SourceConfig>
    updateSource(id: string, patch: Partial<Pick<SourceConfig, 'name' | 'connectionString' | 'uploadcarePublicKey'>>): Promise<void>
    removeSource(id: string): Promise<void>
    setDeviceName(name: string): Promise<void>
  }
  export function createWorkspace(deps: WorkspaceDeps): Workspace
  ```
- Правила:
  - **Подключения.** Каждый источник подключается при `refresh` и кешируется. `close()` вызывается при удалении или замене источника.
  - **Статус источника** по результату `connect` и `listInventories`:
    - `status.state === 'newer'` → `read_only`;
    - `StorageError('unavailable')` → `unreachable`;
    - любая другая ошибка → `error` с текстом, прошедшим `redactSecret`.
  - **Только чтение.** `readOnly` вычисляется из статуса источника текущего инвентаря:
    - `unreachable` → `offline`;
    - `read_only` → `schema_newer`;
    - `error` → `source_error`;
    - иначе `null`.
  - **Текущий инвентарь.** Если после `refresh` текущего инвентаря нет среди активных (удалён или заархивирован), а его источник ответил, то кеш снимка удаляется, `current` становится первым инвентарём списка или `null`, и загружается его снимок. Если источник не ответил, `current` и копия остаются.
  - **Нет текущего.** Если `current` нет, а инвентари есть, выбирается первый.
  - **`apply`:**
    - при `readOnly` → `StorageError('read_only')` без вызова хранилища;
    - иначе `validateCommand(normalizeCommand(c), snapshot)` → бросить `DomainError`;
    - иначе `storage.apply(c, { device: deviceName })`;
    - затем `loadInventory` текущего: `snapshotOrigin = 'live'`, кеш обновлён;
    - для команд `inventory.*` и `archive`/`restore` с `target: 'inventory'` ещё и перечитать список.

    `saving === true` от начала до конца. Параллельные вызовы выполняются по очереди в порядке вызова.
  - **`createInventory`:** `inventory.create` с `newId()`, затем `selectInventory` нового.
  - **`addSource`:** `connect` до сохранения. При ошибке ничего не сохраняется, и ошибка пробрасывается.
  - **`updateSource`:** сохраняет `id`, переподключается. Текущий инвентарь сохраняется.
  - **`removeSource`:** удаляет конфиг и кеши, сбрасывает `current`, если он был в этом источнике.
  - **`deviceName`** — сохранённое имя или `defaultDeviceName(userAgent)`.

- [ ] **Step 1: Write the failing tests** — `workspace.test.ts`.

  Обвязка:
  - `createMemoryDeviceDb()`;
  - драйвер `neon` = `createNeonDriver(cs => execs.get(cs) ?? authFailingExecutor)` поверх отдельных PGlite на каждую строку подключения. Строка, которой нет в карте, получает исполнитель, бросающий `Object.assign(new Error('password authentication failed'), { code: '28P01' })`;
  - `offline` — флаг, при котором исполнитель-обёртка бросает `StorageError('unavailable')`.

  Тесты, каждый отдельным `it`:
  1. Без источников: после `start()` `started === true`, `inventories` пусты, `current === null`, `readOnly === null`.
  2. Два источника по одному инвентарю (`B-inv`, `A-inv`) → `inventories` по имени `['A-inv', 'B-inv']`, `current` указывает на `A-inv`, `snapshotOrigin === 'live'`.
  3. Сохранённый `current` и кеш, источник офлайн: после `startFromCache()` снимок из кеша (`snapshotOrigin === 'cache'`). После `refresh()`: `readOnly === 'offline'`, снимок прежний. `apply(folder.create …)` → `StorageError` с `code === 'read_only'`, и в базе папки нет.
  4. Снова онлайн, `refresh()` → `readOnly === null`, `snapshotOrigin === 'live'`.
  5. Текущий инвентарь заархивирован «с другого устройства» прямым `storage.apply(archive)` в обход workspace. `refresh()` переключает `current` на оставшийся, а кеш старого удалён (`db.getSnapshot(old) === null`).
  6. `update gm_meta set value = '<APP+1>'`, затем `refresh()` → `readOnly === 'schema_newer'`.
  7. `apply` с пустым именем папки → `DomainError` с `code === 'name_required'`, в базе ничего. `apply` корректной папки → папка есть в `state.snapshot.folders`, у кеша новый `savedAt`.
  8. Два одновременных `apply(folder.create)` с разными id → обе папки созданы, `saving === false` после обоих.
  9. `createInventory({ sourceId, name: 'Tools', currency: 'EUR' })` → `current.inventoryId` — новый, `snapshot.inventory.name === 'Tools'`.
  10. `addSource` на чужую базу → отклонён с `incompatible`, `db.getSources()` пуст.
  11. `updateSource(id, { connectionString: <неверный пароль> })` → статус источника `error`, `readOnly === 'source_error'`, `current` прежний. Возврат правильной строки → `ready`.
  12. `removeSource` текущего → `current` на инвентарь другого источника, кеши удалённого стёрты.
  13. `apply` передаёт `actor.device === defaultDeviceName(ua)`. После `setDeviceName('Bench PC')` следующая запись даёт `created_by === 'Bench PC'`: проверяется через `folders[].createdBy`.
  14. `refreshIfStale(60_000)` сразу после `refresh()` не вызывает `listInventories` (шпион на драйвере). С `now()` на 2 минуты позже — вызывает.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `createWorkspace`: `reactive` из `vue`, без Nuxt.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: зелёное.
- [ ] **Step 5: Commit** — `feat(app): workspace with cached snapshot, offline read-only and serialized writes`

### Task 7: Оболочка, первый запуск и настройки

**Files:**
- Create: `app/plugins/workspace.client.ts`, `app/composables/useWorkspace.ts`, `app/middleware/onboarding.global.ts`, `app/lib/errors.ts`
- Create: `app/pages/welcome.vue`, `app/pages/settings/index.vue`, `app/pages/settings/sources/new.vue`, `app/pages/settings/sources/[id].vue`
- Create: `app/components/{AppStatus,SourceForm,SourceStatusBadge,ThemeSwitch,AppSheet}.vue`
- Modify: `app/app.vue` (`<Toaster/>`), `app/layouts/default.vue`, `i18n/locales/en.json`
- Test: `packages/app/test/errors.test.ts`

**Interfaces:**
- Consumes: Task 6 `Workspace`; Task 5 `createNeonDriver`, `createDemoDriver`, `checkConnectionString`.
- Produces:
  - `useWorkspace(): Workspace`, через `useNuxtApp().$workspace`.
  - `useWorkspaceReady(): Promise<void>` — промис `startFromCache()` из плагина, через `useNuxtApp().$workspaceReady`. Middleware и первая отрисовка ждут его, а не всего `start()`.
  - `errorMessageKey(e: unknown): string` возвращает `errors.domain.<code>`, `errors.storage.<code>`, `errors.probe.<reason>` или `errors.unknown`.
  - `AppSheet` — обёртка над `Dialog`: на ширине < 768 px прижата к низу экрана на всю ширину, шире — по центру, max-width 480. Все формы плана открываются в ней.
- **Плагин:**
  1. Создаёт workspace: `openDeviceDb()`, `drivers: { neon: createNeonDriver(), ...(import.meta.dev ? { 'dev-pglite': createDemoDriver() } : {}) }`, `navigator.userAgent`.
  2. Вызывает `startFromCache()` и отдаёт его промис как `$workspaceReady`. После него вызывает `refresh()`; вместе это то же, что `start()`.
  3. На `online` вызывает `refresh()`, на `visibilitychange` → visible вызывает `refreshIfStale(15 * 60_000)`.
- **Middleware:** ждёт `useWorkspaceReady()`. Если источников нет и маршрут не `/welcome` и не `/settings/**` → `/welcome`.
- **Экраны** (тексты — ключи `en.json`):
  - **Welcome:** логотип, `welcome.title` «Your inventory, wherever it lives», `welcome.body` (одна фраза о том, что данные хранятся в источнике, которым владеет пользователь), кнопка «Add a source» → `/settings/sources/new`. В dev ещё кнопка «Use demo data», она создаёт источник `dev-pglite` с именем `Demo`.
  - **Settings:**
    - секция **Sources**: строки с именем, видом («Neon»), значком статуса и действиями Edit / Remove (удаление с подтверждением «Remove “{name}” from this device? Data in the source is not deleted.»), плюс кнопка «Add source»;
    - секция **This device**: поле имени устройства, подсказка «Shown as the author of changes», плейсхолдер — `defaultDeviceName`, сохранение при blur;
    - секция **Appearance**: `ThemeSwitch` — радиогруппа System / Light / Dark, пишет `useColorMode().preference`.
  - **SourceForm** (new и `[id]`):
    - поля:
      - Name (по умолчанию «Neon»);
      - Connection string — `type="password"` с кнопкой показать, подсказка «Paste it from the Neon console: Connect → connection string», ошибки `checkConnectionString` под полем;
      - Uploadcare public key — необязательно, подсказка «Needed later to add photos»;
    - кнопка «Check» → `probe`, результат текстом;
    - кнопка сохранения зависит от результата `probe`:
      - `empty` → «Set up and save»;
      - `older` → «Upgrade and save»;
      - `current` → «Save»;
      - `newer` → «Save (read-only)» с пояснением «This source was updated by a newer GrayMatter»;
      - `foreign` → кнопки нет, текст «This database already has other tables. Use an empty Neon database for GrayMatter.»;
    - сохранение — `addSource` или `updateSource`, затем переход в `/`.
  - **AppStatus** (под заголовком экрана, одна строка за раз, по приоритету):
    1. `readOnly`:
       - `offline` — «Offline. Showing the copy from {time}. Changes are off.»;
       - `schema_newer` — «Updated by a newer GrayMatter. Update the app to make changes.»;
       - `source_error` — «Can’t open {source}: {reason}» и ссылка «Fix» на источник;
    2. `persistent === false` — «This browser won’t keep your sources after it closes.»;
    3. `snapshotOrigin === 'cache' && refreshing` — «Updating…».

    `saving` показывается отдельно, маленьким индикатором в заголовке.
  - Ошибки действий показываются тостом `t(errorMessageKey(e))`.

- [ ] **Step 1: Write the failing test** — `errors.test.ts`:
  - для каждого кода из `DOMAIN_ERROR_CODES`, `STORAGE_ERROR_CODES` и `PROBE_FAILURES` ключ `errorMessageKey` существует в `en.json` и не пуст;
  - `errorMessageKey(new Error('x')) === 'errors.unknown'`.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** по Interfaces.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: зелёное.
- [ ] **Step 5: Проверить в браузере** (`pnpm dev`, ширина 360 и 1280, обе темы):
  1. Первый запуск ведёт на Welcome.
  2. «Use demo data» → главная страница. До Task 8 это временная `index.vue`; Task 7 дописывает в неё имя текущего инвентаря и `AppStatus`, поэтому видно «Electronics».
  3. В Settings видно источник «Demo» со статусом Ready.
  4. Смена темы работает и переживает перезагрузку.
  5. Форма Neon со строкой `postgresql://u@h/db` показывает «missing password».
  6. Баннер offline в браузере здесь не проверяется: демо-источник локальный и от сети не зависит. Логику покрывают тесты Task 6, на Neon её проверяет владелец при приёмке.

  Снимки приложить к отчёту.
- [ ] **Step 6: Commit** — `feat(app): app shell, onboarding and settings for sources, device and theme`

### Task 8: Экран папки и поиск

**Files:**
- Modify: `packages/core/src/units.ts`: добавить `formatAmountParts`, а `formatAmount` выразить через неё
- Create: `packages/app/app/lib/views.ts`
- Create: `app/components/{FolderScreen,FolderHeader,SearchField,Breadcrumbs,FolderList,ItemList,SearchResults,FolderTree,EmptyState}.vue`
- Modify: `app/pages/index.vue` (корень), create `app/pages/folder/[id].vue`, modify `app/layouts/default.vue` (боковая панель ≥ 1024 px с `FolderTree`)
- Test: `packages/core/test/units.test.ts` (дополнить), `packages/app/test/views.test.ts`

**Interfaces:**
- Produces (core):
  ```ts
  export function formatAmountParts(q: Quantity, unit: UnitDef): { number: string; unit: string }   // formatAmount = `${number} ${unit}`
  ```
- Produces (`views.ts`):
  ```ts
  export interface Crumb { id: Id | null; name: string }               // id null = inventory root, name = inventory name
  export interface FolderRow { id: Id; name: string; itemCount: number } // active items anywhere in the subtree
  export interface ItemRow { id: Id; name: string; description: string | null; variantCount: number; number: string; unit: string; outOfStock: boolean; coverUrl: string | null }
  export interface FolderView { folder: Folder | null; crumbs: Crumb[]; folders: FolderRow[]; items: ItemRow[] }
  /** null when the folder is missing, archived, or under an archived ancestor. Root: folder null, crumbs []. */
  export function folderView(s: InventorySnapshot, folderId: Id | null): FolderView | null
  /** ≤ max: unchanged; otherwise [first, 'ellipsis', ...last two]. */
  export function collapseCrumbs(crumbs: Crumb[], max?: number): (Crumb | 'ellipsis')[]   // max default 4
  export interface SearchRow { itemId: Id; variantId: Id | null; name: string; variantName: string | null; number: string; unit: string; outOfStock: boolean; path: string }
  export function searchRows(s: InventorySnapshot, hits: SearchHit[]): SearchRow[]
  export interface TreeNode { id: Id; name: string; children: TreeNode[] }
  export function folderTree(s: InventorySnapshot): TreeNode[]
  ```
  - Количество предмета — `itemStock`, варианта — `bucketStock`.
  - Единица — `resolveUnit(item.unitKey, s.units)`. Если её нет, берётся `BUILTIN_UNITS.pcs`.
  - `path` — имена папок от корня через ` / `, у корня `''`.
  - `coverUrl` — `url` фото с минимальной `position` и `variantId === null`, иначе `null`.
  - В `crumbs` все папки пути, включая текущую. Компонент рисует последнюю как текст без чипа.
- **Раскладка** — артборд E, точные размеры в Global Constraints:
  - **Заголовок:** кнопка с именем инвентаря и шевроном (24 px, жирный; переключатель — Task 9) и справа круглая кнопка настроек 44 px (иконка `SlidersHorizontal`).
  - **Поиск:** поле 46 px с иконкой лупы, плейсхолдер «Search: TL072, 10k, 0805…».
  - **Путь:** чипы.
  - **Карточка папок:** иконка папки в подложке 32 px, имя 15/600, число предметов 13/600 вторичным цветом. Разделители с отступом 58.
  - **Подпись «Items · N»** и **карточка предметов:**
    - миниатюра 42 px: фото или иконка `Cpu`;
    - имя 15/700;
    - подстрока 13 px: описание и «N variants» через « · »;
    - справа число 16/700 tabular-nums, единица 12/600;
    - «нет в наличии»: имя приглушённым цветом, в подстроке «Out of stock» первым, число вторичным цветом;
    - разделители с отступом 68.
  - **Поиск по вводу:** `createSearch(snapshot)` пересоздаётся при смене снимка. Непустой запрос заменяет содержимое папки на `SearchResults`: имя, вариант, путь, количество. Пустой результат — «Nothing found for “{q}”». Запрос хранится в `?q=`.
  - **Пустые состояния:**
    - нет инвентарей — «Create your first inventory» (кнопку создания к этому состоянию добавляет Task 9);
    - пустая папка — «This folder is empty»;
    - `folderView` вернул `null` — «This folder was archived or deleted» и ссылка «Back to {inventory}».
  - **От 1024 px:** слева панель 280 px с `FolderTree`, текущая папка выделена. Справа колонка до 720 px. Строки предметов пока не нажимаются.

- [ ] **Step 1: Write the failing tests**
  - `units.test.ts`: `formatAmountParts('1500', BUILTIN_UNITS.m)` → `{ number: '1.5', unit: 'km' }`, `formatAmountParts('37', BUILTIN_UNITS.pcs)` → `{ number: '37', unit: 'pcs' }`.
  - `views.test.ts`. Снимок берётся так: `createDemoDriver({ memory: true }).connect(cfg)`, затем `loadInventory` инвентаря Electronics. Архивация в тестах — через `storage.apply` и перезагрузку снимка.
    - корень Electronics: папки по имени `['ICs', 'Passive components', 'Очень длинное…']`, `itemCount` у ICs = 3 (LM13700, NE555 и TL072 в подпапке Op-amps), у пустой = 0;
    - `folderView(Op-amps)`: `crumbs` → имена `['ICs', 'Op-amps']`; TL072: `number === '37'`, `unit === 'pcs'`, `outOfStock === false`;
    - NE555 в ICs: `outOfStock === true`;
    - резистор с тремя вариантами: `variantCount === 3`;
    - после архивации ICs в снимке: `folderView(Op-amps) === null`, ICs нет среди папок корня, а `folderTree` её не содержит;
    - `collapseCrumbs` на 6 крошках → `[c0, 'ellipsis', c4, c5]`, на 4 — без изменений;
    - `searchRows` для попадания в вариант 10k → `variantName === '10k'`, `number === '100'`, `path === 'Passive components / Resistors'`.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `formatAmountParts`, `views.ts`, компоненты и страницы.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: зелёное.
- [ ] **Step 5: Проверить в браузере** на демо-данных: 360 px и 1280 px, светлая и тёмная темы.
  1. Сравнить с артбордом E: размеры строк, цвета, путь.
  2. Длинное имя папки обрезается, горизонтальной прокрутки нет (`document.documentElement.scrollWidth <= innerWidth`).
  3. «tl-072» находит TL072.
  4. Кнопка «назад» браузера возвращает из папки и очищает поиск.

  Снимки приложить к отчёту.
- [ ] **Step 6: Commit** — `feat(app): folder screen with breadcrumbs, desktop tree and instant search`

### Task 9: Инвентари — переключение, создание, переименование, архив

**Files:**
- Create: `app/lib/currencies.ts`, `app/components/{InventorySwitcher,InventoryForm,ConfirmSheet}.vue`
- Modify: `app/components/FolderHeader.vue`, `app/components/FolderScreen.vue` (кнопка «Create inventory» в пустом состоянии «нет инвентарей»), `i18n/locales/en.json`
- Test: `packages/app/test/currencies.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Code match first (exact, then prefix), then name substring; case-insensitive; empty query → all, by code. */
  export function currencyOptions(query: string): Currency[]
  ```
- **`InventorySwitcher`** — по нажатию на имя инвентаря в заголовке.
  - На телефоне `AppSheet`, на компьютере выпадающее меню.
  - Список активных инвентарей с отметкой текущего. Если источников больше одного, инвентари сгруппированы по источнику.
  - Ниже действия:
    - «New inventory»;
    - «Rename “{name}”»;
    - «Archive “{name}”» — `ConfirmSheet` «Archive “{name}”? It disappears from the list. You can restore it from the Archive.».
- **`InventoryForm`:**
  - Name;
  - Currency — `Combobox` по `currencyOptions`, по умолчанию валюта последнего созданного инвентаря или `USD`;
  - Source — `Select`, только если источников больше одного;
  - Description — необязательно.

  Создание → `createInventory`, переименование → `apply(inventory.update)`.
- Архивация текущего → `apply({ type: 'archive', target: 'inventory', id, archiveId: newId() })`. Дальше workspace сам переключает текущий.

- [ ] **Step 1: Write the failing test** — `currencies.test.ts`:
  - `currencyOptions('eur')[0].code === 'EUR'`;
  - `currencyOptions('yen')` содержит `JPY`;
  - `currencyOptions('').length === Object.keys(CURRENCIES).length`, и коды в нём идут по возрастанию (`AED` первым).
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** по Interfaces.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: зелёное.
- [ ] **Step 5: Проверить в браузере** на демо-данных:
  1. Переключиться на Workshop и обратно.
  2. Создать «Tools» в EUR.
  3. Переименовать.
  4. Заархивировать Tools: он исчезает, открывается другой.
  5. Во время записи в заголовке виден индикатор сохранения.
- [ ] **Step 6: Commit** — `feat(app): inventory switcher with create, rename and archive`

### Task 10: Управление папками

**Files:**
- Modify: `app/lib/views.ts`, `app/components/FolderHeader.vue`
- Create: `app/components/{FolderMenu,FolderForm,MoveFolderSheet}.vue`
- Test: `packages/app/test/views.test.ts` (дополнить)

**Interfaces:**
- Produces:
  ```ts
  export interface MoveTarget { id: Id | null; name: string; depth: number; current: boolean }   // id null = root (inventory name, depth 0)
  /** Root first, then active folders depth-first by name; excludes the folder itself and its subtree; current = present parent. */
  export function moveTargets(s: InventorySnapshot, folderId: Id): MoveTarget[]
  ```
- **`FolderMenu`** — кнопка «⋯», 44 px, в заголовке экрана папки. Пункты:
  - «New folder» — создаётся внутри текущей;
  - «Rename»;
  - «Move»;
  - «Archive» — `ConfirmSheet` «Archive “{name}” and everything in it? You can restore it from the Archive.».

  В корне есть только «New folder».
- **`FolderForm`:** Name и Description. Команды `folder.create` / `folder.update`.
- **`MoveFolderSheet`:** список `moveTargets` с отступом по `depth` и отметкой текущего родителя → `folder.move`.
- После архивации открытой папки — переход к родителю. После создания — остаёмся на месте, новая папка в списке.

- [ ] **Step 1: Write the failing tests**:
  - `moveTargets(s, ICs)`:
    - первый — корень (`id === null`, `current === true`);
    - нет ICs и Op-amps;
    - есть «Passive components» (depth 1) и «Resistors» (depth 2);
  - `moveTargets(s, Op-amps)` содержит ICs с `current === true`.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** по Interfaces.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint && pnpm build`. Expected: зелёное, сборка проходит.
- [ ] **Step 5: Проверить в браузере** на демо-данных:
  1. Создать папку.
  2. Переименовать.
  3. Перенести «Resistors» в корень.
  4. Убедиться, что «Passive components» нельзя перенести в «Resistors»: её нет в списке.
  5. Заархивировать «ICs»: она пропадает вместе с содержимым, поиск «TL072» ничего не находит.
  6. Повторить на 360 px.
- [ ] **Step 6: Commit** — `feat(app): create, rename, move and archive folders`

---

## Приёмка владельцем

После финального ревью ветки контроллер просит владельца:
1. Прогнать на телефоне через `adb reverse tcp:3000 tcp:3000` и `http://localhost:3000`:
   - добавить свой источник Neon (база `neondb`, не тестовая);
   - создать инвентарь и папки;
   - проверить поиск и работу без сети.
2. Установить PWA с телефона, когда появится хостинг в плане 4. До этого — проверить установку на компьютере.
