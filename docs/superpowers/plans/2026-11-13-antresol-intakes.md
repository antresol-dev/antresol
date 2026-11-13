# Поступления (Intakes) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поступления по спеке: черновики в базе без смены ревизии, экран поступления со шторкой строки, проведение одной атомарной записью, раздел Intakes с поиском, ссылка из истории предмета, поступления в резервной копии.

**Architecture:**
- **Модель и логика строк живут в `core`.** Типы поступления, разбор черновика против снимка (`resolveIntake`) и сборка команды проведения (`buildIntakeCommit`). Их же позже использует MCP.
- **Хранилище.**
  - Черновики пишутся отдельными методами `InventoryStorage`, мимо `apply`. Они меняют только свой счётчик `intakes_rev` в `antresol_meta`, а `rev` не трогают.
  - Проведение — одна команда ядра `intake.commit` через обычный `apply`, с проверкой `baseRev` в SQL.
- **Приложение.** Черновик сначала пишется на устройство, затем с паузой уходит в базу. Экраны: раздел `/intakes` и экран поступления `/intakes/[id]` со шторкой строки.

**Tech Stack:** TypeScript, Vitest, Postgres (PGlite, Neon), drizzle-kit (только генерация миграций), Nuxt 4, Vue 3, Tailwind 4, vue-i18n.

**Spec:** `docs/superpowers/specs/2026-11-13-antresol-intakes-design.md`, макеты — `docs/superpowers/specs/2026-11-13-antresol-intakes-mockup.html` и https://claude.ai/artifact/Yb2BPHtR5hJQBGkbKcoMt9. Спеки Планов 6–9 (синхронизация, варианты, повторы) действуют.

## Global Constraints

- **Ветка и место.** Вся работа — в worktree `/Users/as/dev/graymatter/.worktrees/intakes` на ветке `intakes`, задачи по очереди. В `master` не вливать и не пушить без команды владельца.
- **Git.**
  - Никаких push, PR и строк атрибуции (`Co-Authored-By`, `Claude-Session`).
  - Голые `git stash` и `git stash pop` запрещены: стек общий с другими сессиями.
  - Файлы добавляются только явными путями. Не добавлять `packages/app/nuxt.config.ts`, `proposals.md`, `.claude/`, `.superpowers/`, `.env.local`, `Claude outputs/`.
- **Инструменты.** Только pnpm. Легаси `api/` и `web/` не трогать.
- **Секреты.** Строки подключения и ключи не печатать и не коммитить.
- **Neon.** Только база `_test` через `ANTRESOL_NEON_TEST_URL`. Набор соответствия (`neon.conformance.test.ts`) запускает только задача 2, один раз.
- **Dev-сервер** — из этого worktree, порт 3001, без `--host`. Серверы владельца на 3000 и 3002 не трогать.
- **Проверка в браузере** у задач с интерфейсом — два снимка главного экрана задачи, 1280 px и 360 px (без горизонтальной прокрутки), через Claude in Chrome или chrome-devtools MCP. Без прокликивания сценариев.
- **Интерфейс.**
  - Тексты на английском в `packages/app/i18n/locales/en.json`, пространство ключей `intakes.*`, метка навигации `nav.intakes`.
  - Мн. число — синтаксисом vue-i18n с `|`.
  - Контраст текста ≥ 4.5:1.
  - Оформление — по стилям приложения: макет только каркас.
- **Синхронизация.** `intake.commit` возвращает изменённые строки (патч на несколько предметов) или `null`, всё в одной транзакции (правила Плана 6).
- **Черновики не меняют `rev`.** Ни сохранение, ни удаление черновика, ни правка шапки проведённого поступления. Меняется только `intakes_rev`.
- **Числа** количества и цены — без float: `Quantity` из ядра, цена в минимальных единицах (`parseMoneyText`).
- **Команды:**
  - все тесты — `pnpm test`, один файл — `pnpm vitest run <path>`, тяжёлые прогоны с `--maxWorkers=3`;
  - `pnpm typecheck`, `pnpm lint`;
  - коды выхода проверять напрямую, не через `| tail`.
- **Решения исполнителя.** Мелкие неясности исполнитель решает сам по спеке и пишет решение в отчёт. Останавливается, только если решение меняет то, что видит владелец, а спека молчит.

## Review Focus

1. **Ответ на проведение потерялся, приложение повторяет.** Первая попытка уже записала всё и сменила `rev`, поэтому `baseRev` повтора устарел. Повтор должен пройти как пустой (поступление уже `committed`) и не задвоить ни предметы, ни движения, ни фото. Тест в задаче 2.
2. **Один черновик правят два устройства.** Сохранение со старым `baseDraftRev` ничего не перезаписывает и возвращает `changed` с текущей версией. Перезапись — только явным `force`. Тест в задаче 2 (хранилище) и задаче 4 (приложение показывает, а не затирает).
3. **Вкладку закрыли в окне паузы перед отправкой.** Правка лежит на устройстве и уходит в базу при следующем открытии. Тест в задаче 4.
4. **Восстановление «с новыми id» копии с поступлениями.** Переименовываются и id внутри JSON черновика и строк, и `movements.intake_id`. Ни одной ссылки на старый id; повтор той же копии ничего не добавляет. Тест в задаче 3.
5. **Предмет строки удалили или заархивировали на другом устройстве до проведения.** Проведение отказывает, ничего не записано, строка помечена. Тесты в задаче 1 (`resolveIntake`) и задаче 4 (поток проведения).

---

## Порядок

