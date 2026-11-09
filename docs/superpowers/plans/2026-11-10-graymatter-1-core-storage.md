# GrayMatter — План 1: ядро и хранилище Postgres

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Протестированные пакеты `@graymatter/core` (модель, правила, расчёты, поиск) и `@graymatter/storage-postgres` (схема, миграции, все команды и загрузка инвентаря), плюс драйверы Neon и проверенный спайком доступ к Neon из браузера.

**Architecture:** Монорепозиторий pnpm, пакеты отдаются исходниками TypeScript, без сборки. `core` не зависит ни от Vue, ни от БД. Хранилище описано в `core` как интерфейс `InventoryStorage` с единственной точкой записи `apply(command)`. `storage-postgres` переводит каждую команду в пакет SQL-выражений и выполняет его атомарно через узкий интерфейс `PgExecutor`. У `PgExecutor` три реализации: PGlite для тестов, Neon по WebSocket, Neon по HTTP. Drizzle используется для описания схемы и генерации миграций. Запросы пишутся на SQL через свой тег `sql`: так одна и та же команда без изменений выполняется любым из трёх драйверов, а это требование спеки (риск 1, «один пакет без чтения»).

**Tech Stack:** Node ≥ 22, pnpm workspaces, TypeScript (strict, ESM), Vitest, drizzle-orm + drizzle-kit (pg-core), @electric-sql/pglite, @neondatabase/serverless, uuidv7, minisearch, Vite (только для спайка). Версии — последние стабильные на момент установки. Фактические версии фиксируются в `package.json`.

**Spec:** `docs/superpowers/specs/2026-11-10-graymatter-revival-design.md`

## Последовательность планов

Этот план — первый из четырёх. Следующие пишутся после завершения предыдущего, с учётом его результатов, в том числе спайка.

1. **Ядро и хранилище** (этот).
2. **Каркас приложения:**
   - Nuxt 4 SPA, PWA, Tailwind + shadcn-vue, темы светлая/тёмная, i18n (`en`);
   - настройки: источники, устройство, тема;
   - загрузка и копия инвентаря на устройстве;
   - экран папки и управление папками, поиск.
3. **Предметы:** быстрое добавление, карточка, журнал, варианты, атрибуты, теги, единицы, архив. Фото — интерфейс файлов в `core` плюс адаптер Uploadcare.
4. **Выпуск:** GitHub Pages, удаление `api/` и `web/`, README, e2e.

## Перед началом (решено владельцем)

1. **Пакеты ставятся из публичного реестра.** В корне проекта закоммичен `.npmrc` с `registry=https://registry.npmjs.org/` (Task 1). Глобальный npm на машине смотрит в рабочий реестр, недоступный без VPN, а проектный `.npmrc` это перекрывает.
2. **Базы Neon пока нет**, владелец создаст её позже. Это отдельная база с именем на `_test`, строка подключения — только в `GM_NEON_TEST_URL`, никогда не коммитится. До её появления:
   - **Task 2 (спайк) откладывается.** Выполняется, когда владелец даст строку подключения.
   - **Task 11:** код драйверов пишется и проверяется тестами без базы (`assertTestDatabase`, пропуск теста совместимости). Прогон на Neon откладывается вместе со спайком.
   - Порядок выполнения сейчас: Task 1, затем Tasks 3–11.

## Global Constraints

- Своего сервера нет. Всё, что пишется в этом плане, должно работать в браузере. Node-only API (`fs`, `path`, `process` и т.п.) в `src/` не используются, только в тестах и конфигах.
- Идентификаторы — UUID v7, генерируются на устройстве (`newId()`).
- У инвентарей, папок, предметов и вариантов есть `created_at`, `updated_at`, `created_by`, `updated_by`, `archived_at`, `archive_id`. У тегов, атрибутов и своих единиц — только первые четыре. Время ставит база (`now()`). Автор — строка `Actor.device`, например `"Android · Chrome"`.
- Количества хранятся как `numeric(20,6)` и в коде представлены десятичной строкой `Quantity`. Суммы считаются в SQL, в JS — только через `BigInt` в микроединицах. Никакой арифметики на `number`.
- Деньги — целые минорные единицы валюты инвентаря. У получения хранится **сумма за всю партию**, а цена за штуку получается делением.
- Записи журнала не изменяются и не удаляются. Исключение — окончательное удаление предмета, варианта, папки или инвентаря.
- Каждая команда хранилища выполняется как один атомарный пакет выражений, без «прочитать, потом решить, что писать».
- Если версия схемы в базе новее, чем знает приложение, хранилище работает только на чтение (`readOnly = true`), `apply` отклоняется.
- В репозитории нет секретов: `.env*` (кроме `*.example`) в `.gitignore`.
- В Neon не хранятся фото, только ссылки на них.

## Review Focus

1. **Количества с запятой и дробями** («1,5», 0.1 + 0.2, «150cm» при метрах) должны давать точный результат без дрейфа. Тесты в Task 2 и Task 9.
2. **Использование или перенос больше, чем есть в остатке**, должны отклоняться с `insufficient_stock` и ничего не записывать. Тест в Task 4.
3. **Восстановление предмета, чья папка заархивирована позже или отдельно**, должно делать его видимым: архивные папки-предки на пути восстанавливаются. Тест в Task 10.
4. **Имена** из одних пробелов, длиннее 200 символов, на кириллице или с эмодзи: обрезаются, пустые и длинные отклоняются, кириллица ищется. Тесты в Task 4 и Task 5.
5. **База, обновлённая более новой версией приложения, или миграция, упавшая на середине**, должны давать режим только чтения без записи, а миграция — откатываться целиком. Тесты в Task 6.

---

## Структура файлов

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.config.ts, .gitignore
packages/core/
  src/index.ts          реэкспорт всего публичного
  src/ids.ts            newId
  src/quantity.ts       Quantity и десятичная арифметика
  src/money.ts          валюты, parseMoney, unitPrice
  src/units.ts          встроенные единицы, приставки СИ, formatAmount, parseAmount
  src/data/currencies.json
  src/model.ts          сущности и InventorySnapshot
  src/tree.ts           папки: дети, путь, проверка цикла
  src/stock.ts          остатки и цены из StockLine
  src/commands.ts       Command
  src/validate.ts       normalizeCommand, validateCommand, splitVariantNames
  src/storage.ts        InventoryStorage, Actor, SchemaStatus, StorageError
  src/search.ts         createSearch
  test/fixtures.ts      билдеры снапшотов для тестов
