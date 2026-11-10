# GrayMatter — План 5: выпуск

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** приложение готово к выкладке как статическое PWA на GitHub Pages. Для этого:
- сборка под путь `/graymatter/` с SPA-фолбэком;
- без лишних 15 МБ PGlite;
- обновление версии с подсказкой;
- CSP;
- готовый workflow деплоя;
- README для нового пользователя;
- долги плана 2.

**Architecture:**
- **Хостинг.** **[решение Claude]** Репозиторий на GitHub (`hazer-hazer/graymatter`), поэтому GitHub Pages: бесплатно, без своего сервера. Workflow лежит в репозитории, но срабатывает только на `master`. Выкладка начнётся, когда владелец сольёт `revival` в `master` и включит Pages (Settings → Pages → Source: GitHub Actions). Пушить и включать Pages сам план не будет.
- **Путь.** Сборка получает `NUXT_APP_BASE_URL=/graymatter/`, локально путь `/`.
- **Глубокие ссылки** (`/graymatter/item/<id>`) на Pages отдаются через `404.html` — копию `index.html`.
- **Демо-источник (PGlite) только в dev-сборке**, как сейчас. В production-бандле его быть не должно.

**Tech Stack:** без новых зависимостей. `virtual:pwa-register/vue` уже есть в `@vite-pwa/nuxt`.

**Spec:** `docs/superpowers/specs/2026-11-10-graymatter-revival-design.md` — цели 12 (PWA) и ограничения 3 (бесплатно, без сервера, секреты на устройстве). Долги — раздел «Перенос в план 4» в конце `docs/superpowers/plans/2026-11-10-graymatter-2-app-shell.md` (план 4 стал фото, выпуск переехал сюда).

## Global Constraints

- **Ничего не публиковать.** Не пушить, не включать Pages, не создавать релизы — только файлы в репозитории.
- **Секреты.** Строка подключения и ключи живут на устройстве. CSP не должна запрещать то, что приложению нужно: Neon по WSS и HTTPS, Uploadcare upload и CDN, шрифты.
- **Без регрессий в dev.** `pnpm dev` и демо-источник работают как раньше. CSP включается только в production-сборке.
- **Проверки:**
  - `pnpm test`, `pnpm typecheck`, `pnpm lint` зелёные;
  - для сборочных задач — `pnpm --filter @graymatter/app generate` и проверка содержимого `packages/app/.output/public`. Пути выходного каталога уточнить по факту;
  - проверка в браузере — только общая картина;
  - stage только своих файлов. Не трогать `packages/app/nuxt.config.ts` целиком: там незакоммиченная правка владельца `devServer: { host: '0.0.0.0' }`. Свои правки в этот файл вносить так, чтобы правку владельца не закоммитить: `git add -p` или временный `git stash` только этого hunk. Не трогать `.claude/` и `.superpowers/`;
  - коммиты без трейлеров;
  - `api/` и `web/` не трогать;
  - `.env.local` не читать.

## Review Focus

1. **Глубокая ссылка после установки.**
   - Ситуация: открыть `https://<host>/graymatter/item/<id>` из закладки, офлайн после первой загрузки.
   - Ожидание: открывается приложение, а не 404 Pages. Офлайн отвечает service worker (`navigateFallback`).
   - Проверка: Task 1 (`404.html`, `navigateFallback` с учётом пути).
2. **CSP ломает Neon или фото в production.**
   - Ожидание: подключение к Neon (`wss://*.neon.tech`, `https://*.neon.tech`), загрузка в Uploadcare и показ CDN-картинок разрешены. Остальное запрещено.
   - Проверка: Task 3 сверяет список с реальными запросами кода, а не с памятью.
3. **Старый service worker держит старую версию.**
   - Ожидание: при новой версии появляется toast «New version available» с «Reload». Перезагрузка без потери введённого: toast не перезагружает сам.
   - Проверка: Task 2.
4. **Тёмная тема в шапке браузера и в установленном PWA.**
   - Ожидание: `theme-color` совпадает с фоном темы, и системной, и выбранной вручную.
   - Проверка: Task 2.