| Задача | Что | Зависит от |
|---|---|---|
| 1 | Ядро: типы, `resolveIntake`, `intake.commit` и его проверка | — |
| 2 | Хранилище: миграция, методы черновиков, SQL проведения, патч | 1 |
| 3 | Резервные копии: восстановление и формат файла | 2 |
| 4 | Приложение: workspace, черновики на устройстве, поток проведения | 2 |
| 5 | Интерфейс: раздел Intakes, экран проведённого, шапка, ссылка в журнале | 4 |
| 6 | Интерфейс: экран черновика и шторка строки | 4, 5 |

Ревью по ходу: задачи 1 и 2 (модель и данные) — полное; остальные — лёгкое. В конце — одно сильное ревью всей ветки.

| Раздел спеки | Задачи |
|---|---|
| §3 Понятия (виды строк, ссылки на новые предметы черновика) | 1, 6 |
| §4 Черновики | 2, 4 |
| §5 Экран поступления | 6 |
| §6 Шторка строки | 1, 6 |
| §7 Проведение | 1, 2, 4 |
| §8 После проведения | 5 |
| §9 Фото | 1, 2, 4, 6 |
| §10 Резервные копии | 3 |

**Уточнение спеки §3 [решение Claude при планировании].** Новые предметы хранятся в черновике отдельным списком `newItems`, а строки ссылаются на них по id. Поэтому «строки, создающей предмет», нет. Новый предмет живёт, пока на него ссылается хотя бы одна строка. Удаление последней такой строки удаляет и его, с тостом «Undo». Правка имени, папки и атрибутов из любой его строки меняет общий предмет. Это проще и закрывает тот же случай, что и предупреждение из спеки.

---

### Task 1: Ядро — модель поступления, разбор строк, команда проведения

**Files:**
- Create: `packages/core/src/intakes.ts`
- Modify: `packages/core/src/index.ts` (экспорт), `commands.ts`, `validate.ts`, `model.ts` (`Movement.intakeId`)
- Test: `packages/core/test/intakes.test.ts`, `packages/core/test/validate.test.ts`, `packages/core/test/codes.test.ts` (если появится код ошибки)

**Interfaces:**
- Produces (`packages/core/src/intakes.ts`):

```ts
export type IntakeStatus = 'draft' | 'committed'
export interface IntakeHeader { shop: string | null; orderNumber: string | null; purchasedOn: string /* YYYY-MM-DD */; note: string | null }
export interface DraftNewItem {
  id: Id; name: string; folderId: Id | null; unitKey: string
  attributes: { attributeId: Id; value: string | null; axis: boolean }[]   // axes in order; value null on axes
}
export interface DraftLinePhoto { provider: string; fileId: string; url: string; replace: boolean }
export interface DraftLine {
  id: Id
  itemId: Id                                   // existing item or DraftNewItem.id
  axisValues: { attributeId: Id; value: string }[]  // canonical values; [] for items without axes
  quantity: Quantity
  totalPrice: number | null                    // minor units
  sourceUrl: string | null
  photo: DraftLinePhoto | null
  ids: { movementId: Id; variantId: Id; photoId: Id }   // minted when the line is created; reused on every commit attempt
}
export interface IntakeDraftContent { newItems: DraftNewItem[]; lines: DraftLine[] }
export type CommittedLineKind = 'add' | 'newValue' | 'newItem'
export interface CommittedLine {
  lineId: Id; kind: CommittedLineKind; itemId: Id; variantId: Id | null; movementId: Id
  itemName: string; variantLabel: string | null   // names at commit time (spec §8)
  quantity: Quantity; unitKey: string; totalPrice: number | null; sourceUrl: string | null
}
export interface Intake {
  id: Id; inventoryId: Id; status: IntakeStatus; header: IntakeHeader
  draft: IntakeDraftContent | null      // null once committed
  lines: CommittedLine[] | null         // null while draft
  draftRev: string                      // changes on every write of this row
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string; committedAt: string | null
}

export type LineResolution =
  | { kind: 'add'; itemId: Id; variantId: Id | null; unarchive: boolean }      // existing bucket (archived variant → unarchive)
  | { kind: 'newValue'; itemId: Id; variantId: Id; sharedWith: Id | null }      // new variant; sharedWith = earlier line creating the same variant
  | { kind: 'newItem'; itemId: Id; variantId: Id | null }                       // item from draft.newItems
  | { kind: 'problem'; code: 'item_gone' | 'item_archived' | 'missing_axis_value' | 'invalid_value' | 'unknown_item' }
export interface ResolvedIntake { lines: { lineId: Id; resolution: LineResolution }[]; ok: boolean }
export function resolveIntake(draft: IntakeDraftContent, s: InventorySnapshot): ResolvedIntake
export function buildIntakeCommit(intake: Intake, resolved: ResolvedIntake, s: InventorySnapshot, baseRev: string): Command  // throws if !resolved.ok
export function emptyIntakeDraft(): IntakeDraftContent
export function pruneNewItems(draft: IntakeDraftContent): IntakeDraftContent   // drops newItems no line references
```

- Produces (`commands.ts`):

```ts
| {
    type: 'intake.commit'
    intakeId: Id; inventoryId: Id; baseRev: string; header: IntakeHeader
    newItems: { id: Id; folderId: Id | null; name: string; unitKey: string;
                attributes: { attributeId: Id; value: string | null; axisPosition: number | null }[] }[]
    newVariants: { id: Id; itemId: Id; values: { attributeId: Id; value: string }[] }[]
    unarchiveVariants: Id[]
    receipts: { movementId: Id; itemId: Id; variantId: Id | null; quantity: Quantity; totalPrice: number | null; sourceUrl: string | null }[]
    photos: { id: Id; itemId: Id; variantId: Id | null; replaces: Id | null | undefined; provider: string; fileId: string; url: string }[]  // replaces undefined = add
    lines: CommittedLine[]
  }
```

- `Movement` получает `intakeId: Id | null`.

