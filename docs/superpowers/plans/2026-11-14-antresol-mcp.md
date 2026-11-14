# Локальный MCP и теги в поступлениях — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Локальный stdio MCP-сервер, который читает инвентарь и пишет только черновики поступлений (с фото из папки на компьютере); теги у новых предметов в черновиках; кнопка «Connect AI» в приложении; сборка `.mcpb` и выпуск через GitHub Actions.

**Architecture:**
- **Теги в черновике** — в `core` (`DraftNewItem.tagIds`, `IntakeDraftContent.newTags`, новые поля `intake.commit`), в SQL проведения и в шторке строки приложения.
- **Общий пакет `@antresol/kit`** — чистые модули, которые сейчас лежат в `packages/app/app/lib` и нужны и приложению, и серверу (разбор количеств и цен, ввод атрибутов, строки поиска, логика строки поступления, адреса фото), плюс ключ подключения и выбор хранилища фото. В приложении на их месте остаются однострочные реэкспорты, импорты приложения не меняются.
- **`@antresol/mcp`** — сервер на `@modelcontextprotocol/sdk` поверх `kit`, `core` и `storage-postgres` (Neon HTTP). Снимок инвентаря в памяти, сверка `rev` перед вызовом. Обработчики инструментов — чистые функции от контекста, протокол — тонкая обёртка.

**Tech Stack:** TypeScript, Vitest, PGlite (тесты), Neon HTTP, `@modelcontextprotocol/sdk` 1.32.x, zod 4, Vite 8 (сборка сервера в один файл), `@anthropic-ai/mcpb` 2.x (упаковка), WASM-кодеки изображений (кандидаты: `@jsquash/jpeg`, `@jsquash/webp`, `@jsquash/png`, `@jsquash/resize`, `heic-decode`), Nuxt 4 / Vue 3 (приложение).

**Spec:** `docs/superpowers/specs/2026-11-14-antresol-mcp-design.md`. Спека поступлений `docs/superpowers/specs/2026-11-13-antresol-intakes-design.md` и правила Планов 6–9 действуют.

## Global Constraints

- **Ветка и место.** Работа — в worktree `/Users/as/dev/graymatter/.worktrees/mcp`, ветка `mcp` (от локального `master` `1cbe7f1`). Параллельные задачи — в своих worktree от `mcp`, вливаются в `mcp`. В `master` не вливать, не пушить, теги не ставить без команды владельца.
- **Git.** Никаких push, PR, тегов и строк атрибуции (`Co-Authored-By`, `Claude-Session`). Голые `git stash` / `git stash pop` запрещены. Файлы добавляются явными путями. Не добавлять `packages/app/nuxt.config.ts`, `proposals.md`, `.claude/`, `.superpowers/`, `.env.local`, `Claude outputs/`.
- **Инструменты.** Только pnpm из корня. Легаси `api/` и `web/` не трогать. Новые зависимости — только перечисленные в Tech Stack (или замена кодеку с тем же свойством «без платформенных бинарников»); версии проверять `npm view` вне репозитория.
- **Секреты.** Строки подключения и ключи не печатать, не логировать, не коммитить. В ответах инструментов и ошибках MCP строки подключения и ключа хранилища фото не бывает (§2 анти-цели).
- **Neon.** Только база `_test` через `ANTRESOL_NEON_TEST_URL`. Набор соответствия (`neon.conformance.test.ts`) запускает только задача 1, один раз. Два worktree одновременно его не гоняют.
- **Команды:** все тесты — `pnpm test`, один файл — `pnpm vitest run <path>`, тяжёлые прогоны с `--maxWorkers=3`; `pnpm typecheck`, `pnpm lint`.
- **Черновики не меняют `rev`.** MCP пишет только `saveIntakeDraft` и `updateIntakeHeader`; никогда `apply`, `deleteIntakeDraft`, `force: true`.
- **Числа** — без float: `Quantity` из ядра, цена в минимальных единицах (`parseMoneyText`).
- **Автор черновиков MCP:** `Actor.device` = `${clientInfo.name} · MCP`, без имени клиента — `AI · MCP`.
- **Ключ подключения:** `antresol-connect-v1:` + base64url(JSON `ConnectionSettings`).
- **Переменные сервера:** `ANTRESOL_CONNECTION`, `ANTRESOL_PHOTOS_DIR`, `ANTRESOL_STATE_DIR` (только для тестов и необычных установок).
- **Папка фото по умолчанию:** macOS и Windows — `<home>/Pictures/Antresol`; Linux — `$XDG_PICTURES_DIR/Antresol`, без него `<home>/Pictures/Antresol`. Пути строятся `node:path` и `node:os`, не строками. Нет папки — создаётся при первом обращении.
- **Фото для хранилища** — как в приложении: длинная сторона ≤ 2048 px, WebP (или JPEG, если WebP не вышел), HEIC/HEIF декодируется. **Фото для модели** — длинная сторона ≤ 1568 px, JPEG, каждое ≤ 1 МБ в base64 (уменьшать качество, затем размер).
- **Ничего специфичного для Claude** в сервере: только стандартные инструменты, `image`-содержимое, `instructions` и prompts MCP.
- **Интерфейс приложения.** Тексты на английском в `packages/app/i18n/locales/en.json`; контраст ≥ 4.5:1; оформление по стилям приложения. Проверка в браузере — два снимка главного экрана задачи, 1280 px и 360 px (без горизонтальной прокрутки), demo-данные, dev-сервер из своего worktree на порту `3010 + N` (N — номер задачи), без `--host`.

## Review Focus