5. **Сборка тянет PGlite.**
   - Ожидание: в `.output/public` нет файлов `pglite*` / `*.wasm` / `*.data` от PGlite. Бандл не импортирует демо-драйвер в production.
   - Проверка: Task 1.

---

### Task 1: Сборка для GitHub Pages без PGlite

**Files:**
- Modify: `packages/app/nuxt.config.ts` (только свои hunk-и), `packages/app/app/plugins/workspace.client.ts`, `packages/app/app/pages/welcome.vue`
- Create: `packages/app/scripts/postgenerate.mjs` (или хук Nitro в конфиге) и `packages/app/test/build-config.test.ts`

- **`app.baseURL`** — из `process.env.NUXT_APP_BASE_URL ?? '/'`. Манифест PWA: `scope` и `start_url` остаются относительными (`'.'`). Workbox: `navigateFallback` — `index.html` относительно базы. `navigateFallbackDenylist` — для файлов с расширением.
- **`404.html`.** После `nuxt generate` в выходном каталоге лежит копия `index.html` под именем `404.html` (хук `nitro:build:public-assets` / `close` или скрипт `postgenerate`; проверить, что Nuxt не делает это сам). Плюс `.nojekyll`.
- **PGlite только в dev.** Демо-драйвер и его импорт из плагина и `welcome.vue` — за `import.meta.dev` с динамическим `import()`, чтобы tree-shaking убрал его из production. Проверить вывод: никаких `pglite`/`postgres.wasm`/`postgres.data` в `.output/public`. Записать размер `.output/public` до и после.
- [ ] **Step 1: Failing test** `build-config.test.ts` (как `nuxt-config.test.ts`, через `vi.stubGlobal('defineNuxtConfig', …)`):
  - `app.baseURL` берётся из `NUXT_APP_BASE_URL`, по умолчанию `/`;
  - `pwa.workbox.navigateFallback` задан;
  - `pwa.manifest.start_url === '.'`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Проверка сборки:**
  - `NUXT_APP_BASE_URL=/graymatter/ pnpm --filter @graymatter/app generate`;
  - в выводе есть `index.html`, `404.html`, `.nojekyll`, ссылки на ассеты начинаются с `/graymatter/`, нет файлов PGlite;
  - размер до/после — в отчёт.
- [ ] **Step 6: Commit:** `build(app): GitHub Pages base path, SPA fallback and no PGlite in production`

---

### Task 2: Обновление версии, theme-color, ярлыки PWA

**Files:**
- Create: `packages/app/app/components/UpdatePrompt.vue`
- Modify: `nuxt.config.ts` (свои hunk-и: `registerType: 'prompt'`, `manifest.shortcuts`, `theme_color`), `layouts/default.vue`, `layouts/bare.vue`, `app.vue` или плагин для `theme-color`, `en.json`

- **Обновление.**
  - `registerType: 'prompt'` вместо `autoUpdate`.
  - `UpdatePrompt` через `useRegisterSW` (`virtual:pwa-register/vue`): при `needRefresh` — `toast` «New version available» с действием «Reload» (`updateServiceWorker(true)`), без автоперезагрузки.
  - Проверка обновления раз в час, пока вкладка открыта (`registration.update()`).
  - При `offlineReady` — одноразовый toast «Ready to work offline».
- **`theme-color`.** Мета-теги с `media="(prefers-color-scheme: light)"` → `#F7F7F8` и `dark` → `#0E0E10`. При ручном выборе темы (`useColorMode`) один мета-тег без `media` обновляется под выбранную тему. В манифесте `theme_color` и `background_color` — светлые, как сейчас.
- **Ярлыки** (`manifest.shortcuts`): «Add item» → `./?action=add`, «Search» → `./?action=search`. Layout при старте читает `action` и открывает `useQuickAdd().open()` или `paletteOpen`, затем убирает параметр через `router.replace`. Логика разбора — чистая функция в `lib/shell.ts` с тестом: `launchAction(query) → 'add' | 'search' | null`.
- [ ] **Step 1: Failing tests:** `launchAction({ action: 'add' })` → `'add'`, `'search'` → `'search'`, прочее → `null`; `nuxt-config`-тест на `registerType: 'prompt'` и два ярлыка.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit:** `feat(app): update prompt, theme-color for both themes and PWA shortcuts`