Правила `resolveIntake`:
- **Существующий предмет:**
  - снимок не знает id и это не новый предмет черновика → `unknown_item`;
  - предмет или его папка в архиве → `item_archived`;
  - предмет без осей → `add` с `variantId: null`.
- **С осями:**
  - нет значения на какой-то оси → `missing_axis_value`;
  - значение не проходит разбор атрибута → `invalid_value`;
  - `duplicateOf` (`variants.ts`) нашёл активный вариант → `add`;
  - нашёл архивный → `add`, `unarchive: true`;
  - иначе `newValue` с `variantId = line.ids.variantId`;
  - вторая и следующие строки с тем же предметом и теми же значениями берут `variantId` первой и получают `sharedWith`.
- **Новый предмет черновика:** `newItem`; при осях `variantId` строится так же, с тем же правилом общих значений.
- **`problem` у любой строки** → `ok: false`.

`buildIntakeCommit`:
- `receipts` — по строке на каждую строку черновика;
- `photos`: фото строки → `add` для нового варианта, нового предмета и варианта без фото; при `photo.replace` → `replaces` = текущее фото варианта; фото у варианта с фото и `replace: false` пропускается;
- `lines` — с именами из снимка и `newItems`.

`validateCommand` для `intake.commit`:
- каждая ссылка (`itemId`, `variantId`, `attributeId`, `folderId`) есть в снимке или создаётся этой же командой;
- количество > 0;
- цена и ссылка — по тем же правилам, что у `stock.receive`;
- значения осей и общих атрибутов — по правилам атрибута;
- новых вариантов-дублей нет ни между собой, ни с существующими;
- у одного варианта не больше одного фото после команды;
- переиспользовать приватные `checkPositive`, `checkPrice`, `checkUrl`, `activeBucket`.

- [ ] **Step 1: Write failing tests** в `packages/core/test/intakes.test.ts` (снимки через `makeSnapshot` из `core/test/fixtures.ts`):
  - `resolveIntake`: пополнение предмета без осей → `{ kind: 'add', variantId: null, unarchive: false }`;
  - значения `4k7` и `4.7k` на оси с `siPrefixes` дают `add` к существующему варианту 4.7 kΩ (оба канонизируются одинаково);
  - архивный вариант 47 kΩ → `add`, `unarchive: true`;
  - две строки нового значения 47 kΩ у одного предмета → у обеих одинаковый `variantId`, у второй `sharedWith` = id первой;
  - новый предмет черновика с осью Resistance и три строки 1k, 4k7, 10k → три `newItem` с разными `variantId`;
  - предмет удалён из снимка → `unknown_item`; предмет в архивной папке → `item_archived` (Review Focus 5); у строки нет значения на оси → `missing_axis_value`; `ok: false`;
  - `buildIntakeCommit`: у варианта есть фото, у строки фото с `replace: false` → `photos` пуст; с `replace: true` → одна запись с `replaces` = id текущего фото;
  - `pruneNewItems` удаляет новый предмет без строк.
- [ ] **Step 2: Write failing tests** в `validate.test.ts`: `intake.commit` с вариантом на предмете из `newItems` проходит; со ссылкой на несуществующий `attributeId` → ошибка; с двумя `newVariants` одинаковых значений → `duplicate_variant`; с двумя фото на один вариант → `invalid_option`; с количеством 0 → ошибка из `checkPositive`.
- [ ] **Step 3: Run** `pnpm vitest run packages/core/test/intakes.test.ts packages/core/test/validate.test.ts` — FAIL.
- [ ] **Step 4: Implement** типы, `resolveIntake`, `buildIntakeCommit`, `emptyIntakeDraft`, `pruneNewItems`, вариант команды и ветку `check` в `validate.ts`; `normalizeCommand` канонизирует количества и значения в `intake.commit`.
- [ ] **Step 5: Run** те же файлы и `pnpm vitest run packages/core`, `pnpm typecheck` — PASS (у `storage-postgres` и `app` типы могут ломаться до задач 2–4: исчерпывающий `switch` в `toStatements` закрыть заглушкой `throw new Error('intake.commit: task 2')`, `Movement.intakeId` в `toMovement` пока `null`).
- [ ] **Step 6: Commit** `feat(core): intakes model, line resolution against the snapshot, intake.commit command and its checks`.

### Task 2: Хранилище — миграция, черновики, проведение

**Files:**
- Modify: `packages/storage-postgres/src/schema.ts`, `src/queries.ts`, `src/rows.ts`, `src/storage.ts`, `src/commands/index.ts`, `src/commands/reads.ts`, `src/migrator.ts` (константа ключа), `packages/core/src/storage.ts`
- Create: `packages/storage-postgres/migrations/0002_intakes.sql` (drizzle-kit + ручной SQL), `src/commands/intakes.ts`, `src/intakes.ts` (методы черновиков)
- Test: `packages/storage-postgres/test/intakes.test.ts`, `test/migrator.test.ts`, `test/idempotent.test.ts`, `test/patch.property.test.ts`, `test/neon.conformance.test.ts`, `packages/app/test/backup.test.ts` (только версия схемы 4 → 5)

**Interfaces:**
- Consumes: типы и команда из задачи 1.
- Produces (`core/src/storage.ts`, методы `InventoryStorage`):

```ts
listIntakes(inventoryId: Id): Promise<{ intakes: Intake[]; intakesRev: string }>
intakesRev(): Promise<string>
saveIntakeDraft(
  draft: { id: Id; inventoryId: Id; header: IntakeHeader; content: IntakeDraftContent },
  baseDraftRev: string | null,     // null = new draft
  actor: Actor,
  options?: { force?: boolean },
): Promise<{ saved: true; draftRev: string; intakesRev: string } | { saved: false; reason: 'changed'; current: Intake } | { saved: false; reason: 'committed' }>
deleteIntakeDraft(id: Id): Promise<{ intakesRev: string }>          // committed rows are never deleted (no-op)
updateIntakeHeader(id: Id, header: IntakeHeader, actor: Actor): Promise<{ intakesRev: string }>  // committed or draft
```