1. **Черновик одновременно правят в приложении и через MCP** — MCP не затирает: перечитывает и повторяет один раз, потом отвечает «черновик сейчас правят». Тест в задаче 6.
2. **Плохой или отсутствующий ключ подключения, недоступный Neon** — сервер стартует, каждый инструмент отвечает понятной ошибкой со ссылкой на Settings → Connect AI, и ни одна ошибка не содержит строку подключения. Тест в задаче 5.
3. **Фото: HEIC, огромный JPEG, не картинка, несуществующий путь, тот же файл дважды** — понятная ошибка или одна загрузка, без падения сервера. Тест в задаче 7.
4. **Несколько инвентарей и архивный инвентарь** — без `inventory` ошибка со списком; запись в архивный инвентарь отказывает. Тест в задаче 5 (чтение) и 6 (запись).
5. **Старые черновики без тегов и восстановление копии «с новыми id»** — читаются как «без тегов»; id тегов в черновике переименовываются. Тест в задаче 1.

---

### Task 1: Теги в черновиках и в проведении (core + storage)

Данные и SQL — ревью на сильной модели.

**Files:**
- Modify: `packages/core/src/intakes.ts` (типы, `pruneNewItems`, `resolveIntake`, `buildIntakeCommit`, `snapshotAfterIntake`)
- Modify: `packages/core/src/commands.ts` (`intake.commit`)
- Modify: `packages/core/src/validate.ts` (`checkIntakeCommit`)
- Modify: `packages/storage-postgres/src/commands/intakes.ts` (SQL проведения)
- Modify: `packages/storage-postgres/src/restore.ts` (`renameIntakeIds`)
- Test: `packages/core/test/intakes.test.ts`, `packages/core/test/validate*.test.ts` (по месту существующих тестов `intake.commit`), `packages/storage-postgres/test/intakes.test.ts`, `packages/storage-postgres/test/restore.test.ts`

**Interfaces:**
- Produces:
  - `interface DraftNewTag { id: Id; name: string }`
  - `DraftNewItem.tagIds?: Id[]` — id существующих тегов и/или `DraftNewTag.id` этого черновика.
  - `IntakeDraftContent.newTags?: DraftNewTag[]` — поля необязательные: черновики, сохранённые раньше, их не имеют; везде читать как `?? []`.
  - `intake.commit`: `newTags: { id: Id; name: string }[]` и `newItems[].tagIds: Id[]`.
  - `pruneNewItems` выкидывает и новые теги, на которые не ссылается ни один оставшийся новый предмет.

- [ ] **Step 1: Write failing tests (core)**
  - `resolveIntake`: новый предмет с `tagIds: [<id нет ни в снимке, ни в newTags>]` → строки этого предмета `{ kind: 'problem', code: 'invalid_value' }`; новый тег с пустым или длиннее `MAX_NAME_LENGTH` именем → то же.
  - `buildIntakeCommit`: предмет с существующим тегом `SMD` и новым тегом `{ id: T1, name: 'Kit A' }` → `command.newTags` = `[{ id: T1, name: 'Kit A' }]`, `newItems[0].tagIds` = `[smdId, T1]`.
  - новый тег `'smd'` при существующем `SMD` → в `newTags` его нет, в `tagIds` стоит `smdId` (сравнение как `same` в `validate.ts`: trim + без регистра).
  - новый тег, на который ссылается только удалённая строка → нет в `newTags` (через `pruneNewItems`).
  - черновик без `tagIds` / `newTags` (старый формат) → `newTags: []`, `tagIds: []`.
  - `snapshotAfterIntake` → новые теги в `tags`, новые предметы с `tagIds`.
  - `validate`: `newTags` с повтором id → `invalid_option`; имя совпадает с существующим чужим тегом → `duplicate_name`; тег, созданный этой же командой (повтор), проходит; `newItems[].tagIds` с id, которого нет ни в снимке, ни в `newTags` → `not_found`.
- [ ] **Step 2: Run** `pnpm vitest run packages/core` — новые тесты FAIL.
- [ ] **Step 3: Implement** типы и функции из Interfaces. `checkIntakeCommit` проверяет теги до предметов; `checkIntakeItems` проверяет `tagIds` против снимка и `newTags`.
- [ ] **Step 4: Write failing tests (storage)**
  - проведение черновика с новым тегом и существующим → в снимке после записи тег создан один раз, у нового предмета оба тега; повтор той же команды (неизвестный исход) не создаёт тег и связи второй раз;
  - `renameIntakeIds` переименовывает `newTags[].id` и `newItems[].tagIds`; черновик без этих полей проходит восстановление без ошибок и остаётся без них.
- [ ] **Step 5: Implement SQL.** В `intake.commit`: вставка `tags` (`on conflict (id) do nothing`, под `PENDING`) до предметов; `item_tags` — от строк, которые вставил CTE предметов (как `item.create` в `commands/items.ts`, чтобы повтор ничего не добавлял). `renameIntakeIds` — новые поля.
- [ ] **Step 6: Run** `pnpm vitest run packages/core packages/storage-postgres --maxWorkers=3`, затем один раз набор соответствия Neon (`ANTRESOL_NEON_TEST_URL`), `pnpm typecheck`, `pnpm lint` — PASS.
- [ ] **Step 7: Commit** `feat(core,storage): tags on new items of intake drafts, created by the commit`.

---

### Task 2: Пакет `@antresol/kit`: общие модули, ключ подключения, выбор хранилища фото

Механический перенос плюс две маленькие функции. Ревью — лёгкое.