---

### Task 3: Content Security Policy

**Files:**
- Modify: `nuxt.config.ts` (свои hunk-и: `app.head.meta` только в production) или модуль/хук, который вставляет мета-тег при `generate`
- Test: `packages/app/test/csp.test.ts`

- **Где.** GitHub Pages не умеет заголовки, поэтому `<meta http-equiv="Content-Security-Policy">`. Только в production: `process.env.NODE_ENV === 'production'` или `!import.meta.dev` в конфиге. Dev-серверу нужен HMR по WebSocket.
- **Источники собрать из кода, а не по памяти:**
  - `grep` по `packages/storage-postgres/src/executors` и `packages/app/app/lib/sources.ts` — домены Neon;
  - `packages/files-uploadcare` — `upload.uploadcare.com`, CDN-домены;
  - `@nuxt/fonts` — откуда шрифты в production-сборке: свои файлы или Google.
- **Политика** — функция `cspFor(origins): string` в `lib/csp.ts` с тестом, чтобы список был проверяем:
  - `default-src 'self'`;
  - `script-src 'self'` + хеш инлайн-скрипта Nuxt, если он есть в собранном `index.html`. Проверить; если хеш нестабилен — `'unsafe-inline'` только для `script-src` с комментарием почему;
  - `style-src 'self' 'unsafe-inline'` (Tailwind/Reka инлайн-стили) + шрифты при необходимости;
  - `img-src 'self' data: blob: https://ucarecdn.com https://*.ucarecd.net`;
  - `connect-src 'self' https://*.neon.tech wss://*.neon.tech https://upload.uploadcare.com`;
  - `font-src 'self'` (+ `https://fonts.gstatic.com`, если шрифты не свои);
  - `worker-src 'self'`, `manifest-src 'self'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors` в meta не работает — не указывать.
- [ ] **Step 1: Failing test** `csp.test.ts`:
  - `cspFor` содержит `connect-src` с `wss://*.neon.tech` и `https://upload.uploadcare.com`;
  - `img-src` с CDN Uploadcare;
  - `default-src 'self'`;
  - нет `unsafe-eval`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Проверка:**
  - `pnpm --filter @graymatter/app generate` и `npx serve` (или `pnpm dlx serve`) выходного каталога на свободном порту;
  - открыть в браузере, в консоли нет нарушений CSP при загрузке, переходах, открытии палитры и настроек;
  - снимок экрана в отчёт.
  - Подключение к настоящему Neon проверить нельзя (нет секретов) — в отчёте указать, откуда взяты домены.
- [ ] **Step 6: Commit:** `feat(app): content security policy for the production build`

---

### Task 4: Workflow деплоя и README

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `README.md`

- **`deploy.yml`.**
  - Триггеры: `push` в `master` и `workflow_dispatch`.
  - `permissions: pages: write, id-token: write, contents: read`, `concurrency: pages`.
  - Шаги:
    1. checkout;
    2. `pnpm/action-setup` (версия из `packageManager` корня);
    3. `actions/setup-node` с Node 24 и кешем pnpm;
    4. `pnpm install --frozen-lockfile`;
    5. `pnpm test`, `pnpm typecheck`, `pnpm lint`;
    6. `NUXT_APP_BASE_URL=/${{ github.event.repository.name }}/ pnpm --filter @graymatter/app generate`;
    7. `actions/upload-pages-artifact` с выходным каталогом;
    8. `actions/deploy-pages`.
  - Тесты Neon в CI пропускаются сами (нет `GM_NEON_TEST_URL`).
  - Проверить синтаксис: `actionlint`, если доступен через `pnpm dlx`; иначе внимательное чтение.