- **Схема.** Таблица `intakes`:
  - `id uuid pk`;
  - `inventory_id uuid not null references inventories on delete cascade`;
  - `status text check in ('draft','committed')`;
  - `shop text`, `order_number text`, `purchased_on text not null` (`YYYY-MM-DD`), `note text`;
  - `draft jsonb`, `lines jsonb`, `draft_rev uuid not null`;
  - `audit()`;
  - `committed_at timestamptz`;
  - индекс `(inventory_id)`.
- **`movements.intake_id`:** `uuid references intakes(id)`, без `on delete`, то есть NO ACTION. Каскад удаления инвентаря удаляет и движения, и поступления в одном операторе. Если поставить `set null`, сработает триггер `movements_append_only`. Индекс `(intake_id)`.
- **Ключ `intakes_rev`** в `antresol_meta`: ставится миграцией и меняется (`gen_random_uuid()`) каждой записью поступлений, включая `intake.commit`.
- **Миграция аддитивная:** `min_app_schema` не трогать. `APP_SCHEMA_VERSION` становится 5.
- **`saveIntakeDraft`** — один `exec.batch`, `LOCK_REV` и `schemaGuard`, без `REV_BUMP`. Upsert по `id` только при условиях:
  - `status = 'draft'`;
  - `draft_rev = baseDraftRev`, либо строки нет и `baseDraftRev = null`, либо `force`.
  Иначе ничего не пишет. Различие `changed` и `committed` — по возвращённым строкам (выражено в SQL, без чтения в JS между операторами: Neon HTTP).
- **`intake.commit` в `toStatements`**, первым оператором после guard — `do`-блок:
  - поступление уже `committed` → `set_config('antresol.intake_done','1',true)` и дальше ничего не пишет (повтор);
  - иначе текущий `rev` ≠ `baseRev` → `AN004` (`conflict`).

  Затем, по порядку и с условием «`intake_done` не выставлен»:
  - вставки `items`, `item_attributes`, `variants`, `variant_attribute_values`;
  - снятие архива с `unarchiveVariants`: `archived_at`, `archive_id` = null;
  - фото: SQL `photo.add` и `photo.replace` из `commands/photos.ts`;
  - движения `receipt` с `intake_id`: генератор `movement()` из `commands/stock.ts`, расширенный колонкой;
  - `update intakes set status='committed', lines=$, draft=null, committed_at=now(), shop/order_number/purchased_on/note=$ where id=$ and status='draft'`;
  - смена `intakes_rev`.

  Все вставки — `on conflict (id) do nothing`.
- **`affectedReads('intake.commit')`:** срез каждого предмета из `newItems` и `receipts` (обобщить чтение среза на массив id), плюс малые таблицы целиком (`TABLES`). `toPatch` даёт `SnapshotPatch` с несколькими `itemIds`.

- [ ] **Step 1: Write failing tests** в `test/intakes.test.ts` (PGlite, `makeStorage`, `TEST_ACTOR`):
  - **`rev` не меняется:** `saveIntakeDraft` нового черновика → `listInventories().rev` прежний, `intakesRev()` новый, `listIntakes` возвращает черновик;
  - **сохранение с актуальным `baseDraftRev`** пишет и меняет `draftRev`; **со старым** → `{ saved: false, reason: 'changed', current }`, содержимое в базе прежнее; **с `force: true`** пишет (Review Focus 2);
  - **сохранение в проведённое** → `reason: 'committed'`;
  - **`deleteIntakeDraft`** удаляет черновик и не трогает проведённое;
  - **`updateIntakeHeader`** у проведённого меняет только шапку, `rev` прежний;
  - **проведение:** новый предмет с осью и тремя номиналами, пополнение существующего варианта, снятие архива, одно фото → после `apply` в снимке есть предмет, три варианта, движения с `intakeId`, фото; `status = 'committed'`, `lines` записаны; `patch.itemIds` содержит оба предмета;
  - **повтор той же команды после смены `rev`** (Review Focus 1) → успех, предметов, вариантов, движений и фото не прибавилось;
  - **команда со старым `baseRev`** при черновике → `StorageError('conflict')`, ничего не записано.
- [ ] **Step 2: Write failing tests** в `migrator.test.ts`:
  - `APP_SCHEMA_VERSION` = 5;
  - база схемы 4 обновляется до 5, `intakes_rev` появляется;
  - приложение схемы 4 (`openPostgresStorage(exec, { appVersion: 4 })`) читает и пишет базу схемы 5;
  - старый замороженный набор чтений (`fixtures/schema3-reads.ts`) по-прежнему работает.
  
  Поправить прочие жёстко прописанные 4: `migrator.test.ts`, `neon.conformance.test.ts`, `app/test/backup.test.ts`.
- [ ] **Step 3: Run** `pnpm vitest run packages/storage-postgres --maxWorkers=3` — FAIL.
- [ ] **Step 4: Implement:**
  - схема и `drizzle-kit generate --name intakes` (`pnpm --filter @antresol/storage-postgres exec drizzle-kit generate --name intakes`), ручной SQL после `--> statement-breakpoint`;
  - `toIntake` в `rows.ts`, `toMovement` с `intakeId`;
  - запросы, методы, `commands/intakes.ts`, обобщённое чтение срезов;
  - `idempotent.test.ts` и `patch.property.test.ts` получают `intake.commit`.