**Files:**
- Create: `packages/kit/package.json` (`@antresol/kit`, `exports: { ".": "./src/index.ts" }`, зависимости `@antresol/core`, `@antresol/files-*`; скрипт `typecheck`), `packages/kit/tsconfig.json` (как у core)
- Move (git mv) из `packages/app/app/lib/` в `packages/kit/src/`: `amounts.ts`, `attribute-values.ts`, `quick-add.ts`, `views.ts`, `photo-url.ts`, `intake-line.ts`
- Create: на старых местах в `packages/app/app/lib/` — по одной строке `export * from '@antresol/kit/<module>'` (или через индекс kit — на выбор исполнителя; импорты приложения и его тесты не меняются)
- Create: `packages/kit/src/connection-key.ts`, `packages/kit/src/file-store.ts`, `packages/kit/src/index.ts`
- Modify: `packages/app/package.json` (зависимость `@antresol/kit`), `packages/app/app/lib/connection-share.ts` (`SharedConnection` = `ConnectionSettings`), `packages/app/app/lib/workspace.ts` (`defaultFileStore` для Neon вызывает `createFileStore`)
- Test: `packages/kit/test/connection-key.test.ts`, `packages/kit/test/file-store.test.ts`

**Interfaces:**
- Produces:
  - всё, что экспортировали перенесённые модули, — из `@antresol/kit` под теми же именами (`parseAmountText`, `amountExample`, `parseMoneyText`, `parseAttributeInput`, `searchRows`, `SearchRow`, `existingMatches`, `buildDraftLine`, `LineForm`, `BuiltLine`, `withLine`, `withoutLine`, `duplicateWarning`, `alreadyInDraft`, `attributesFrom`, `priceText` и т. д.);
  - `type ConnectionSettings = { name: string; connectionString: string; photoStore?: PhotoStore; uploadcarePublicKey?: string | null; uploadcareCdnBase?: string | null; cloudinaryCloudName?: string | null; cloudinaryUploadPreset?: string | null; imgurClientId?: string | null; imgbbApiKey?: string | null }` и `type PhotoStore = 'uploadcare' | 'cloudinary' | 'imgbb' | 'imgur'` (приложение импортирует `PhotoStore` отсюда);
  - `CONNECTION_KEY_PREFIX = 'antresol-connect-v1:'`;
  - `encodeConnectionKey(s: ConnectionSettings): string`;
  - `decodeConnectionKey(text: string): ConnectionSettings` — бросает `Error` с текстом без содержимого ключа;
  - `createFileStore(s: ConnectionSettings, fetchImpl?: typeof fetch): FileStore | null`.

- [ ] **Step 1: Write failing tests**
  - `decodeConnectionKey(encodeConnectionKey(s))` равно `s` для набора с ImgBB и для набора только со строкой подключения;
  - пробелы и перевод строки вокруг ключа допускаются;
  - чужой префикс, испорченный base64, JSON без `connectionString` или со строкой не `postgres://` / `postgresql://`, неизвестный `photoStore` → бросает, и `message` не содержит ни строки подключения, ни ключа;
  - `createFileStore`: `imgbb` с ключом → `provider === 'imgbb'`; `imgbb` без ключа → `null`; без `photoStore` и с ключом Uploadcare → `uploadcare`; без ключей → `null`.
- [ ] **Step 2: Run** `pnpm vitest run packages/kit` — FAIL.
- [ ] **Step 3: Implement** перенос (`git mv`, реэкспорты), затем `connection-key.ts` и `file-store.ts` (логика выбора — та, что сейчас в `defaultFileStore` для Neon).
- [ ] **Step 4: Run** `pnpm vitest run packages/kit packages/app --maxWorkers=3`, `pnpm typecheck`, `pnpm lint` — PASS; `pnpm build` проходит (приложение собирается с новым пакетом).
- [ ] **Step 5: Commit** `refactor: shared @antresol/kit for the app and the MCP server; connection key and photo store choice`.

---

### Task 3: Теги в шторке строки поступления (приложение)

После задач 1 и 2. Параллельно с задачами 4 и 5. Без отдельного ревью (UI), в итоговом ревью.

**Files:**
- Modify: `packages/kit/src/intake-line.ts` (`LineForm`, `buildDraftLine`, `withLine`, `withoutLine`/`restoreLine`)
- Modify: `packages/app/app/components/IntakeLineSheet.vue` (состояние 4, новый предмет)
- Modify: `packages/app/app/components/TagPicker.vue` (теги черновика рядом с тегами снимка)
- Modify: `packages/app/i18n/locales/en.json` (`intakes.line.tags*`)
- Test: `packages/app/test/intake-line.test.ts`

**Interfaces:**
- Consumes: `DraftNewTag`, `DraftNewItem.tagIds`, `IntakeDraftContent.newTags` (задача 1).
- Produces:
  - `LineForm.newTags: DraftNewTag[]` — новые теги, которые форма добавила;
  - `withLine(draft, line, newItem, newTags?: DraftNewTag[])` кладёт новые теги в `draft.newTags` (без повторов по id) и прогоняет `pruneNewItems`;
  - `TagPicker` — необязательный проп `extraTags: { id: Id; name: string }[]`, показываются и ищутся как обычные.

- [ ] **Step 1: Write failing tests** в `intake-line.test.ts`:
  - `buildDraftLine` переносит `newItem.tagIds` как есть;
  - `withLine` с новым тегом → он в `draft.newTags`; повторный `withLine` той же строки тег не дублирует;
  - удаление последней строки предмета с новым тегом (`withoutLine`) → тег уходит из `draft.newTags`; `restoreLine` возвращает его.
- [ ] **Step 2: Run** `pnpm vitest run packages/app/test/intake-line.test.ts` — FAIL.
- [ ] **Step 3: Implement.** В шторке у нового предмета строка-сводка «Tags · SMD, Kit A» / «Tags · add ›», раскрывается в `TagPicker`. «+ Add tag» (`create`) не вызывает `tag.create`: создаёт `DraftNewTag { id: newId(), name }`, добавляет его в `newItem.tagIds` и в форму. Правка тегов из любой строки меняет общий новый предмет, как имя и атрибуты.
- [ ] **Step 4: Run** тот же файл, `pnpm vitest run packages/app --maxWorkers=3`, `pnpm typecheck`, `pnpm lint` — PASS. Два снимка: шторка нового предмета с раскрытыми тегами, 1280 px и 360 px.
- [ ] **Step 5: Commit** `feat(app): tags for new items in the intake line sheet; new tags are created by the commit`.