packages/storage-postgres/
  drizzle.config.ts
  migrations/           вывод drizzle-kit (0000_init.sql + meta/)
  src/index.ts
  src/sql.ts            тег sql, updateSet
  src/executor.ts       PgExecutor
  src/executors/pglite.ts, neon-ws.ts, neon-http.ts
  src/schema.ts         таблицы Drizzle
  src/migrator.ts       ensureSchema, APP_SCHEMA_VERSION
  src/rows.ts           преобразование строк БД в типы core
  src/queries.ts        listInventories, loadInventory, loadMovements
  src/commands/index.ts toStatements (диспетчер)
  src/commands/{inventory,folders,dictionaries,items,variants,photos,stock,archive}.ts
  src/storage.ts        openPostgresStorage
  test/helpers.ts       makeStorage() на PGlite в памяти
spikes/neon-browser/    одноразовая страница спайка (Vite)
docs/superpowers/spikes/2026-11-neon-browser.md   итоги спайка
```

---

### Task 1: Каркас монорепозитория

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml` (`packages/*`, `spikes/*`), `tsconfig.base.json`, `vitest.config.ts`
- Modify: `.gitignore`: добавить `node_modules/`, `dist/`, `.nuxt/`, `.output/`, `coverage/`, `.env*`, `!.env.example`
- Create: `.npmrc` с одной строкой `registry=https://registry.npmjs.org/`. Создаётся **до** первого `pnpm install`.
- Create: `packages/core/{package.json,tsconfig.json,src/index.ts}`, `packages/storage-postgres/{package.json,tsconfig.json,src/index.ts}`
- Test: `packages/storage-postgres/test/workspace.test.ts`

**Interfaces:**
- Produces:
  - пакеты `@graymatter/core` и `@graymatter/storage-postgres`: `"type": "module"`, `"exports": {".": "./src/index.ts"}`, скрипт `typecheck` = `tsc --noEmit`;
  - корневые скрипты `test` = `vitest run`, `typecheck` = `pnpm -r typecheck`;
  - `export const CORE_VERSION = '0.1.0'` в core.
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `module`/`moduleResolution` = `ESNext`/`Bundler`, `target` `ES2022`, `lib` `["ES2022","DOM"]`, `types` `["vite/client"]` (для `import.meta.glob`).
- `vitest.config.ts`: `test.projects: ['packages/*']`.
- Старые `api/` и `web/` не трогаем, их удалит План 4.

- [ ] **Step 1: Write the failing test** — `workspace.test.ts`: `import { CORE_VERSION } from '@graymatter/core'`; `expect(CORE_VERSION).toBe('0.1.0')`.
- [ ] **Step 2: Run** `pnpm install && pnpm test`. Expected: FAIL (модуль не найден или нет экспорта).
- [ ] **Step 3: Создать файлы каркаса** из блока Files. В `storage-postgres/package.json` зависимость `"@graymatter/core": "workspace:*"`.
- [ ] **Step 4: Run** `pnpm install && pnpm test && pnpm typecheck`. Expected: 1 passed, typecheck без ошибок.
- [ ] **Step 5: Commit** — `chore: scaffold pnpm monorepo with core and storage-postgres packages`

### Task 2: Спайк — Neon из браузера

Одноразовая проверка. Код спайка не переиспользуется, кроме выводов.

**Files:**
- Create: `spikes/neon-browser/{package.json,index.html,src/main.ts}` (Vite, без фреймворка)
- Create: `docs/superpowers/spikes/2026-11-neon-browser.md`

**Interfaces:** нет, это одноразовый код.

- [ ] **Step 1: Сделать страницу.**
  - Поле для строки подключения: хранится только в памяти, никуда не сохраняется.
  - Кнопка «Run» прогоняет два сценария и выводит на страницу время каждого шага в мс.
  - **HTTP:** `neon(url)`:
    1. `select 1` (холодный и повторный);
    2. `CREATE TABLE IF NOT EXISTS gm_spike (id uuid primary key, note text)`;
    3. `sql.transaction([...])` с двумя `INSERT`;
    4. `select count(*)`;
    5. `DELETE`.
  - **WebSocket:** `new Pool({ connectionString })` → `connect()` → `BEGIN` → два `INSERT` → `COMMIT` → `select count(*)` → `DROP TABLE gm_spike`.
  - Проверить, что база в строке подключения оканчивается на `_test`, иначе отказать.
- [ ] **Step 2: Run** `pnpm --filter neon-browser-spike dev --host`. Открыть страницу в Chrome на компьютере и выполнить оба сценария на `GM_NEON_TEST_URL`. Expected: оба сценария без ошибок, время выведено.
- [ ] **Step 3: Проверка на телефоне.** Попросить владельца открыть `http://<ip-компьютера>:5173` в Chrome на Android в той же Wi-Fi-сети и прогнать оба сценария. Expected: владелец сообщает, прошли ли оба сценария, и присылает время.
- [ ] **Step 4: Записать итоги** в `docs/superpowers/spikes/2026-11-neon-browser.md`:
  - работают ли WS и HTTP на компьютере и на телефоне;
  - холодное и тёплое время;
  - версии браузеров;
  - **решение:** основной драйвер — WebSocket, если он работает на телефоне, иначе HTTP.
- [ ] **Step 5: Commit** — `docs: record Neon-from-browser spike results`

### Task 3: Примитивы ядра — id, количества, деньги, единицы

**Files:**
- Create: `packages/core/src/{ids,quantity,money,units}.ts`, `packages/core/src/data/currencies.json`
- Test: `packages/core/test/{ids,quantity,money,units}.test.ts`