- [ ] **Step 5: Run** `pnpm vitest run packages/core packages/storage-postgres --maxWorkers=3`, `pnpm typecheck` — PASS. Затем набор соответствия на Neon один раз: `pnpm vitest run packages/storage-postgres/test/neon.conformance.test.ts`.
- [ ] **Step 6: Commit** `feat(storage): intakes table, drafts saved without bumping rev, intake.commit in one batch with a baseRev guard`.

### Task 3: Резервные копии с поступлениями

**Files:**
- Modify: `packages/core/src/storage.ts` (`InventoryExport.intakes`), `packages/storage-postgres/src/queries.ts` (`exportInventory`), `src/restore.ts`, `packages/app/app/lib/backup.ts`
- Test: `packages/storage-postgres/test/restore.test.ts`, `test/restore-fixtures.ts`, `packages/app/test/backup.test.ts`

**Interfaces:**
- Consumes: `Intake`, `Movement.intakeId` (задачи 1–2).
- Produces:
  - `InventoryExport { snapshot; movements; intakes: Intake[] }`;
  - `exportInventory` читает поступления в том же read-only снимке;
  - `RESTORE_TABLES` получает `intakes` раньше `movements` и колонку `movements.intake_id` (`ref: 'id'`);
  - `export function renameIntakeIds(intake: Intake, rename: (id: Id) => Id): Intake` в `restore.ts` переименовывает каждый id в `draft` (`newItems[].id`, `folderId`, `attributeId`, `lines[].itemId`, `ids.*`, `axisValues[].attributeId`) и в `lines` (`itemId`, `variantId`, `movementId`, `lineId`), а также `unitKey` вида `custom:<id>` — так же, как у предметов;
  - `backupProblems` проверяет:
    - ссылки поступлений разрешаются внутри копии (`newItems` черновика считаются);
    - `movements.intake_id` ссылается на поступление копии.
  - `backup.ts`:
    - `SHAPES.intake` и `SHAPES.movement.intakeId`;
    - для файлов схем ≤ 4: `intakes: []`, `intakeId: null`;
    - `version: 1` формата не меняется (изменение аддитивное).

- [ ] **Step 1: Write failing tests:**
  - `restore.test.ts`: `seedRich` дополняется черновиком и проведённым поступлением; восстановление «с теми же id» даёт те же строки; «с новыми id» — ни одного старого id ни в `intakes.draft`, ни в `intakes.lines`, ни в `movements.intake_id`; повтор той же копии с тем же `runId` ничего не добавляет (Review Focus 4);
  - тест «каждая таблица и колонка объявлены» остаётся зелёным;
  - `backupProblems`: строка проведённого поступления ссылается на движение вне копии → проблема;
  - `backup.test.ts`: файл схемы 4 без `intakes` разбирается с `intakes: []`; файл схемы 5 с поступлением — без потерь полей.