- **`README.md`** переписать под новое приложение (старое `api/`/`web/` — один абзац «Legacy»):
  1. **What it is** — коротко, со сценарием «есть ли у меня TL072».
  2. **Use it:**
     - открыть адрес Pages;
     - установить как приложение (Android Chrome: меню → Install app);
     - добавить источник Neon: бесплатный проект, строка подключения, данные только на устройстве;
     - необязательно — ключ Uploadcare для фото.
  3. **Develop:** `pnpm install`, `pnpm dev`, демо-данные на `/welcome`, `pnpm test`, тестовая база через `GM_NEON_TEST_URL` в `.env.local` (имя базы оканчивается на `_test`), телефон через `adb reverse tcp:3000 tcp:3000`.
  4. **Deploy your own:** fork → Settings → Pages → GitHub Actions → push в `master`.
  5. **Privacy:** нет сервера и аккаунтов, строка подключения хранится в IndexedDB устройства, CSP.
- [ ] **Step 1:** Файлы и проверки.
- [ ] **Step 2: Commit:** `ci: deploy the PWA to GitHub Pages; docs: README for the revived app`

---

### Task 5: Долги плана 2

**Files:** по пунктам ниже.

- **`inspectSchema` не видит таблиц вне `public`.**
  - Сейчас база с таблицами только в своей схеме считается пустой, и мы создаём свою схему рядом.
  - Правило: `foreign`, если в `public` нет `gm_meta`, но есть пользовательские таблицы где угодно. Не считаются служебные схемы: `pg_catalog`, `information_schema`, `pg_toast`, `pg_temp_*`, а также платформенные `neon_auth`, `pgrst`, `auth`, `extensions`, `graphql`, `graphql_public`, `realtime`, `storage`, `vault`.
  - `empty` — если пользовательских таблиц нет нигде.
  - Тесты в `packages/storage-postgres/test` на PGlite: таблица в `myschema` → `foreign`; только `neon_auth.users` → `empty`.
- **`AbortSignal.timeout` без проверки поддержки** (`packages/storage-postgres/src/executors/neon-http.ts`) — заменить на `AbortController` + `setTimeout` (общий помощник `timeoutSignal(ms)` с очисткой). Тест на помощник.
- **Конфигурация:**
  - в `components.json` псевдоним `utils` указывает на несуществующий `@/lib/utils` — поправить на реальный путь или удалить;
  - TypeScript в `packages/app/package.json` закрепить `~6.0.3`; lock-файл обновить через `pnpm install`;
  - сгенерированный `cn('')` найти `grep -rn "cn('')"` и убрать.
- **Гигиена тестов** (раздел плана 2):
  - исполнитель WebSocket: ошибки после подключения, дублирование подключения и отката — тесты;
  - голые `toThrow()` → `toThrow(<класс или код>)`;
  - демо-драйвер: повторное наполнение после сбоя — тест;
  - тест сбоя пробной записи в IndexedDB;
  - `close()` в тестах workspace;
  - пустая проверка вырезания пароля в тесте 11 — сделать настоящей.