**Interfaces:**
- Produces:
  - **ids:** `type Id = string`, `newId(): Id` (пакет `uuidv7`).
  - **quantity:**
    - `type Quantity = string` — каноническая десятичная строка: до 6 знаков после точки, без лишних нулей, `"0"` для нуля, `-` для отрицательных;
    - `parseQuantity(input: string): Quantity | null`;
    - `addQ(a, b)`, `subQ(a, b)`, `negQ(a)` → `Quantity`;
    - `cmpQ(a, b): -1 | 0 | 1`, `isPositiveQ(q): boolean`, `quantityToNumber(q): number` (только для показа).
  - **money:**
    - `interface Currency { code: string; name: string; symbol: string; decimals: number }`;
    - `CURRENCIES: Readonly<Record<string, Currency>>`, `getCurrency(code): Currency | undefined`;
    - `parseMoney(input: string, currency: Currency): number | null` — минорные единицы;
    - `unitPrice(totalMinor: number, quantity: Quantity): number` — минорных единиц за 1 единицу, дробное.
  - **units:**
    - `interface UnitDef { key: string; name: string; symbol: string; prefixPowers: number[] }`;
    - `BUILTIN_UNITS: Record<'pcs'|'m'|'g'|'l', UnitDef>`:
      - `pcs` = Pieces/`pcs`/`[]`;
      - `m` = Meters/`m`/`[-3,-2,3]`;
      - `g` = Grams/`g`/`[-3,3]`;
      - `l` = Liters/`l`/`[-3]`;
    - `SI_PREFIXES: Record<number, { symbol: string; name: string }>` — список из `api/src/prisma/seed.ts`, для −6 символ `µ`;
    - `customUnitKey(id: Id): string` → `` `custom:${id}` ``;
    - `resolveUnit(key: string, custom: CustomUnit[]): UnitDef | undefined` — тип `CustomUnit` из Task 4; до Task 4 объявить его локально и потом заменить импортом;
    - `formatAmount(q: Quantity, unit: UnitDef): string`;
    - `parseAmount(input: string, unit: UnitDef): Quantity | null`.
- `currencies.json` — из `api/src/prisma/data/currencies.json`: только записи с `ISOnum`, поля `name`, `symbol`, `decimals`, ключ — код.
- `quantity`: внутри `BigInt` микроединиц (×10⁶). Запятая принимается как десятичный разделитель, пробелы по краям обрезаются.
- `formatAmount`: степень `p` — наибольшая из `[0, ...prefixPowers]`, при которой `|value| / 10^p ≥ 1` (для нуля `p = 0`). Не больше 3 знаков после точки, хвостовые нули убираются, между числом и символом пробел.
- `parseAmount`: число, затем необязательный пробел, затем необязательный символ приставки из `prefixPowers` единицы (для 10⁻⁶ принимаются `µ` и `u`), затем необязательный символ единицы.

- [ ] **Step 1: Write the failing tests**

```ts
expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const a = newId(), b = newId(); expect(a < b).toBe(true)

expect(addQ('0.1', '0.2')).toBe('0.3')
expect(subQ('96', '59')).toBe('37')
expect(parseQuantity(' 1,5 ')).toBe('1.5')
expect(parseQuantity('007')).toBe('7')
expect(parseQuantity('2.500')).toBe('2.5')
expect(parseQuantity('1.2345678')).toBeNull()
expect(parseQuantity('')).toBeNull()
expect(parseQuantity('abc')).toBeNull()
expect(cmpQ('10', '9')).toBe(1)
expect(isPositiveQ('0')).toBe(false)

const usd = getCurrency('USD')!, jpy = getCurrency('JPY')!
expect(usd.decimals).toBe(2)
expect(Object.keys(CURRENCIES).length).toBeGreaterThanOrEqual(150)
expect(parseMoney('2,30', usd)).toBe(230)
expect(parseMoney('1000', jpy)).toBe(1000)
expect(parseMoney('0.023', usd)).toBeNull()
expect(parseMoney('-1', usd)).toBeNull()
expect(unitPrice(230, '100')).toBeCloseTo(2.3)

const { m, pcs } = BUILTIN_UNITS
expect(formatAmount('1500', m)).toBe('1.5 km')
expect(formatAmount('0.25', m)).toBe('25 cm')
expect(formatAmount('1.23456', m)).toBe('1.235 m')
expect(formatAmount('0', m)).toBe('0 m')
expect(formatAmount('37', pcs)).toBe('37 pcs')
expect(parseAmount('150cm', m)).toBe('1.5')
expect(parseAmount('1.5 k', m)).toBe('1500')
expect(parseAmount('5 mm', m)).toBe('0.005')
expect(parseAmount('12', pcs)).toBe('12')
expect(parseAmount('2k', pcs)).toBeNull()
```

- [ ] **Step 2: Run** `pnpm vitest run packages/core`. Expected: FAIL (модулей нет).
- [ ] **Step 3: Реализовать модули** по блоку Interfaces. Перенести валюты одноразовым кодом и закоммитить уже готовый JSON.
- [ ] **Step 4: Run** `pnpm vitest run packages/core && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(core): ids, exact decimal quantities, currencies and units`

### Task 4: Модель, команды, правила