- [ ] **Step 2: Run** `pnpm vitest run packages/storage-postgres/test/restore.test.ts packages/app/test/backup.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** те же файлы, затем `pnpm vitest run packages/storage-postgres packages/app/test/backup.test.ts --maxWorkers=3`, `pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(backup): intakes in exports and restores, ids inside drafts renamed in new-ids mode`.

### Task 4: Приложение — workspace, черновики на устройстве, поток проведения

**Files:**
- Modify: `packages/app/app/lib/workspace-types.ts`, `app/lib/workspace.ts`, `app/lib/device-db.ts`, `app/plugins/workspace.client.ts` (сброс черновиков при `visibilitychange` → hidden)
- Create: `packages/app/app/lib/intake-drafts.ts`, `app/composables/useIntakes.ts`
- Test: `packages/app/test/intake-drafts.test.ts`, `test/workspace.test.ts`, `test/device-db.test.ts`

**Interfaces:**
- Consumes: методы хранилища (задача 2), `resolveIntake`, `buildIntakeCommit` (задача 1).
- Produces (`Workspace`):

```ts
listIntakes(): Promise<Intake[]>                          // current inventory; cached per intakesRev, refetched when intakesRev changed
saveIntakeDraft(id: Id, header: IntakeHeader, content: IntakeDraftContent, baseDraftRev: string | null, force?: boolean): ReturnType<InventoryStorage['saveIntakeDraft']>
deleteIntakeDraft(id: Id): Promise<void>
updateIntakeHeader(id: Id, header: IntakeHeader): Promise<void>
commitIntake(id: Id): Promise<{ ok: true } | { ok: false; problems: { lineId: Id; code: string }[] }>
uploadPhoto(file: File): Promise<{ provider: string; fileId: string; url: string }>   // public wrapper over uploadOne for the current source
```

- `DeviceDb`: `getIntakeDraft(sourceId, intakeId)`, `putIntakeDraft(sourceId, intakeId, value: LocalIntakeDraft)`, `deleteIntakeDraft(...)`, `listIntakeDrafts(sourceId)`; ключ `intakeDraft:${sourceId}:${intakeId}`. Плюс `getRecentFolders(inventoryId): Promise<Id[]>` и `noteRecentFolder(inventoryId, folderId)` (≤ 3), ключ `recentFolders:${inventoryId}`.
- `intake-drafts.ts`:

```ts
export interface LocalIntakeDraft { header: IntakeHeader; content: IntakeDraftContent; baseDraftRev: string | null; dirty: boolean; changedElsewhere: Intake | null }
export const DRAFT_SYNC_DELAY_MS = 3_000
export function createIntakeDraftSync(deps: { db: DeviceDb; save: Workspace['saveIntakeDraft']; sourceId: () => string | null; now?: () => number }): {
  edit(id: Id, change: (d: LocalIntakeDraft) => LocalIntakeDraft): Promise<LocalIntakeDraft>  // writes the device copy at once, schedules the database write
  flush(id?: Id): Promise<void>                       // on leaving the screen, on hide, before commit
  resolveConflict(id: Id, choice: 'keepMine' | 'takeTheirs'): Promise<void>
  load(id: Id, fromDatabase: Intake | null): Promise<LocalIntakeDraft>  // device copy wins while dirty; otherwise the database row
}
```

- **Поток `commitIntake`:**
  1. `flush(id)`;
  2. `sync()`;
  3. `resolveIntake` по свежему снимку; при `problem` → `{ ok: false, problems }`, ничего не отправляется;
  4. `buildIntakeCommit(…, baseRev = текущий rev источника)`;
  5. `apply`;
  6. на `StorageError('conflict')` — один раз снова с шага 2;
  7. на неизвестный исход — обычная заморозка формы (`useFormSender`, «Retry» шлёт ту же команду).
  
  После успеха локальная копия черновика удаляется, выбранные папки попадают в «недавние».

- [ ] **Step 1: Write failing tests** в `test/intake-drafts.test.ts` (фальшивые таймеры, `createMemoryDeviceDb`):
  - пять правок подряд в пределах 3 с → один вызов `save`;
  - `flush` отправляет сразу;
  - «вкладку закрыли» — новый экземпляр `createIntakeDraftSync` на той же `db` видит `dirty` копию и отправляет её при `load`/`flush` (Review Focus 3);
  - `save` вернул `changed` → `changedElsewhere` заполнен, правка на устройстве не потеряна, повторной автоматической отправки нет; `resolveConflict('keepMine')` шлёт с `force`, `'takeTheirs'` берёт `current`;
  - без сети (`save` бросает `StorageError('unavailable')`) → копия остаётся `dirty`, ошибки пользователю нет, отправка повторяется при следующем `flush` (плагин вызывает его и по событию `online`).
- [ ] **Step 2: Write failing tests** в `workspace.test.ts` (PGlite):
  - `commitIntake` по черновику с новым предметом и пополнением → снимок обновлён патчем без полной перезагрузки, `listIntakes` показывает `committed`;
  - предмет строки удалён другим «устройством» (вторая storage на той же базе) → `{ ok: false, problems: [{ code: 'unknown_item' }] }`, в базе ничего нового (Review Focus 5);
  - `rev` сменился между `sync` и `apply` → одна автоматическая повторная попытка проходит.
- [ ] **Step 3: Run** `pnpm vitest run packages/app/test/intake-drafts.test.ts packages/app/test/workspace.test.ts packages/app/test/device-db.test.ts` — FAIL.
- [ ] **Step 4: Implement** методы `Workspace` (через `guarded()`), ключи `DeviceDb`, `intake-drafts.ts`, `useIntakes()` (возвращает синглтон синхронизации черновиков и обёртки workspace), вызов `flush()` в обработчике `visibilitychange` плагина.
- [ ] **Step 5: Run** те же файлы и `pnpm vitest run packages/app --maxWorkers=3`, `pnpm typecheck` — PASS.
- [ ] **Step 6: Commit** `feat(app): intake drafts saved on the device first and sent after a pause, commit re-resolved against a fresh copy`.

### Task 5: Интерфейс — раздел Intakes, проведённое поступление, ссылка в журнале

**Files:**
- Modify: `packages/app/app/lib/shell.ts` (раздел `intakes`, маршруты `intakes`, `intakes-id`), `app/components/AppNav.vue` (иконка `PackageOpen` из `@lucide/vue`), `app/lib/item-view.ts` (`JournalRow.intake`), `app/components/JournalList.vue` (новый вид части — ссылка-маршрут), `i18n/locales/en.json`
- Create: `packages/app/app/pages/intakes/index.vue`, `app/pages/intakes/[id].vue` (оболочка: черновик → компонент задачи 6, проведённое → `IntakeRecord.vue`), `app/components/IntakeList.vue`, `app/components/IntakeRecord.vue`, `app/components/IntakeHeaderSheet.vue`, `app/lib/intake-list.ts`
- Test: `packages/app/test/intake-list.test.ts`, `test/shell.test.ts`, `test/item-view.test.ts`

**Interfaces:**
- Consumes: `Workspace.listIntakes`, `updateIntakeHeader`, `deleteIntakeDraft` (задача 4).
- Produces (`app/lib/intake-list.ts`):

```ts
export interface IntakeRow { id: Id; status: IntakeStatus; title: string /* "LCSC · #WM2511-0042" or "Intake · 12 Nov" */; date: string; lineCount: number; by: string }
export function intakeRows(intakes: Intake[], s: InventorySnapshot): IntakeRow[]   // drafts first, then committed by purchasedOn desc, then committedAt desc
export function searchIntakes(intakes: Intake[], s: InventorySnapshot, query: string): Intake[]  // shop, order number, item names in lines (draft: newItems names + current names of existing items)
export function intakeTitle(h: IntakeHeader): string
```

- `JournalRow` получает `intake: { id: Id; title: string } | null`. Заголовок берётся из кеша `listIntakes`; пока кеша нет, `null`, и ссылка не показывается.
- **`IntakeHeaderSheet`** правит магазин (подсказки — уникальные `shop` из `listIntakes`), номер, дату (`<input type="date">`) и заметку.
- **`/intakes`:**
  - список с поиском (поле сверху, фильтрация на устройстве);
  - кнопка «New intake» — новый id, шапка `{ purchasedOn: сегодня }`, переход на экран;
  - пустое состояние через `EmptyState`.
- **Проведённое поступление** (`IntakeRecord.vue`):
  - шапка с «Edit»;
  - строки как в заказе: количество, имя на момент проведения, текущее имя ссылкой на предмет (`/item/:id?variant=`), если предмет жив, цена, ссылка на товар;
  - строки не правятся.

- [ ] **Step 1: Write failing tests:**
  - `intake-list.test.ts`: черновики раньше проведённых; поиск «esp32» находит проведённое поступление по `lines[].itemName` и черновик по имени нового предмета; поиск по номеру заказа без учёта регистра;
  - `shell.test.ts`: `NAV_SECTIONS` = items, intakes, dictionaries, archive; `sectionOf('intakes-id') === 'intakes'`;
  - `item-view.test.ts`: движение с `intakeId` и известным поступлением даёт `row.intake.title = 'LCSC · #WM2511-0042'`.
- [ ] **Step 2: Run** `pnpm vitest run packages/app/test/intake-list.test.ts packages/app/test/shell.test.ts packages/app/test/item-view.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Страницы по образцу `pages/archive.vue` (заглушка, скелет, `ScreenHeader`/`ScreenBody`). `MobileDock` показывает поиск в разделе Intakes, кнопку «+» — нет.
- [ ] **Step 4: Run** те же файлы, `pnpm typecheck`, `pnpm lint` — PASS. Два снимка `/intakes` с демо-данными (1280 и 360 px).
- [ ] **Step 5: Commit** `feat(app): Intakes section with search, committed intake view, header edit, journal link to the intake`.