---

### Task 4: «Connect AI» в настройках источника

После задачи 2. Параллельно с задачами 3 и 5. Без отдельного ревью.

**Files:**
- Create: `packages/app/app/components/ConnectAiSheet.vue`
- Modify: `packages/app/app/pages/settings/index.vue` (кнопка рядом с «Share» у источника `kind === 'neon'`; у демо-источника кнопки нет)
- Modify: `packages/app/i18n/locales/en.json` (`connectAi.*`)
- Test: `packages/app/test/connect-ai.test.ts`

**Interfaces:**
- Consumes: `encodeConnectionKey`, `ConnectionSettings` (задача 2).
- Produces: `connectionSettingsOf(config: SourceConfig): ConnectionSettings` в `packages/app/app/lib/connection-share.ts` (те же поля, что уже уходят в «Share»).

- [ ] **Step 1: Write failing test:** `decodeConnectionKey(encodeConnectionKey(connectionSettingsOf(config)))` содержит строку подключения и ключ ImgBB конфига и не содержит `id` и `createdAt`.
- [ ] **Step 2: Run** `pnpm vitest run packages/app/test/connect-ai.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Шторка: заголовок «Connect AI», абзац «Lets an AI assistant on this computer (Claude Desktop, Claude Code and other MCP apps) read this source and prepare intake drafts. You review and commit them here.», кнопка «Copy connection key» (`navigator.clipboard.writeText`, тост «Copied»), предупреждение «The key gives full access to this source. Paste it only into the assistant's settings — never into a chat.», ссылка «Download and setup» на `https://github.com/antresol-dev/antresol/releases/latest`.
- [ ] **Step 4: Run** тест, `pnpm typecheck`, `pnpm lint` — PASS. Два снимка открытой шторки, 1280 px и 360 px (источник Neon можно подставить фиктивным конфигом в dev; ключ на снимке не виден — его в шторке и нет).
- [ ] **Step 5: Commit** `feat(app): Connect AI copies the source's connection key for the MCP server`.

---

### Task 5: `@antresol/mcp`: каркас, настройки, кеш снимка, инструменты чтения

После задачи 2 (задача 1 уже влита). Параллельно с задачами 3 и 4. Ревью — на сильной модели (кеш и ошибки).

**Files:**
- Create: `packages/mcp/package.json` (`@antresol/mcp`, `type: module`, зависимости `@antresol/core`, `@antresol/kit`, `@antresol/storage-postgres`, `@modelcontextprotocol/sdk`, `zod`; dev: `@electric-sql/pglite`; скрипт `typecheck`), `packages/mcp/tsconfig.json`, `packages/mcp/vitest.config.ts` (как у storage-postgres, без env)
- Create: `packages/mcp/src/config.ts`, `src/source.ts`, `src/context.ts`, `src/errors.ts`, `src/shape.ts`, `src/tools/read.ts`, `src/server.ts`, `src/main.ts`
- Test: `packages/mcp/test/fixture.ts`, `test/config.test.ts`, `test/source.test.ts`, `test/read.test.ts`, `test/protocol.test.ts`

**Interfaces:**
- Consumes: `decodeConnectionKey`, `searchRows` и прочее из kit; `openPostgresStorage`, `createNeonHttpExecutor`, `createPgliteExecutor`.
- Produces:
  - `config.ts`: `interface ServerConfig { connection: ConnectionSettings | null; connectionProblem: 'missing' | 'invalid' | null; photosDir: string; stateDir: string }`; `readConfig(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): ServerConfig`; `defaultPhotosDir(platform, env, home): string`; `stateDir` по умолчанию `<home>/.antresol`.
  - `source.ts`: `interface Source { inventories(): Promise<Inventory[]>; snapshot(inventoryId: Id): Promise<InventorySnapshot>; intakes(inventoryId: Id): Promise<Intake[]>; refresh(): void; readonly readOnly: boolean }`; `createSource(storage: InventoryStorage, options?: { now?: () => number; revCheckMs?: number }): Source`. `revCheckMs` по умолчанию 3000: в пределах окна снимок отдаётся без запроса; после — `listInventories().rev` (и `intakesRev()` для поступлений), перечитывание только при смене.
  - `context.ts`: `interface ToolContext { source: Source | null; storage: InventoryStorage | null; config: ServerConfig; actor: () => Actor; files: FileStore | null; now: () => Date }`; `resolveInventory(ctx, arg?: string): Promise<{ inventory: Inventory; snapshot: InventorySnapshot }>` — по id или имени (без регистра); один инвентарь — берётся сам; несколько без аргумента — `ToolError` со списком «id — name».
  - `errors.ts`: `class ToolError extends Error`; `toToolResult(e: unknown, secrets: string[]): CallToolResult` — `isError: true`, текст без секретов (каждая строка из `secrets` заменяется на `[hidden]`), `StorageError`/`FileError` по коду в человеческий текст.
  - `tools/read.ts`: `getOverview(ctx, { inventory? })` (инвентари с валютой; папки `{ id, path, items }`; атрибуты `{ id, name, kind, unit, options }`; теги; единицы встроенные и свои `{ key, symbol, name }`; `photos: { store: provider | null, folder }`), `search(ctx, { query, inventory?, limit? })` (по умолчанию 20, максимум 50), `getItem(ctx, { item })` (плюс `receipts` — последние 5 поступлений предмета из `loadMovements`: дата, количество, цена, ссылка, id поступления), `getFolder(ctx, { folder, inventory? })` (id или путь «A/B», `''` — корень; предел 200 предметов и `more: true`), `listIntakes(ctx, { inventory?, query?, status? })`, `getIntake(ctx, { intake })`, `refresh(ctx)`. Возвращают простые объекты (JSON).
  - `shape.ts`: компактные формы — `folderPath(s, folderId): string`, `amountText(s, q, unitKey): string` (через `formatAmount`), `intakeView(s, intake): IntakeView` — см. Step 5.
  - `server.ts`: `createServer(ctx: ToolContext): McpServer` — регистрирует инструменты (zod-схемы входа, описания на английском, коротко: что делает и когда звать; `get_overview` — «call first»), `instructions` сервера (2–4 предложения: только черновики, человек проводит в приложении, начинать с `get_overview`). `actor` берёт `clientInfo.name` после `initialize`.
  - `main.ts`: читает `readConfig(process.env, process.platform, os.homedir())`, при наличии ключа — `openPostgresStorage(createNeonHttpExecutor(connectionString))`, затем `StdioServerTransport`. Ошибка открытия базы не роняет процесс: инструменты отвечают ею.