**Files:**
- Create: `packages/core/src/{model,tree,stock,commands,validate,storage}.ts`, `packages/core/test/fixtures.ts`
- Test: `packages/core/test/{tree,stock,validate}.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces, `model.ts`. Время — ISO-строки. Снапшот содержит и архивные записи.

```ts
interface Audited { createdAt: string; updatedAt: string; createdBy: string; updatedBy: string }
interface Archivable { archivedAt: string | null; archiveId: Id | null }
interface Inventory extends Audited, Archivable { id: Id; name: string; description: string | null; currency: string }
interface Folder extends Audited, Archivable { id: Id; inventoryId: Id; parentId: Id | null; name: string; description: string | null }
interface Item extends Audited, Archivable { id: Id; inventoryId: Id; folderId: Id | null; name: string; description: string | null; unitKey: string; tagIds: Id[] }
interface Variant extends Audited, Archivable { id: Id; itemId: Id; name: string; description: string | null; position: number }
interface Tag extends Audited { id: Id; inventoryId: Id; name: string }
interface Attribute extends Audited { id: Id; inventoryId: Id; name: string; kind: 'text' | 'enum'; options: string[] }
interface CustomUnit extends Audited { id: Id; inventoryId: Id; name: string; symbol: string; prefixPowers: number[] }
interface ItemAttribute { itemId: Id; attributeId: Id; value: string | null }
interface VariantAttributeValue { variantId: Id; attributeId: Id; value: string | null }
interface Photo { id: Id; itemId: Id; variantId: Id | null; provider: string; fileId: string; url: string; position: number; createdAt: string; createdBy: string }
type MovementKind = 'receipt' | 'usage' | 'return' | 'adjustment' | 'transfer'
interface Movement { id: Id; seq: number; itemId: Id; variantId: Id | null; kind: MovementKind; quantity: Quantity; totalPrice: number | null; sourceUrl: string | null; note: string | null; transferId: Id | null; createdAt: string; createdBy: string }
interface StockLine { itemId: Id; variantId: Id | null; quantity: Quantity; pricedQuantity: Quantity; pricedTotal: number; lastPriced: { totalPrice: number; quantity: Quantity; at: string } | null }
interface InventorySnapshot { inventory: Inventory; folders: Folder[]; items: Item[]; variants: Variant[]; tags: Tag[]; attributes: Attribute[]; units: CustomUnit[]; itemAttributes: ItemAttribute[]; variantAttributeValues: VariantAttributeValue[]; photos: Photo[]; stock: StockLine[] }
```

- **`tree.ts`.** Все функции учитывают только неархивные записи. Сортировка по имени: `localeCompare(…, undefined, { numeric: true, sensitivity: 'base' })`.
  - `childFolders(s, parentId: Id | null): Folder[]`
  - `itemsInFolder(s, folderId: Id | null): Item[]`
  - `folderPath(s, folderId: Id): Folder[]` — от корня к папке
  - `isInSubtree(s, ancestorId: Id, folderId: Id): boolean`
- **`stock.ts`:**
  - `interface StockSummary { quantity: Quantity; avgUnitPrice: number | null; lastUnitPrice: number | null }` — цены в минорных единицах за единицу;
  - `bucketStock(s, itemId, variantId: Id | null): StockSummary`;
  - `itemStock(s, itemId): StockSummary` — сумма по всем корзинам предмета, **кроме архивных вариантов**; `lastUnitPrice` — из самого позднего `lastPriced.at` по этим корзинам;
  - `isOutOfStock(sum): boolean` — `quantity ≤ 0`.
- **`commands.ts`** — `type Command`, ровно эти варианты (`?` — поле не меняется):

```ts
| { type: 'inventory.create'; id: Id; name: string; description: string | null; currency: string }
| { type: 'inventory.update'; id: Id; name?: string; description?: string | null }
| { type: 'folder.create'; id: Id; inventoryId: Id; parentId: Id | null; name: string; description: string | null }
| { type: 'folder.update'; id: Id; name?: string; description?: string | null }
| { type: 'folder.move'; id: Id; parentId: Id | null }
| { type: 'item.create'; id: Id; inventoryId: Id; folderId: Id | null; name: string; description: string | null; unitKey: string; tagIds: Id[]; initialReceipt: { movementId: Id; quantity: Quantity; totalPrice: number | null; sourceUrl: string | null } | null }
| { type: 'item.update'; id: Id; name?: string; description?: string | null; folderId?: Id | null; unitKey?: string; tagIds?: Id[] }
| { type: 'item.setAttribute'; itemId: Id; attributeId: Id; value: string | null }
| { type: 'item.removeAttribute'; itemId: Id; attributeId: Id }
| { type: 'variant.createMany'; itemId: Id; variants: { id: Id; name: string }[] }
| { type: 'variant.update'; id: Id; name?: string; description?: string | null }
| { type: 'variant.setAttribute'; variantId: Id; attributeId: Id; value: string | null }
| { type: 'tag.create'; id: Id; inventoryId: Id; name: string }
| { type: 'tag.rename'; id: Id; name: string }
| { type: 'tag.delete'; id: Id }
| { type: 'attribute.create'; id: Id; inventoryId: Id; name: string; kind: 'text' | 'enum'; options: string[] }
| { type: 'attribute.update'; id: Id; name?: string; options?: string[] }
| { type: 'attribute.delete'; id: Id }
| { type: 'unit.create'; id: Id; inventoryId: Id; name: string; symbol: string; prefixPowers: number[] }
| { type: 'unit.update'; id: Id; name?: string; symbol?: string; prefixPowers?: number[] }
| { type: 'unit.delete'; id: Id }
| { type: 'stock.receive'; movementId: Id; itemId: Id; variantId: Id | null; quantity: Quantity; totalPrice: number | null; sourceUrl: string | null; note: string | null }
| { type: 'stock.use' | 'stock.return'; movementId: Id; itemId: Id; variantId: Id | null; quantity: Quantity; note: string | null }
| { type: 'stock.set'; movementId: Id; itemId: Id; variantId: Id | null; target: Quantity; note: string | null }
| { type: 'stock.transfer'; transferId: Id; outMovementId: Id; inMovementId: Id; itemId: Id; fromVariantId: Id | null; toVariantId: Id | null; quantity: Quantity }
| { type: 'photo.add'; id: Id; itemId: Id; variantId: Id | null; provider: string; fileId: string; url: string }
| { type: 'photo.remove'; id: Id }
| { type: 'photo.reorder'; itemId: Id; orderedIds: Id[] }
| { type: 'archive'; target: 'inventory' | 'folder' | 'item' | 'variant'; id: Id; archiveId: Id }
| { type: 'restore'; archiveId: Id }
| { type: 'deletePermanently'; target: 'inventory' | 'folder' | 'item' | 'variant'; id: Id }
```

- **`validate.ts`:**
  - `type DomainErrorCode = 'name_required' | 'name_too_long' | 'duplicate_name' | 'invalid_currency' | 'invalid_quantity' | 'invalid_price' | 'invalid_url' | 'invalid_option' | 'insufficient_stock' | 'folder_cycle' | 'not_found' | 'archived' | 'not_archived' | 'unit_in_use'`;
  - `class DomainError extends Error { code: DomainErrorCode }`;
  - `normalizeCommand(c: Command): Command` — обрезает пробелы в именах, символах и опциях; пустое описание превращает в `null`;
  - `validateCommand(c: Command, s: InventorySnapshot | null): DomainError | null` — `s === null` допустим только для `inventory.create`;
  - `splitVariantNames(input: string): string[]`.
- **Правила `validateCommand`:**
  - имя после обрезки пустое → `name_required`; длиннее 200 символов → `name_too_long`;
  - валюта не из `CURRENCIES` → `invalid_currency`;
  - количество для receive/use/return/transfer и в `initialReceipt` не `> 0` → `invalid_quantity`; `target` у `stock.set` должен быть `≥ 0`;
  - `totalPrice` не целое или `< 0` → `invalid_price`;
  - `sourceUrl` не `http(s)://` → `invalid_url`;
  - use/transfer больше остатка корзины (`bucketStock`) → `insufficient_stock`;
  - перенос папки в себя или в потомка → `folder_cycle`;
  - ссылка на отсутствующую сущность → `not_found`;
  - создание или перенос в архивную папку, правка архивной записи → `archived`;
  - `deletePermanently` неархивной записи → `not_archived`;
  - значение enum-атрибута не из опций → `invalid_option`;
  - тег с таким же именем без учёта регистра или вариант с таким же именем у предмета → `duplicate_name`;
  - удаление единицы, которой пользуется хоть один предмет, включая архивные → `unit_in_use`.