### Task 6: Интерфейс — экран черновика и шторка строки

**Files:**
- Create: `packages/app/app/components/IntakeDraftScreen.vue`, `app/components/IntakeLineSheet.vue`, `app/components/IntakeLineRow.vue`, `app/lib/intake-line.ts`
- Modify: `app/pages/intakes/[id].vue`, `i18n/locales/en.json`
- Test: `packages/app/test/intake-line.test.ts`

**Interfaces:**
- Consumes: `useIntakes()`, `Workspace.commitIntake`, `uploadPhoto` (задача 4); `resolveIntake`, `pruneNewItems` (задача 1); `existingMatches`, `searchRows` (`app/lib/quick-add.ts`, `views.ts`); `nearestValues`, `duplicateOf`, `itemAxes` (core); `AmountField`, `FolderPickerList`, `PhotoPicker`, `AppSheet`, `AttributeValueSheet`/`AttributeForm` (создание атрибута — обычной командой, как сейчас).
- Produces (`app/lib/intake-line.ts`, чистые функции):

```ts
export interface LineMatches { exact: SearchRow[]; otherValue: SearchRow[]; similar: SearchRow[]; inDraft: { newItemId: Id; name: string }[] }
export function lineMatches(query: string, s: InventorySnapshot, draft: IntakeDraftContent): LineMatches
export type ValueHint = { kind: 'existing'; variantId: Id; have: Quantity } | { kind: 'new'; nearest: ReturnType<typeof nearestValues> } | { kind: 'archived'; variantId: Id }
export function valueHint(s: InventorySnapshot, draft: IntakeDraftContent, itemId: Id, values: { attributeId: Id; value: string }[]): ValueHint
export function duplicateWarning(s: InventorySnapshot, newItem: DraftNewItem, query: string): SearchRow | null   // existingMatches(fuzzy:false) by name, or a variant with the same axis values
export function alreadyInDraft(draft: IntakeDraftContent, itemId: Id, values: { attributeId: Id; value: string }[], exceptLineId?: Id): boolean
export function suggestedFolder(s: InventorySnapshot, matches: LineMatches): { folderId: Id | null; nextTo: string } | null
export function nextLineDefaults(prev: DraftLine, draft: IntakeDraftContent): { folderId: Id | null; unitKey: string; urlPrefix: string | null }  // "Add & next": folder, unit, link origin
export function attributesFrom(s: InventorySnapshot, itemId: Id): DraftNewItem['attributes']   // similar item's attributes and axes, values empty
```

- **Экран черновика** (вариант A, первая версия макета):
  - шапка одной строкой с правкой (`IntakeHeaderSheet`);
  - строки `IntakeLineRow`: «+10 / 20», имя и вариант, подпись «have 6 · Op-amps» или «→ Op-amps · next to TL072», метка ADD / NEW / NEW VALUE по `resolveIntake`; строка с `problem` — с пометкой и текстом из `intakes.problem.<code>`;
  - «+ Add line»; «Commit · N lines» (выключена при `!resolved.ok` или `readOnly`);
  - «⋯» → «Delete draft» через `ConfirmSheet`;
  - плашка «Changed on another device» с «Keep mine» и «Take theirs», когда `changedElsewhere`.
- **Шторка строки** — четыре состояния второй версии макета. Правила раскрытия:
  - всегда открыты поле «что это» (до выбора) или карточка предмета (после), и количество;
  - остальное — строки-сводки «Price & link», «Photo», «Attributes & values» (только новый предмет), «Folder» (только новый, чипами: предложенная, недавние, «Other…»).
- **Чип ✎** — у каждой оси существующего предмета или предмета черновика; у предметов без осей чипа нет. Плашки:
  - зелёная — `existing` / `archived`;
  - синяя с ближайшими — `new`;
  - жёлтая «Looks like you already have this» с «Use it instead» — `duplicateWarning` у нового предмета, не блокирует;
  - «already in this intake» — `alreadyInDraft`.
- **Фото:**
  - `PhotoPicker` → `uploadPhoto` сразу, в строку пишется ссылка;
  - у варианта с фото — превью текущего и кнопка «Replace photo» (`replace: true`);
  - без хранилища фото строка «Photo» не показывается.
- **«Add & next»** — `nextLineDefaults`. Тап по строке на экране открывает ту же шторку для правки, там же «Remove line». Удаление последней строки нового предмета — тост «Undo».