- [ ] **Step 1: Write fixture** `test/fixture.ts`: `makeContext(options?)` — PGlite в памяти, `openPostgresStorage`, засев командами: инвентарь «Electronics» (RUB), папки `Passives/Resistors`, `Modules`; числовой атрибут Resistance (Ω) и Power (W); тег `SMD`; предмет «Resistor 0.25 W» в `Passives/Resistors` с осью Resistance, варианты 4.7 kΩ (остаток 40) и 10 kΩ; предмет «ESP32 DevKit» в `Modules` без осей (остаток 3) с тегом `SMD`; `options.secondInventory` добавляет «Workshop»; `options.archiveSecond` архивирует его.
- [ ] **Step 2: Write failing tests**
  - `config`: без `ANTRESOL_CONNECTION` → `connectionProblem: 'missing'`; мусор → `'invalid'`; `defaultPhotosDir('darwin', {}, '/Users/a')` = `path.join('/Users/a','Pictures','Antresol')`; `('win32', {}, 'C:\\Users\\a')` = `path.win32.join('C:\\Users\\a','Pictures','Antresol')`; `('linux', { XDG_PICTURES_DIR: '/data/pics' }, '/home/a')` = `/data/pics/Antresol`; без XDG — `/home/a/Pictures/Antresol`; `ANTRESOL_PHOTOS_DIR` перекрывает.
  - `source`: два вызова `snapshot` в окне — один `loadInventoryWithRev`; после окна при том же `rev` — без перечитывания; после `apply` другой командой — перечитано; `refresh()` — перечитано сразу.
  - `read`: `getOverview` → папки с путями `Passives/Resistors` и числом предметов, атрибуты с единицами, тег `SMD`, `photos.folder` = `config.photosDir`; `search('4k7')` → первая строка — вариант 4.7 kΩ с остатком 40; `getItem` ESP32 → путь `Modules`, теги `['SMD']`, остаток `3`; `getFolder('Passives/Resistors')` → Resistor 0.25 W; несуществующий путь → `ToolError`.
  - **Review Focus 4:** два инвентаря без `inventory` → ошибка со списком обоих имён; `inventory: 'workshop'` (регистр) работает.
  - **Review Focus 2:** контекст без соединения (`connectionProblem: 'missing'`) → каждый инструмент отвечает `isError` с текстом «Settings → Connect AI»; ошибка хранилища с текстом, содержащим строку подключения, в `toToolResult` выходит с `[hidden]` вместо неё.
  - `protocol`: `Client` + `InMemoryTransport` из SDK: `listTools` содержит `get_overview`, `search`, `get_item`, `get_folder`, `list_intakes`, `get_intake`, `refresh`; вызов `get_overview` возвращает JSON в `content[0].text`; `actor()` после `initialize` клиентом `{ name: 'Test Client' }` = `{ device: 'Test Client · MCP' }`.
- [ ] **Step 3: Run** `pnpm vitest run packages/mcp` — FAIL.
- [ ] **Step 4: Implement** по Interfaces. Ответ инструмента — `content: [{ type: 'text', text: JSON.stringify(result) }]` (без отступов).
- [ ] **Step 5: `IntakeView`** (`shape.ts`), используется `get_intake` здесь и ответами записи в задаче 6:
  `{ id, inventory, status, header, createdBy, updatedBy, updatedAt, ok, newItems: [{ id, name, folder, unit, attributes: [{ name, value | null, axis }], tags: string[], looksLike: { itemId, name, variant, have } | null }], lines: [{ id, kind: 'add' | 'newValue' | 'newItem' | 'problem', problem: string | null, itemId, item, values, amount, price, url, photo, alreadyInDraft }] }` — `looksLike` из `duplicateWarning(s, newItem, newItem.name)`, `alreadyInDraft` из kit, `problem` — текст по коду. У проведённого — строки из `CommittedLine` без `problem`/`alreadyInDraft`.
- [ ] **Step 6: Run** `pnpm vitest run packages/mcp`, `pnpm typecheck`, `pnpm lint` — PASS.
- [ ] **Step 7: Commit** `feat(mcp): stdio server with a cached snapshot and read tools`.

---

### Task 6: Инструменты записи черновиков

После задач 3 и 5. Ревью — на сильной модели (запись и конфликты).

**Files:**
- Create: `packages/mcp/src/draft-edit.ts`, `packages/mcp/src/tools/drafts.ts`, `packages/mcp/src/messages.ts`
- Modify: `packages/mcp/src/server.ts`
- Test: `packages/mcp/test/drafts.test.ts`, `packages/mcp/test/messages.test.ts`