- **`storage.ts`:**

```ts
interface Actor { device: string }
interface SchemaStatus { state: 'ready' | 'newer'; dbVersion: number; appVersion: number }
type StorageErrorCode = 'read_only' | 'unavailable' | 'failed'
class StorageError extends Error { code: StorageErrorCode }
interface InventoryStorage {
  readonly readOnly: boolean
  listInventories(): Promise<Inventory[]>
  loadInventory(id: Id): Promise<InventorySnapshot>
  loadMovements(itemId: Id): Promise<Movement[]>   // новые сверху (seq desc)
  apply(command: Command, actor: Actor): Promise<void>
}
```

- [ ] **Step 1: Write `fixtures.ts`** — `makeSnapshot(parts?: Partial<InventorySnapshot>)` и билдеры `folder()`, `item()`, `variant()`, `stockLine()` с разумными значениями по умолчанию.
- [ ] **Step 2: Write the failing tests**
  - `tree`:
    - `childFolders(s, null)` для «Folder 10», «Folder 2», архивной «Old» → `['Folder 2', 'Folder 10']`;
    - `folderPath` для G в F → `[F, G]`;
    - `isInSubtree(s, F, G) === true`;
    - `itemsInFolder` не возвращает архивные предметы.
  - `stock`:
    - корзины `null:'7'` (без цены) и `v1:'30'` (`pricedQuantity '100'`, `pricedTotal 230`, `lastPriced {230,'100','2026-01-02T00:00:00Z'}`) → `itemStock` = `{ quantity: '37', avgUnitPrice: 2.3, lastUnitPrice: 2.3 }`;
    - добавить архивный `v2` с `'5'` → всё ещё `'37'`;
    - без цен → `avgUnitPrice: null, lastUnitPrice: null`;
    - `isOutOfStock({quantity:'0',…}) === true`.
  - `validate` — по одному тесту на правило, в том числе:
    - `stock.use` 5 при остатке `'2'` → `insufficient_stock`;
    - `stock.transfer` 8 из `null` при `'7'` → `insufficient_stock`;
    - `folder.move` F под G (G внутри F) → `folder_cycle`;
    - `item.create` с именем `'   '` → `name_required`;
    - имя из 201 символа → `name_too_long`;
    - `'Резистор 🔌'` → `null` (валидно);
    - `normalizeCommand` превращает `'  TL072 '` в `'TL072'`;
    - `inventory.create` с `'XXX'` → `invalid_currency`;
    - `deletePermanently` неархивного предмета → `not_archived`;
    - `unit.delete` используемой единицы → `unit_in_use`;
    - `splitVariantNames('1k, 10k,\n100k, 10K')` → `['1k','10k','100k']`.
- [ ] **Step 3: Run** `pnpm vitest run packages/core`. Expected: FAIL.
- [ ] **Step 4: Реализовать модули** по блоку Interfaces. В `resolveUnit` заменить локальный `CustomUnit` импортом из `model.ts`.
- [ ] **Step 5: Run** `pnpm vitest run packages/core && pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** — `feat(core): domain model, commands, validation, tree and stock selectors`

### Task 5: Поиск

**Files:**
- Create: `packages/core/src/search.ts`
- Test: `packages/core/test/search.test.ts`

**Interfaces:**
- Consumes: `InventorySnapshot` (Task 4).
- Produces:
  - `interface SearchHit { itemId: Id; variantId: Id | null }`;
  - `createSearch(s: InventorySnapshot): { search(query: string, limit?: number): SearchHit[] }` — `limit` по умолчанию 50.
- Ищется по:
  - именам предметов и вариантов;
  - именам тегов предмета;
  - значениям атрибутов предмета и вариантов;
  - описанию.
- **Индекс:** MiniSearch, нечёткость по префиксу и опечаткам. Каждое имя индексируется ещё и в «компактной» форме: нижний регистр, удалено всё, кроме букв и цифр. Запрос тоже ищется в компактной форме.
- **Результат:** один результат на предмет, с лучшим совпавшим вариантом или `null`. Архивные предметы и варианты исключены. Пустой запрос или одни пробелы → `[]`.

- [ ] **Step 1: Write the failing tests.** Снапшот:
  - предметы TL072, LM13700 (тег `opamp`), «Резистор» с вариантами `1k` и `10k`, NE555 (с атрибутом «Корпус» = `DIP-8`);
  - архивный AS3340.

  Ожидания:
  - `search('tl072')`, `search('TL-072')`, `search('tl07')` — первый результат TL072;
  - `search('lm13600')` содержит LM13700 (опечатка);
  - `search('10k')` → `{ itemId: резистор, variantId: 10k }` первым;
  - `search('opamp')` содержит LM13700;
  - `search('dip-8')` содержит NE555;
  - `search('резистор')` и `search('РЕЗИСТОР')` находят «Резистор»;
  - `search('as3340')` → `[]`;
  - `search('   ')` → `[]`.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/search.test.ts`. Expected: FAIL.