- [ ] **Step 1: Write failing tests** в `test/intake-line.test.ts` (снимок `createDemoDriver({ memory: true, extras: false })` + черновики в тесте):
  - `lineMatches('resistor 0.25w 4k7', …)` → первым в `exact` вариант 4.7 kΩ;
  - новый предмет черновика находится в `inDraft` по имени;
  - `valueHint` для 47 kΩ при существующем варианте → `existing`, при отсутствии → `new` с ближайшими;
  - **`duplicateWarning`** для нового предмета «Resistor 0.25W 4k7» при существующем «Resistor 0.25 W · 4.7 kΩ» → находит его;
  - `alreadyInDraft` — да для второй строки с теми же значениями;
  - `nextLineDefaults` сохраняет папку, единицу и `https://lcsc.com` из `https://lcsc.com/product-detail/C25819.html`;
  - `attributesFrom` копирует атрибуты и оси похожего предмета с пустыми значениями.
- [ ] **Step 2: Run** `pnpm vitest run packages/app/test/intake-line.test.ts` — FAIL.
- [ ] **Step 3: Implement** `intake-line.ts`, затем компоненты. Правки черновика — только через `useIntakes().edit` (тогда работают пауза и сохранение на устройстве).
- [ ] **Step 4: Run** тот же файл, `pnpm vitest run packages/app --maxWorkers=3`, `pnpm typecheck`, `pnpm lint` — PASS. Два снимка: экран черновика (1280 px) и открытая шторка в состоянии 4 (360 px), на демо-данных.
- [ ] **Step 5: Commit** `feat(app): intake draft screen and line sheet: existing or new, value chips, duplicate warnings, photos, Add & next`.

---

## Перенос на потом (carry-over)

- Локальный MCP, который создаёт черновики (`createdBy = "Claude · MCP"`), — следующий проект. Он переиспользует `resolveIntake` и `buildIntakeCommit` из ядра.
- Разбор текста в атрибуты без ИИ — бэклог D6.
- Создание папки прямо из шторки (сейчас только выбор существующей).
- Распределение доставки по строкам, отмена проведённого поступления — не-цели спеки.

---

## Итоги выполнения (2026-11-13)

Все шесть задач сделаны через субагентов: ревью после каждой задачи, итоговое ревью всей ветки, одна волна исправлений и её контрольная проверка.

**Проверки на `785429e`:**
- `pnpm typecheck` и `pnpm lint` проходят;
- 125 файлов, 3424 теста (набор Neon исключён);
- набор соответствия на Neon `_test` после финальных исправлений: 25 прошло, 1 пропущен (давний пропуск websocket).

**Что итоговое ревью нашло и что исправлено (`cfc5a23..785429e`):**
- **Критическое, дефект плана:** резервная копия не восстанавливалась, если предмет из проведённого поступления удалили насовсем. `backupProblems` больше не сверяет строки поступлений с остальной копией. Проверяется только внешний ключ `movements.intake_id` и инвентарь.
- Черновик, открытый без сети, больше не откатывается к старой строке из кеша. Свои записи попадают в кеш списка.
- Сохранение, ответ на которое потерялся, считается сохранённым, а не изменением на другом устройстве.
- Ссылка не http(s) и слишком длинное имя нового предмета отклоняются при сохранении строки и помечают строку (`invalid_link`, `invalid_value`), в том числе в черновиках, записанных не этим приложением.
- Поступление можно начать без сети. Без сети список показывает черновики на устройстве с подписью «Connect to see all intakes».
- В списке показывается автор поступления, а не тот, кто правил последним. Восстановление, которое пишет поступления, обновляет `intakes_rev`.

**Решения исполнителей и контролёра**, записанные во время работы:
- `updateIntakeHeader` возвращает новый `draftRev`;
- `intake.commit` получил `baseDraftRev`: проведение из устаревшего черновика отказывает, а не затирает сохранение с другого устройства;
- черновик, проведённый на другом устройстве, сохраняет несохранённые правки и предлагает только «Discard my changes»;
- черновик, существующий только на устройстве, удаляется без сети;
- dev-сервер для снимков — на порту 3011: порт 3001 занят превью из `.worktrees/preview`.

## Перенос на потом (дополнение после выполнения)

- Нет опроса `intakes_rev`: изменение с другого устройства видно при следующем сохранении или перечитывании списка.
- Потерянный ответ, затем новые правки, затем перезагрузка страницы ещё могут показать ложное «Changed on another device». Данные не теряются, «Keep mine» восстанавливает правильное.
- Две вкладки на одном устройстве не учтены в защите от отката черновика: в худшем случае будет видимый конфликт.
- Без сети строки черновиков, уже сохранённых в базе, показываются без автора и дат.
- `IntakeLineSheet.vue` ~800 строк. Следующее разбиение — панель поиска (состояние 1) и чипы папок.
- Мелочи из ревью:
  - инлайн-обработчики из нескольких операторов в шторке;
  - `existingMatches` вызывается на каждую строку при каждой отрисовке;
  - `searchIntakes` строит карту имён на каждое поступление;
  - «Intake · » вне i18n;
  - разные форматы дат (en-GB и en);
  - в `JournalList` нет защиты от устаревшего ответа.
- Проверки:
  - нет ограничений длины полей шапки и проверки даты на сервере;
  - сохранение черновика читает строку целиком;
  - проверка `intake.commit` принимает номера осей не по порядку 0..n-1 и пустое проведение;
  - строки не сверяются с приходами по цене и ссылке.
- Тесты, которых не хватает:
  - переименование `custom:`-единиц в `lines.unitKey` проведённых поступлений;
  - порядок черновиков в списке;
  - проведение черновика, удалённого на другом устройстве.
- Номинал в шторке: чип, раскрывающийся на месте в поле во всю ширину строки без отдельной подписи («Resistance» сейчас повторяется в чипе, подписи и поле; пустой чип показывает имя, а не «Resistance: —»). Владелец 2026-11-13: пока оставить как есть.