**Interfaces:**
- Consumes: `buildDraftLine`, `LineForm`, `withLine`, `withoutLine`, `attributesFrom` (kit, задача 3), `resolveIntake`, `emptyIntakeDraft`, `newId`, `IntakeView` (задача 5).
- Produces:
  - `draft-edit.ts`: `editDraft(ctx, intakeId: Id, edit: (draft: IntakeDraftContent, header: IntakeHeader, s: InventorySnapshot) => { draft: IntakeDraftContent; header: IntakeHeader }): Promise<IntakeView>` — читает черновик свежим (`refresh` перед чтением), применяет `edit`, пишет `saveIntakeDraft(…, draftRev, ctx.actor())`; `changed` → ещё одна попытка с нового `current`; второй `changed` → `ToolError('The draft is being edited in the app right now. Try again in a moment.')`; `committed` → `ToolError` «already committed»; `ctx.source.readOnly` → `ToolError` «update Antresol MCP»; инвентарь в архиве → `ToolError`.
  - `messages.ts`: `messageFor(key: string, params?: Record<string, string>): string` — текст из `packages/app/i18n/locales/en.json` (импорт JSON, подстановка `{name}`; для ключей с `|` — первая форма); неизвестный ключ — сам ключ.
  - `tools/drafts.ts`:
    - `createIntake(ctx, { inventory?, shop?, orderNumber?, purchasedOn?, note? })` → `IntakeView` (дата по умолчанию — сегодня по местному времени, `YYYY-MM-DD`);
    - `updateIntakeHeader(ctx, { intake, shop?, orderNumber?, purchasedOn?, note? })` — только переданные поля; через `updateIntakeHeader` хранилища (он и у проведённого);
    - `addIntakeLines(ctx, { intake, newItems?, lines })`, где `newItems: { ref: string; name: string; folder?: string /* id или путь */; unit?: string /* ключ или символ, по умолчанию 'pcs' */; attributes?: { attribute: string /* id или имя */; value?: string; axis?: boolean }[]; tags?: string[] /* id или имя; неизвестное имя → новый тег */ }[]` и `lines: { item: string /* id предмета, id нового предмета черновика или ref */; values?: Record<string, string> /* атрибут-ось (id или имя) → текст */; amount: string; price?: string; url?: string; photo?: string; replacePhoto?: boolean }[]`;
    - `updateIntakeLine(ctx, { intake, line, values?, amount?, price?, url?, photo?, replacePhoto? })` (`price: ''`/`url: ''` очищают; `photo: ''` убирает фото);
    - `removeIntakeLine(ctx, { intake, line })`;
    - `updateNewItem(ctx, { intake, item, name?, folder?, unit?, attributes?, tags? })`.
  - Все записи **всё или ничего на вызов**: каждая строка проходит `buildDraftLine` (те же проверки, что в шторке); любая ошибка → ничего не записано, `ToolError` со списком «line N: <messageFor(errorKey, params)>». `photo` в этой задаче принимается только как `null`/отсутствует (путь — задача 7).

- [ ] **Step 1: Write failing tests** (фикстура задачи 5):
  - `createIntake` → черновик в `listIntakes` с `createdBy` = `'Test Client · MCP'`; `rev` источника не изменился, `intakesRev` изменился.
  - `addIntakeLines` с `{ item: <Resistor>, values: { Resistance: '4k7' }, amount: '10' }` → строка `kind: 'add'`; с `'47k'` → `'newValue'`; новый предмет `{ ref: 'a', name: 'LM358', folder: 'Modules', tags: ['SMD', 'Op-amps'] }` + строка `{ item: 'a', amount: '5' }` → `'newItem'`, в черновике `newTags` с `Op-amps`, у предмета `tagIds` с id `SMD`; новый предмет «Resistor 0.25 W» → `looksLike` указывает на существующий; две строки 4k7 → вторая `alreadyInDraft: true`.
  - строка без `amount` или с `amount: 'abc'` → ничего не записано, ошибка с текстом из `en.json` (`intakes.line.needsAmount` / `quickAdd.invalidAmount`); `price: '35,50'` → `totalPrice` 3550.
  - дописывание в черновик, созданный «приложением» (`saveIntakeDraft` с актором `Pixel 10`) → строка добавлена, `createdBy` остался `Pixel 10`.
  - **Review Focus 1:** хранилище-обёртка, у которого `saveIntakeDraft` первый раз отвечает `changed` (с `current` от «другого устройства» с лишней строкой) → правка применена поверх `current`, обе строки на месте; отвечает `changed` дважды → `ToolError` «being edited», в базе только запись «другого устройства»; ни один вызов не передаёт `force: true`.
  - **Review Focus 4:** запись в архивный инвентарь → `ToolError`, ничего не записано.
  - `removeIntakeLine` последней строки нового предмета → предмет и его новый тег ушли из черновика.
  - проведённое поступление: `addIntakeLines` → `ToolError` «already committed».
  - `messageFor('intakes.line.needsValue', { name: 'Resistance' })` совпадает с текстом `en.json` с подстановкой.
- [ ] **Step 2: Run** `pnpm vitest run packages/mcp/test/drafts.test.ts packages/mcp/test/messages.test.ts` — FAIL.
- [ ] **Step 3: Implement** по Interfaces; регистрация инструментов `create_intake`, `update_intake_header`, `add_intake_lines`, `update_intake_line`, `remove_intake_line`, `update_new_item` в `server.ts`. Описание `add_intake_lines` говорит: искать сначала (`search`), пополнять существующее и добавлять номиналы существующему предмету раньше, чем заводить новый; значения — текстом как у человека («4k7», «2.5 m», «35.50»).
- [ ] **Step 4: Run** `pnpm vitest run packages/mcp`, `pnpm typecheck`, `pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(mcp): intake draft tools: create, add and edit lines and new items, never over another device's edits`.

---

### Task 7: Фото: папка, показ модели, загрузка в хранилище

После задачи 6. Ревью — лёгкое по коду, но с проверкой Review Focus 3.