- [ ] **Step 3: Реализовать `createSearch`.**
- [ ] **Step 4: Run** снова. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(core): in-memory fuzzy search over inventory snapshot`

### Task 6: Основа хранилища — SQL, исполнитель PGlite, схема, миграции

**Files:**
- Create:
  - `packages/storage-postgres/src/{sql,executor,schema,migrator}.ts`, `src/executors/pglite.ts`, `drizzle.config.ts`;
  - `migrations/` — генерируется;
  - `test/helpers.ts`.
- Test: `packages/storage-postgres/test/{sql,migrator}.test.ts`

**Interfaces:**
- Consumes: `SchemaStatus` (Task 4).
- Produces:

```ts
interface Statement { text: string; params: unknown[] }
function sql(strings: TemplateStringsArray, ...values: unknown[]): Statement  // $1..$n; вложенный Statement встраивается с перенумерацией
function updateSet(columns: Record<string, unknown>): Statement               // ключи — имена колонок; "col" = $n, ...; undefined пропускается
interface PgExecutor {
  query<Row = Record<string, unknown>>(s: Statement): Promise<Row[]>
  batch(statements: Statement[]): Promise<void>                               // атомарно: всё или ничего
  close(): Promise<void>
}
function createPgliteExecutor(db: PGlite): PgExecutor
const APP_SCHEMA_VERSION: number                                              // = число файлов миграций
function ensureSchema(exec: PgExecutor): Promise<SchemaStatus>
```

- **Схема `schema.ts`.** Таблицы и колонки `snake_case`.
  - **Наборы колонок:**
    - «аудит»: `created_at`/`updated_at` `timestamptz not null default now()`, `created_by`/`updated_by` `text not null`;
    - «архив»: `archived_at timestamptz null`, `archive_id uuid null`.
  - **Таблицы:**
    - `inventories(id uuid pk, name, description null, currency char(3))` + аудит + архив;
    - `folders(id, inventory_id → inventories cascade, parent_id → folders null, name, description null)` + аудит + архив;
    - `tags(id, inventory_id cascade, name)` + аудит;
    - `attributes(id, inventory_id cascade, name, kind text check in ('text','enum'), options text[] default '{}')` + аудит;
    - `custom_units(id, inventory_id cascade, name, symbol, prefix_powers smallint[] default '{}')` + аудит;
    - `items(id, inventory_id cascade, folder_id → folders null, name, description null, unit_key text default 'pcs')` + аудит + архив;
    - `item_tags(item_id cascade, tag_id cascade, pk(item_id, tag_id))`;
    - `variants(id, item_id cascade, name, description null, position int)` + аудит + архив;
    - `item_attributes(item_id cascade, attribute_id cascade, value text null, pk)`;
    - `variant_attribute_values(variant_id cascade, attribute_id cascade, value text null, pk)`;
    - `photos(id, item_id cascade, variant_id cascade null, provider, file_id, url, position int, created_at, created_by)`;
    - `movements(id uuid pk, seq bigint generated always as identity, inventory_id cascade, item_id cascade, variant_id cascade null, kind text check, quantity numeric(20,6), total_price bigint null, source_url null, note null, transfer_id uuid null, created_at, created_by)`.
  - **Индексы:** по `inventory_id` всех таблиц, `folders.parent_id`, `items.folder_id`, `movements(item_id, variant_id)`, `archive_id` в четырёх таблицах с архивом.
  - **Внешние ключи** `folders.parent_id` и `items.folder_id` — по умолчанию `NO ACTION`. Так поддерево можно удалить одним выражением.
- **Миграции:**
  - генерируются командой `pnpm --filter @graymatter/storage-postgres exec drizzle-kit generate --name init`;
  - читаются через `import.meta.glob('../migrations/*.sql', { query: '?raw', import: 'default', eager: true })` в порядке имён файлов;
  - выражения внутри файла разделены `--> statement-breakpoint`.
- **Мигратор:**
  1. `CREATE TABLE IF NOT EXISTS gm_meta (key text primary key, value text not null)`.
  2. `dbVersion` = `schema_version` или 0.
  3. Если `dbVersion > APP_SCHEMA_VERSION` → `{ state: 'newer' }`, ничего не применяется.
  4. Иначе каждая недостающая миграция применяется **одним `batch`** вместе с upsert `schema_version`.
- `test/helpers.ts`:
  - `makeExecutor(): Promise<PgExecutor>` — новый `PGlite()` в памяти;
  - `makeStorage()` появится в Task 7;
  - `TEST_ACTOR: Actor = { device: 'Test · Vitest' }`.

- [ ] **Step 1: Write the failing tests**
  - `` sql`select ${1}, ${'a'}` `` → `{ text: 'select $1, $2', params: [1, 'a'] }`;
  - `` sql`a ${sql`b ${1}`} c ${2}` `` → `{ text: 'a b $1 c $2', params: [1, 2] }`;
  - `updateSet({ name: 'x', description: undefined, note: null })` → `{ text: '"name" = $1, "note" = $2', params: ['x', null] }`;
  - пустая база: `ensureSchema` → `{ state: 'ready', dbVersion: APP_SCHEMA_VERSION, appVersion: APP_SCHEMA_VERSION }`, в `information_schema.tables` есть `items` и `movements`;
  - повторный `ensureSchema` не падает и возвращает то же;
  - `schema_version` = `APP_SCHEMA_VERSION + 1` → `state: 'newer'`;
  - `batch([insert gm_meta 'a', insert gm_meta 'a'])` (конфликт PK) отклоняется, а строки `'a'` нет — атомарность.
- [ ] **Step 2: Run** `pnpm vitest run packages/storage-postgres`. Expected: FAIL.
- [ ] **Step 3: Реализовать `sql`, `updateSet`, `PgExecutor`, PGlite-исполнитель и схему.** В PGlite-исполнителе `batch` — это `db.transaction`.
- [ ] **Step 4: Сгенерировать миграцию** командой выше. Expected: появился `migrations/0000_init.sql`.
- [ ] **Step 5: Реализовать `ensureSchema`.**
- [ ] **Step 6: Run** `pnpm vitest run packages/storage-postgres && pnpm typecheck`. Expected: PASS.
- [ ] **Step 7: Commit** — `feat(storage-postgres): sql tag, executors, drizzle schema and migrator`

### Task 7: Хранилище — инвентари, папки, справочники, загрузка

**Files:**
- Create: `src/storage.ts`, `src/rows.ts`, `src/queries.ts`, `src/commands/{index,inventory,folders,dictionaries}.ts`
- Modify: `test/helpers.ts`: добавить `makeStorage()`
- Test: `test/{inventory,folders,dictionaries}.test.ts`

**Interfaces:**
- Consumes: Tasks 4 и 6.
- Produces:
  - `openPostgresStorage(exec: PgExecutor): Promise<{ storage: InventoryStorage; status: SchemaStatus }>` — вызывает `ensureSchema`, `readOnly = status.state === 'newer'`;
  - `toStatements(c: Command, actor: Actor): Statement[]` — диспетчер по `c.type`; ещё не реализованные типы бросают `Error('not implemented: <type>')` до своих задач;
  - `makeStorage(): Promise<InventoryStorage>` в helpers.
- **`apply`:**
  - в режиме только чтения бросает `StorageError('read_only')`, ничего не выполняя;
  - иначе `exec.batch(toStatements(c, actor))`;
  - ошибку драйвера оборачивает в `StorageError('failed')` с исходной ошибкой в `cause`.
- **Правки** (`*.update`, `tag.rename`, `folder.move`) пишут `updated_at = now()`, `updated_by = actor.device`.
- **`rows.ts`:** `Date` → `toISOString()`. Колонки `numeric` и `bigint` выбираются как `::text`: количества остаются строками и нормализуются в канонический вид `Quantity`, деньги и `seq` переводятся в `number`.
- **`listInventories`** возвращает все инвентари, включая архивные, отсортированные по имени.
- **`loadInventory`** — по одному запросу на вид данных, без N+1:
  - `stock` строится одним агрегатом по `movements`, сгруппированным по `(item_id, variant_id)`;
  - `pricedQuantity` и `pricedTotal` — только по `kind = 'receipt' AND total_price IS NOT NULL`;
  - `lastPriced` — последнее по `seq` такое получение.

- [ ] **Step 1: Write the failing tests**
  - `inventory.create` → `listInventories()[0]` имеет `name`, `currency 'USD'`, `createdBy 'Test · Vitest'`, `archivedAt null`;
  - `inventory.update { description: null }` обнуляет описание;
  - `folder.create`, `folder.update`, `folder.move` → `loadInventory` отражает `name` и `parentId`;
  - `tag.create`, `tag.rename`, `tag.delete`; `attribute.create` с `kind 'enum'`, `options ['DIP-8','SOIC-8']`; `unit.create` с `prefixPowers [-3, 3]` → поля снапшота совпадают;
  - хранилище, открытое на базе со `schema_version = APP_SCHEMA_VERSION + 1`: `readOnly === true`, `apply(inventory.create)` → `StorageError` с `code 'read_only'`, `listInventories()` по-прежнему работает.
- [ ] **Step 2: Run** `pnpm vitest run packages/storage-postgres`. Expected: FAIL.
- [ ] **Step 3: Реализовать** `openPostgresStorage`, `rows.ts`, `queries.ts` и команды inventory, folders, dictionaries.
- [ ] **Step 4: Run** снова, плюс `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(storage-postgres): inventories, folders, tags, attributes, units and snapshot loading`

### Task 8: Хранилище — предметы, варианты, атрибуты, фото

**Files:**
- Create: `src/commands/{items,variants,photos}.ts`
- Modify: `src/commands/index.ts`, `src/queries.ts`
- Test: `test/{items,variants,photos}.test.ts`

**Interfaces:**
- Consumes: Task 7.
- **`item.create`:**
  - вставка предмета;
  - `item_tags` через `unnest($n::uuid[])`;
  - если есть `initialReceipt` — движение `kind 'receipt'`.

  Всё одним пакетом.
- **`item.update` с `tagIds`** заменяет набор тегов целиком.
- **`variant.createMany`:** позиции продолжаются после максимальной существующей, в порядке массива. Позиция вычисляется в SQL.
- **`item.removeAttribute`** удаляет и значение у предмета, и значения этого атрибута у вариантов предмета.
- **`photo.add`** ставит фото в конец (позиция в SQL). **`photo.reorder`** проставляет позиции по `orderedIds`.
- **`attribute.delete`** удаляет атрибут, его значения уходят каскадом.

- [ ] **Step 1: Write the failing tests**
  - `item.create` с `tagIds [t1]` и `initialReceipt { quantity '100', totalPrice 230, sourceUrl 'https://aliexpress.com/item/1' }` → `items[0].tagIds = [t1]`, `stock` = `[{ variantId: null, quantity: '100', pricedQuantity: '100', pricedTotal: 230, lastPriced.totalPrice: 230 }]`;
  - `item.create` без получения → `stock` пуст;
  - `item.update { tagIds: [t2] }` → `[t2]`;
  - `item.update { folderId: null }` переносит в корень;
  - `variant.createMany` (a, b), затем (c) → позиции 0, 1, 2;
  - `variant.update` меняет имя;
  - `item.setAttribute` и `variant.setAttribute` — upsert, второй вызов перезаписывает значение;
  - `item.removeAttribute` убирает строку предмета и значения у вариантов;
  - `attribute.delete` убирает все значения;
  - `photo.add` ×3 → позиции 0, 1, 2; `photo.reorder [p3, p1, p2]` → p3 = 0; `photo.remove p1` → два фото.
- [ ] **Step 2: Run** `pnpm vitest run packages/storage-postgres`. Expected: FAIL.
- [ ] **Step 3: Реализовать команды** items, variants, photos.
- [ ] **Step 4: Run** снова и `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(storage-postgres): items, variants, attribute values and photos`

### Task 9: Хранилище — журнал движений

**Files:**
- Create: `src/commands/stock.ts`
- Modify: `src/commands/index.ts`, `src/queries.ts` (`loadMovements`)
- Test: `test/stock.test.ts`

**Interfaces:**
- Consumes: Task 8.
- **Знак количества:**
  - `stock.receive` и `stock.return` хранятся с `+quantity`;
  - `stock.use` — с `-quantity` и видом `'usage'`.
- **`stock.set`:** одно выражение `INSERT … SELECT $target - COALESCE(SUM(quantity), 0)` по корзине `(item_id, variant_id)` с видом `'adjustment'`. Сравнение `variant_id` — через `IS NOT DISTINCT FROM`.
- **`stock.transfer`:** два движения `'transfer'` с общим `transfer_id`: `-q` из `fromVariantId` и `+q` в `toVariantId`.
- **`loadMovements(itemId)`** — все движения предмета, `seq desc`.

- [ ] **Step 1: Write the failing tests** — один сценарий на предмет в штуках:
  - receive 100 (230) → use 4 (note `'VCO'`) → остаток `'96'`;
  - `loadMovements` → первые два: `{ kind:'usage', quantity:'-4', note:'VCO' }`, `{ kind:'receipt', quantity:'100', totalPrice:230 }`;
  - `stock.set target '37'` → движение `{ kind:'adjustment', quantity:'-59' }`, остаток `'37'`;
  - transfer 30 из `null` в `v1` → корзины `null:'7'`, `v1:'30'`, два движения с одним `transferId`;
  - return 2 в `v1` → `'32'`;
  - `stock.set` на пустой корзине `v2` с `target '5'` → `adjustment '5'`;
  - метры: receive `'0.1'`, затем receive `'0.2'` → `'0.3'`;
  - получение без цены не меняет `pricedQuantity`;
  - `lastPriced` — у самого позднего получения с ценой.
- [ ] **Step 2: Run** `pnpm vitest run packages/storage-postgres/test/stock.test.ts`. Expected: FAIL.
- [ ] **Step 3: Реализовать команды журнала и `loadMovements`.**
- [ ] **Step 4: Run** весь пакет и `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(storage-postgres): stock movement journal`

### Task 10: Хранилище — архив, восстановление, окончательное удаление

**Files:**
- Create: `src/commands/archive.ts`
- Modify: `src/commands/index.ts`
- Test: `test/archive.test.ts`

**Interfaces:**
- Consumes: Task 9.
- **`archive`:**
  - ставит `archived_at = now()` и `archive_id`. Уже архивные записи не трогает;
  - для `'folder'` — вся ветка папок (рекурсивный CTE) и все предметы в ней;
  - для `'inventory'`, `'item'`, `'variant'` — только сама запись.
- **`restore(archiveId)`:**
  - снимает архив со всех записей с этим `archive_id` во всех четырёх таблицах;
  - **кроме того**, снимает архив с архивных папок-предков восстановленных папок и предметов (только сами папки на пути, без их остального содержимого);
  - для восстановленного варианта — с его архивного предмета.

  Цель: восстановленное всегда достижимо.
- **`deletePermanently`:**
  - `'item'` и `'variant'` — `DELETE` строки, зависимые уходят каскадом;
  - `'folder'` — удалить предметы ветки, затем папки ветки одним выражением;
  - `'inventory'` — удалить строку инвентаря, всё уходит каскадом.

- [ ] **Step 1: Write the failing tests**
  - Дерево: F (в корне) → G (внутри F); i1 в F, i2 в G, i0 в F.
    - i0 архивирован раньше с B.
    - `archive folder F` с A → у F, G, i1, i2 `archiveId` = A, у i0 по-прежнему B.
    - `restore A` → F, G, i1, i2 активны, i0 всё ещё в архиве.
  - Снова архивировать F с A.
    - `restore B` → i0 активен **и** F активна, а G, i1, i2 остаются в архиве с A.
  - `archive variant v1` с C → `variants` содержит v1 с `archivedAt`; `restore C` возвращает.
  - `archive inventory` → `listInventories` показывает `archivedAt`; `restore` → `null`.
  - `deletePermanently item` (архивного) → нет ни предмета, ни его вариантов, движений, фото, связей с тегами и значений атрибутов, а сам тег остался.
  - `deletePermanently folder F` (архивной, с G и предметами) → в снапшоте нет F, G, i0, i1, i2, другие папки целы.
  - `deletePermanently inventory` → `listInventories` пуст, в `movements` 0 строк.
- [ ] **Step 2: Run** `pnpm vitest run packages/storage-postgres/test/archive.test.ts`. Expected: FAIL.
- [ ] **Step 3: Реализовать `archive.ts`.**
- [ ] **Step 4: Run** весь пакет и `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(storage-postgres): archive, restore with ancestors, permanent deletion`

### Task 11: Драйверы Neon

**Files:**
- Create: `src/executors/{neon-ws,neon-http}.ts`
- Modify: `src/index.ts`: экспорт
- Test: `test/neon.conformance.test.ts`

**Interfaces:**
- Consumes: `PgExecutor` (Task 6), итоги спайка (Task 2).
- Produces:
  - `createNeonWsExecutor(connectionString: string): PgExecutor` — `Pool`; `batch` на одном клиенте: `BEGIN` … `COMMIT`, при ошибке `ROLLBACK`, затем `release`;
  - `createNeonHttpExecutor(connectionString: string): PgExecutor` — `neon()`; `query` через `sql.query(text, params)`, `batch` через `sql.transaction([...])`;
  - `assertTestDatabase(url: string): void` — бросает ошибку, если имя базы в URL не оканчивается на `_test`.
- **Тест:**
  - `describe.skipIf(!process.env.GM_NEON_TEST_URL)`;
  - `beforeAll`: `assertTestDatabase`, затем `DROP SCHEMA public CASCADE; CREATE SCHEMA public`;
  - для каждого из двух исполнителей: `openPostgresStorage` → `inventory.create` → `item.create` с получением `'100'` → `stock.set '37'` → `loadInventory` даёт `'37'`.

- [ ] **Step 1: Write the failing tests:**
  - `assertTestDatabase('postgres://u:p@h/graymatter')` бросает ошибку;
  - `assertTestDatabase('postgres://u:p@h/graymatter_test?sslmode=require')` — нет;
  - сценарий совместимости, как выше.
- [ ] **Step 2: Run** `pnpm vitest run packages/storage-postgres/test/neon.conformance.test.ts`. Expected: FAIL (`assertTestDatabase` не определён).
- [ ] **Step 3: Реализовать оба исполнителя и `assertTestDatabase`.**
- [ ] **Step 4: Run** весь `pnpm test` без `GM_NEON_TEST_URL` и `pnpm typecheck`. Expected: тесты `assertTestDatabase` PASS, тест совместимости пропущен, остальное PASS. Прогон с `GM_NEON_TEST_URL` (PASS для обоих драйверов) — позже, когда владелец даст базу.
- [ ] **Step 5: Commit** — `feat(storage-postgres): Neon WebSocket and HTTP executors`