- [ ] **Step 1–3:** по пункту за раз: тест → правка → зелёный.
- [ ] **Step 4:** `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 5: Commit:** `fix: Plan 2 carry-overs — foreign schemas, timeouts, config and test hygiene`

---

### Task 6: Резервная копия в файл

**[решение Claude, добавлено по ночному исследованию]** На бесплатном Neon история восстановления — 6 часов, одна ручная точка и никаких плановых бэкапов. Ошибка или чужое удаление через сутки необратимы. Экспорт был в списке «после MVP» (не-цель 6), но его минимальная часть дешёвая и закрывает главный риск потери данных. Импорт остаётся на потом.

**Files:**
- Create: `packages/app/app/lib/backup.ts`, `packages/app/test/backup.test.ts`
- Modify: `packages/app/app/pages/settings/index.vue` (кнопка в разделе источника), `lib/workspace.ts` (+ `exportSource(sourceId)`), `en.json`

**Interfaces:**

```ts
// backup.ts
export interface BackupFile {
  format: 'graymatter-backup'
  version: 1
  exportedAt: string
  app: { schemaVersion: number }
  source: { name: string; kind: string }       // no connection string, no keys
  inventories: { snapshot: InventorySnapshot; movements: Movement[] }[]   // archived inventories included
}
export function buildBackup(input: Omit<BackupFile, 'format' | 'version'>): BackupFile
export function backupFileName(sourceName: string, at: Date): string   // 'graymatter-<slug>-2026-11-11.json'
// workspace
exportSource(sourceId: string): Promise<BackupFile>   // listInventories + loadInventory + all movements per item; read-only, works offline from cache only for the current inventory → when offline: StorageError('unavailable')
```

- **Журнал.** Движения всех предметов, включая архивные, берутся одним запросом на инвентарь. Если в хранилище нет такого метода, добавить в `InventoryStorage` `loadAllMovements(inventoryId)` — одна выборка по `inventory_id`, новые последними. Тест в `storage-postgres` на PGlite.
- **Кнопка «Export backup»** в карточке источника в настройках скачивает файл (`Blob` + `a[download]`). Во время экспорта — «Exporting…».
- **Подсказка под кнопкой:** «Neon's free plan keeps only a few hours of history. Keep a copy of your data on this device.»
- [ ] **Step 1: Failing tests:**
  - `buildBackup` без строки подключения и ключей: сериализованный JSON не содержит `connectionString`, `postgres://`, `uploadcarePublicKey`;
  - `backupFileName` даёт slug из имени;
  - `exportSource` на демо-драйвере возвращает все инвентари, включая архивный, с движениями;
  - `loadAllMovements` в storage-postgres.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit:** `feat(app): export a source to a backup file`

---

### Task 7: Поиск не путает 4.7k и 47k

**[решение Claude, добавлено по ночному исследованию]** Исследование доменной области прогнало настоящий `createSearch`: при вариантах `47k` и `4k7` запрос `4.7k` возвращает **47k** — ошибку в 10 раз. Причины две:
- `compact()` в `packages/core/src/search.ts` выбрасывает точку;
- MiniSearch делит `4.7k` на `4` и `7k`.

Для главного сценария («есть ли у меня») это ошибка, а не пожелание. Полноценный разбор номиналов (`4k7` = `4.7k` = `4700`, `100n` = `0.1u`) — отдельная большая задача из ночного обзора. Здесь — минимальная правка, чтобы поиск не выдавал неверную деталь.

**Files:**
- Modify: `packages/core/src/search.ts`, `packages/core/test/search.test.ts`

**Изменения:**
- **Десятичный разделитель между цифрами сохраняет смысл.**
  - `compact()` оставляет `.` между двумя цифрами, а `,` между цифрами переводит в `.`;
  - собственный `tokenize` для MiniSearch не режет число с дробной частью: `4.7k` — один токен, `4,7k` → `4.7k`.
  - Остальная пунктуация по-прежнему игнорируется: `tl-072` = `TL072`.
- **Регистр приставок не меняется в этой задаче** (`1M` и `1m` по-прежнему совпадают) — это часть будущего разбора номиналов.
- [ ] **Step 1: Failing tests** (предмет «Resistor» с вариантами `47k`, `4.7k`, `4k7`; предмет «Cap» с `4n7`):
  - запрос `4.7k` — первым идёт вариант `4.7k`, а `47k` не входит в результаты;
  - `4,7k` даёт то же, что `4.7k`;
  - `47k` находит `47k`, а не `4.7k`;
  - `tl-072`, `TL072` и `tl 072` по-прежнему находят TL072 (существующие тесты зелёные);
  - опечатка в длинном слове по-прежнему работает (существующий тест).
- [ ] **Step 2–4:** fail → implement → pass; `pnpm test` целиком (поиск используют `views`, палитра и тесты app).
- [ ] **Step 5: Commit:** `fix(core): search keeps decimal points in values so 4.7k never matches 47k`

---

## Приёмка владельцем

1. Слить `revival` в `master` и запушить. Settings → Pages → Source: GitHub Actions. Дождаться зелёного workflow.
2. Открыть `https://hazer-hazer.github.io/graymatter/` на телефоне, установить как приложение, добавить источник Neon и ключ Uploadcare.
3. Открыть глубокую ссылку на предмет из закладки, в том числе в режиме полёта.
4. Выпустить новую версию (любой коммит в `master`) и увидеть «New version available».