**Files:**
- Create: `packages/mcp/src/images.ts`, `packages/mcp/src/photo-state.ts`, `packages/mcp/src/tools/photos.ts`
- Modify: `packages/mcp/src/tools/drafts.ts` (поле `photo` в строках), `packages/mcp/src/server.ts`, `packages/mcp/src/main.ts` (`ctx.files = createFileStore(connection)`)
- Test: `packages/mcp/test/images.test.ts`, `test/photos.test.ts`, фикстуры `packages/mcp/test/fixtures/` (маленькие JPEG, PNG, WebP, HEIC; JPEG 6000×4000 генерируется в тесте кодеком)

**Interfaces:**
- Produces:
  - `images.ts`: `decodeImage(bytes: Uint8Array, name: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }>` (JPEG, PNG, WebP, HEIC/HEIF; иначе `ToolError` «not an image this server can read: <name>»); `forStore(bytes, name): Promise<{ blob: Blob; name: string; width: number; height: number }>` (≤ 2048, WebP, при неудаче JPEG); `forModel(bytes, name): Promise<{ data: string /* base64 */; mimeType: 'image/jpeg' }>` (≤ 1568, ≤ 1 МБ base64). Кодеки на WASM; модули WASM инициализируются из файлов, прочитанных `fs` (рядом со сборкой — см. задачу 8), а не через `fetch`.
  - `photo-state.ts`: `createPhotoState(stateDir: string): PhotoState` с `get(sha256: string): StoredUpload | null`, `put(sha256, upload: StoredUpload & { intakeId: Id; lineId: Id; path: string })`, `usedPaths(): Map<string, { intakeId: Id; lineId: Id }>`; файл `<stateDir>/mcp-photos.json`, запись атомарно (временный файл + rename).
  - `tools/photos.ts`: `listPhotos(ctx, { folder?, onlyNew? })` → `{ folder, photos: [{ path, name, bytes, modifiedAt, usedIn: { intakeId, lineId } | null }] }` (расширения jpg/jpeg/png/webp/heic/heif без учёта регистра, новые первыми, предел 200 и `more`); `viewPhotos(ctx, { paths: string[] /* 1–6 */ })` → `content` с `image`-блоками и подписью-путём перед каждым; `attachPhoto(ctx, path, intakeId, lineId): Promise<DraftLinePhoto>` — sha256 файла → из состояния или `forStore` + `ctx.files.upload(blob, name)` → `put`.
  - В `addIntakeLines`/`updateIntakeLine`: `photo` — путь (абсолютный или относительно папки фото); загрузки делаются до `editDraft`; `replacePhoto` → `DraftLinePhoto.replace`.

- [ ] **Step 1: Write failing tests**
  - `forStore` JPEG 6000×4000 → длинная сторона 2048, тип `image/webp`; HEIC-фикстура → декодируется; `forModel` того же JPEG → ≤ 1568 и base64 ≤ 1 048 576 символов.
  - **Review Focus 3:** текстовый файл с расширением `.jpg` → `ToolError` с именем файла; несуществующий путь → `ToolError` «file not found»; сервер продолжает отвечать на следующий вызов.
  - `listPhotos` по временной папке (`ANTRESOL_PHOTOS_DIR` в tmp): `.txt` не показан, `IMG.JPG` показан; отсутствующая папка по умолчанию создаётся.
  - поддельный `FileStore` со счётчиком: один и тот же файл в двух строках (и в двух вызовах) → одна загрузка; после этого `listPhotos` показывает `usedIn`; состояние переживает новый `createPhotoState` на ту же папку.
  - без хранилища фото (`ctx.files === null`) строка с `photo` → `ToolError` «no photo store», строки без фото пишутся.
  - `viewPhotos` с 7 путями → `ToolError`; с 2 → четыре блока (текст, image, текст, image).
- [ ] **Step 2: Run** `pnpm vitest run packages/mcp/test/images.test.ts packages/mcp/test/photos.test.ts` — FAIL.
- [ ] **Step 3: Implement**; регистрация `list_photos`, `view_photos`. Если выбранный кодек HEIC не работает в Node без платформенных бинарников — сообщить в отчёте и оставить HEIC с понятной ошибкой «convert to JPEG», остальное не блокировать.
- [ ] **Step 4: Run** `pnpm vitest run packages/mcp --maxWorkers=3`, `pnpm typecheck`, `pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(mcp): photos from a folder: shown to the assistant, uploaded once to the source's photo store`.

---

### Task 8: Сборка, `.mcpb`, выпуск через GitHub Actions, README

После задачи 7. Без отдельного ревью (итоговое ревью смотрит workflow).

**Files:**
- Create: `packages/mcp/vite.config.ts` (библиотечная сборка `src/main.ts` → `dist/server.mjs`, target `node20`, все зависимости внутрь, `.wasm` кодеков копируются в `dist/`)
- Create: `packages/mcp/mcpb/manifest.json`, `packages/mcp/mcpb/icon.png` (из `Claude outputs/antresol-icon.svg` → PNG 256×256; исходник не коммитить)
- Create: `packages/mcp/scripts/pack.mjs` (собирает каталог `dist/bundle/` — `manifest.json`, `server/` со сборкой и `.wasm`, иконка — и вызывает `mcpb pack`)
- Create: `.github/workflows/mcp-release.yml`
- Create: `packages/mcp/README.md`; Modify: корневой `README.md` (раздел «AI assistant (MCP)» со ссылкой)
- Modify: `packages/mcp/package.json` (скрипты `build`, `pack`; dev: `@anthropic-ai/mcpb`)
- Test: `packages/mcp/test/bundle.test.ts`

**Interfaces:**
- Produces:
  - `manifest.json`: `name: "antresol"`, `display_name: "Antresol"`, `server: { type: "node", entry_point: "server/server.mjs", mcp_config: { command: "node", args: ["${__dirname}/server/server.mjs"], env: { ANTRESOL_CONNECTION: "${user_config.connection_key}", ANTRESOL_PHOTOS_DIR: "${user_config.photos_dir}" } } }`, `user_config.connection_key` (`type: "string"`, `sensitive: true`, `required: true`, `title: "Antresol connection key"`, описание «Settings → Connect AI in the Antresol app»), `user_config.photos_dir` (`type: "directory"`, `required: false`, `title: "Photos folder"`), `compatibility.runtimes.node: ">=20"`, `version` = версия `packages/mcp/package.json`. Пустой `ANTRESOL_PHOTOS_DIR` значит «по умолчанию» (`readConfig` уже так читает — проверить тестом задачи 5, если нет — добавить).
  - Workflow: `on: push: tags: ['mcp-v*']` и `workflow_dispatch`; шаги как в `ci.yml` (pnpm, Node 24, `--frozen-lockfile`), затем `pnpm test`, `pnpm --filter @antresol/mcp build`, `pnpm --filter @antresol/mcp pack`, создание релиза с `antresol.mcpb` и `antresol-mcp.mjs` (+ `.wasm` архивом `antresol-mcp-node.zip`, если сборка не однофайловая) через `gh release create` с `GITHUB_TOKEN`, `permissions: contents: write`. Тег должен совпадать с версией пакета, иначе шаг падает.

- [ ] **Step 1: Write failing test** `bundle.test.ts` (собирает через `pnpm --filter @antresol/mcp build` в `beforeAll`, таймаут 120 с): процесс `node dist/server.mjs` без `ANTRESOL_CONNECTION` отвечает на `initialize` и `tools/list` по stdio (клиент SDK + `StdioClientTransport`), в списке есть `add_intake_lines` и `view_photos`; `get_overview` → `isError` с «Connect AI».
- [ ] **Step 2: Run** `pnpm vitest run packages/mcp/test/bundle.test.ts` — FAIL.
- [ ] **Step 3: Implement** сборку, манифест, `pack.mjs`, workflow. `mcpb validate` на манифест проходит.
- [ ] **Step 4: README** `packages/mcp/README.md`:
  - что умеет (читает, пишет только черновики; проводите в приложении);
  - где взять ключ (Settings → Connect AI);
  - Claude Desktop: скачать `antresol.mcpb` из Releases, открыть, вставить ключ;
  - Claude Code: `claude mcp add antresol --env ANTRESOL_CONNECTION=<key> -- node /path/to/antresol-mcp.mjs`;
  - Cursor (`~/.cursor/mcp.json`), VS Code (`.vscode/mcp.json` / пользовательские настройки), Codex CLI (`~/.codex/config.toml`) — фрагменты с `command`, `args`, `env`; пометка «not tested by us»;
  - фото: положите в папку (путь по умолчанию на каждой ОС) или назовите путь в чате; фото, вложенные прямо в чат, до сервера не доходят;
  - ключ — секрет: только в настройки, не в чат.
- [ ] **Step 5: Run** `pnpm vitest run packages/mcp`, `pnpm --filter @antresol/mcp pack` локально (получается `antresol.mcpb`), `pnpm typecheck`, `pnpm lint` — PASS. Workflow не запускается (нужны тег и пуш — по команде владельца).
- [ ] **Step 6: Commit** `build(mcp): one-file server, .mcpb bundle, release workflow on mcp-v* tags, setup README`.

---

### Task 9: Промпт разбора фото и проверка на настоящих фото

Последняя. Текст согласуется с владельцем.

**Files:**
- Create: `packages/mcp/src/prompts.ts`
- Modify: `packages/mcp/src/server.ts` (prompt `intake_from_photos` с необязательными аргументами `folder` и `intake`), `packages/mcp/src/tools/*.ts` (краткие правила в описаниях, если их там ещё нет)
- Test: `packages/mcp/test/protocol.test.ts` (дополнить)

**Interfaces:**
- Produces: `intakeFromPhotosPrompt(args: { folder?: string; intake?: string }): string`.

- [ ] **Step 1: Write failing test:** `listPrompts` содержит `intake_from_photos`; `getPrompt` с `folder: '/x'` возвращает одно сообщение пользователя, где есть `/x`, `get_overview`, `list_photos`, `view_photos`, `search`, `add_intake_lines`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** текст по спеке §8: начать с `get_overview`; `list_photos` (только новые), смотреть пачками по 3–6 (`view_photos`); количество — со стикера, размер — по линейке; для каждого пакетика `search`; пополнение и новый номинал существующего предмета — раньше нового предмета; не угадывать: сомнения — в чат, в заметку черновика — только то, что стоит сохранить; одно поступление на пачку (или дописать в `intake`); в конце — сводка (строк, новых предметов, сомнений) и напоминание, что проводит человек в приложении.
- [ ] **Step 4: Run** `pnpm vitest run packages/mcp`, `pnpm typecheck`, `pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(mcp): intake_from_photos prompt`.
- [ ] **Step 6: Проверка владельцем** (не исполнителем): `.mcpb` в Claude Desktop и сборка в Claude Code с настоящим источником; 3–5 настоящих фото → черновик → проверка и проведение в приложении. Правки текста промпта — по итогам, отдельным коммитом.

---

## Порядок и параллельность

1. Задача 1.
2. Задача 2.
3. Задачи 3, 4, 5 — параллельно, в своих worktree от `mcp`.
4. Задача 6 (нужны 3 и 5), затем 7, 8, 9.
5. Итоговое ревью ветки на сильной модели — двумя половинами параллельно: данные и запись (задачи 1, 5, 6, 7) и приложение со сборкой (2, 3, 4, 8, 9).

## Перенос на потом (carry-over)

- Загрузка фото с телефона в черновик («неразобранные фото») и разбор их через MCP.
- Новые папки и атрибуты из черновика.
- Удалённый MCP (для ChatGPT в вебе и мобильных клиентов).
- Перетаскивание фото в окно чата (MCP Apps / расширение загрузки файлов MCP), когда клиенты это поддержат.
