# GrayMatter — План 6: работа с локальной копией и синхронизация

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** обычная запись больше не скачивает весь инвентарь. Ответ записи — изменённые строки, они применяются к локальной копии. Полная загрузка бывает только по «Sync» (если ревизия изменилась), по «Reload everything» и при проверке по интервалу.

**Architecture:**
- **Пакет записи** в Postgres:
  - сначала блокирует строку ревизии и читает «ревизию до»;
  - затем пишет и поднимает ревизию;
  - в той же транзакции читает затронутые строки теми же запросами, что и полная загрузка, только с фильтром.
- **Ядро** получает чистую функцию `patchSnapshot`.
- **Workspace** применяет ответ к копии по правилам ревизии из спеки (4.2). Через общий вход `syncIfDue` проверяет ревизию по интервалу из настроек устройства.
- **Интерфейс:**
  - «Sync» в меню инвентаря;
  - «Reload everything» в действиях источника;
  - выбор интервала в настройках.

**Tech Stack:** без новых runtime-зависимостей. Dev-зависимость `fast-check@^4.10.2` в `@graymatter/storage-postgres` для свойство-теста.

**Spec:** `docs/superpowers/specs/2026-11-11-graymatter-sync-design.md`. Основная спека: `docs/superpowers/specs/2026-11-10-graymatter-revival-design.md`.

## Global Constraints

- **Ничего не публиковать.**
  - Не пушить, не открывать PR, не включать Pages.
  - Вся работа в ветке `revival`.
- **Секреты.**
  - Строки подключения и ключи не печатать, не логировать и не коммитить.
  - `.env.local` не читать.
  - Neon в тестах — только через `GM_NEON_TEST_URL`: база с именем на `_test`, проверка `assertTestDatabase`. `neondb` не трогать.
- **Не трогать** `api/`, `web/`, `.claude/`, `.superpowers/`.
- **`packages/app/nuxt.config.ts` не стейджить.** Там незакоммиченная правка владельца `devServer: { host: '0.0.0.0' }`.
- **Коммиты** без трейлеров `Co-Authored-By` и `Claude-Session`.
- **Зависимости.** Только pnpm. Новая зависимость одна: `fast-check@^4.10.2` (dev, `packages/storage-postgres`).
- **Проверки:** `pnpm test`, `pnpm typecheck`, `pnpm lint` из корня репозитория.
- **Dev-сервер.**
  - Только из отдельного worktree, со своей `.nuxt`: `pnpm --filter @graymatter/app dev --port 3001`, без `--host`.
  - Серверы владельца на 3000 и 3002 не трогать.
- **Интерфейс английский.** Тексты — дословно из Task 8.
- **Ревизия непрозрачна:** это UUID, сравнивать только на равенство.
- **Существующее поведение сохраняется:**
  - статусы `connecting`, `ready`, `read_only`, `unreachable` и `error`;
  - демо-источник;
  - кеш на устройстве;
  - экспорт копии;
  - идемпотентность вставок (`on conflict (id) do nothing`).

## Review Focus

1. **«Sync» во время записи.**
   - Ситуация: полная загрузка закончилась, пока запись была в пути.
   - Ожидание: строки этой записи не перекрывают более свежую загрузку. Если копия не доказанно актуальна, она помечается устаревшей.
   - Тест: Task 6, тест 9.
2. **Запись в неоткрытый инвентарь** (страница архива, `applyTo`).
   - Ожидание: сохранённая копия этого инвентаря не считается актуальной. При открытии — одна полная загрузка.
   - Тест: Task 6, тест 5.
3. **Приложение закрыли меньше чем через 2 с после записи.**
   - Ожидание: копия на устройстве никогда не хранит ревизию новее своих данных.
   - Тест: Task 6, тест 10.
4. **Таймаут после коммита, затем повтор той же команды.**
   - Ожидание: в копии ровно одна запись. Без повтора следующая проверка загружает копию один раз.
   - Тест: Task 6, тест 7.
5. **Neon: пакет записи и конкурентные записи.**
   - Ожидание: результаты пакета совпадают по индексам с инструкциями, включая инструкции без строк. Две одновременные записи выстраиваются в очередь на строке ревизии.
   - Тест: Task 1 и Task 4, conformance.

## Порядок и параллельность

- Task 3 не зависит от Task 1 и Task 2: можно делать в отдельном worktree параллельно.
- Task 4 требует Task 1 и Task 3. Task 5 требует Task 4.
- Task 6 требует Task 2 и Task 4 и включается только при зелёном Task 5.
- Task 7 идёт после Task 6, Task 8 — после Task 7.

---

### Task 1: Пакет записи возвращает строки

**Files:**
- Modify: `packages/storage-postgres/src/executor.ts`, `src/executors/pglite.ts`, `src/executors/neon-http.ts`, `src/executors/neon-ws.ts`.
- Test: `packages/storage-postgres/test/batch-rows.test.ts` (новый), `test/neon.conformance.test.ts`.

**Interfaces:**
- Produces: `PgExecutor.batch(statements: Statement[]): Promise<Record<string, unknown>[][]>`.
  - Строки каждой инструкции по порядку; `[]` для инструкций без строк.
  - Транзакция атомарна, как сейчас.
  - Существующие вызовы результат игнорируют.

- [ ] **Step 1: Failing test** `batch returns the rows of each statement in order` (PGlite).
  - Пакет из четырёх инструкций:
    - `create temp table gm_probe (x int) on commit drop`;
    - `insert into gm_probe values (1), (2)`;
    - `update gm_probe set x = x + 1 where x = 2`;
    - `select x from gm_probe order by x`.
  - Ожидание: `result.length === 4`, `result[1]` и `result[2]` равны `[]`, `result[3]` равен `[{ x: 1 }, { x: 3 }]`.
- [ ] **Step 2: Failing test** `a failing statement applies nothing and rejects`. Существующая проверка атомарности остаётся зелёной.
- [ ] **Step 3: Implement** во всех трёх исполнителях.
  - Neon HTTP: результат `sql.transaction`.
  - Neon WS: `rows` каждого `client.query`.
  - PGlite: `rows` каждого `tx.query`.
- [ ] **Step 4: Conformance** (HTTP и WS, под `GM_NEON_TEST_URL`): тот же сценарий из Step 1.
- [ ] **Step 5: Run** `pnpm vitest run packages/storage-postgres` → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 6: Commit** `feat(storage): write batches return the rows of each statement`.

---

### Task 2: Ревизия вместе со снимком

**Files:**
- Modify: `packages/core/src/storage.ts`, `packages/storage-postgres/src/{queries,storage}.ts`, `packages/app/app/lib/workspace.ts` (`loadCurrent` и комментарий к нему).
- Test: `packages/storage-postgres/test/snapshot.test.ts`, `packages/app/test/workspace.test.ts`.

**Interfaces:**
- Produces: `InventoryStorage.loadInventoryWithRev(id: Id): Promise<{ snapshot: InventorySnapshot; rev: string }>`.
  - Снимок и `select value from gm_meta where key = 'rev'` читаются одним `readBatch` (REPEATABLE READ).
  - `loadInventory` остаётся для остальных вызывающих.
- `loadCurrent` берёт ревизию копии из ответа `loadInventoryWithRev`, а не из `sourceRevs`, снятого до загрузки.
- Харнесс `workspace.test.ts`: `flags.loadCalls` считает вызовы и `loadInventory`, и `loadInventoryWithRev`. Это «полные загрузки» во всех следующих тестах.

- [ ] **Step 1: Failing test (storage)** `loadInventoryWithRev returns the revision read with the snapshot`.
  - После записи `rev` равен `rev` из `listInventories`.
  - После следующей записи `rev` другой.
- [ ] **Step 2: Failing test (app)** `a foreign write between the list and the load is not loaded twice`.
  - Ход: `refresh()`; список прочитан, до загрузки снимка другое устройство пишет; загрузка завершается.
  - Ожидание: второй `refresh()` без изменений → `loadCalls` не растёт. Сегодня он растёт на 1.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` → PASS.
- [ ] **Step 5: Commit** `perf: keep the revision read with the snapshot`.

---

### Task 3: Патч снимка в ядре

**Files:**
- Create: `packages/core/src/patch.ts`. Export из `packages/core/src/index.ts`.
- Test: `packages/core/test/patch.test.ts`.

**Interfaces:**
- Produces:
```ts
export interface SnapshotPatch {
  inventoryId: Id
  /** Items whose slice is replaced whole: the item row (with tagIds), its variants, item attributes, attribute values
   *  of its variants, photos and stock lines. An id listed here without a row in `items` is removed with its slice. */
  itemIds: Id[]
  items: Item[]
  variants: Variant[]
  itemAttributes: ItemAttribute[]
  variantAttributeValues: VariantAttributeValue[]
  photos: Photo[]
  stock: StockLine[]
  /** Re-read whole when the command touched it; absent means unchanged. */
  inventory?: Inventory
  folders?: Folder[]
  tags?: Tag[]
  attributes?: Attribute[]
  units?: CustomUnit[]
}
/** A new snapshot object (views cache indexes by object identity); the input is not mutated. Throws when
 *  `p.inventoryId !== s.inventory.id`. */
export function patchSnapshot(s: InventorySnapshot, p: SnapshotPatch): InventorySnapshot
```
- Значения атрибутов вариантов удаляются для каждого варианта, принадлежавшего затронутому предмету в старом снимке. Затем добавляются строки из патча.

- [ ] **Step 1: Failing tests:**
  - `replaces the slice of a touched item and keeps other items as they were`: строки других предметов — те же ссылки;
  - `removes an item listed in itemIds but absent from items, with its variants, values, photos and stock`;
  - `drops attribute values of a variant the item no longer has`;
  - `replaces a small table only when the patch carries it`;
  - `returns a new object and leaves the input untouched`: вход заморожен через `structuredClone` + deep freeze;
  - `throws for another inventory's patch`.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/patch.test.ts` → FAIL (нет модуля).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(core): patchSnapshot applies the rows a write returned`.

---

### Task 4: `apply` возвращает ревизии и затронутые строки

**Files:**
- Modify: `packages/core/src/storage.ts`, `packages/storage-postgres/src/{storage,migrator}.ts`.
- Create: `packages/storage-postgres/src/commands/reads.ts`.
- Test: `packages/storage-postgres/test/apply-result.test.ts` (новый), `test/neon.conformance.test.ts`.

**Interfaces:**
- Consumes:
  - `PgExecutor.batch(...): Promise<Record<string, unknown>[][]>` (Task 1);
  - `SnapshotPatch` (Task 3);
  - строковые запросы снимка из `queries.ts`, вынесенные так, чтобы их можно было отфильтровать по предметам.
- Produces:
```ts
// core/src/storage.ts
export interface ApplyResult {
  /** Revision before this write, read under a lock on the revision row: no other write committed in between.
   *  Null when the row was missing. */
  prevRev: string | null
  /** Revision after this write. */
  rev: string
  /** What the command touched, read in the same transaction after the write; null for wide commands (reload). */
  patch: SnapshotPatch | null
}
apply(command: Command, actor: Actor): Promise<ApplyResult>
```
- **Порядок инструкций пакета:**
  1. блокировка и чтение `select value from gm_meta where key = 'rev' for update` → `prevRev`;
  2. предварительное разрешение id (ниже);
  3. инструкции команды;
  4. подъём ревизии с `returning value` → `rev`;
  5. чтения затронутого.
- **Предварительное разрешение.** `photo.remove` и `deletePermanently` варианта знают только id удаляемой строки. Предмет и инвентарь для них разрешаются **до** инструкций команды, например в транзакционную настройку через `set_config(..., true)`, которую читают последующие чтения. Миграции продолжают поднимать ревизию как сейчас.
- **`affectedReads(c: Command): { statements: Statement[]; toPatch(rows: Record<string, unknown>[][]): SnapshotPatch } | null`** в `reads.ts`:
  - **срез предмета:**
    - `item.*`, `variant.*` (вариант → его предмет);
    - `stock.*` (`itemId`);
    - `photo.add`, `photo.reorder` (`itemId`), `photo.remove` (предварительно);
    - `archive` и `deletePermanently` для `item` и `variant`;
  - **`folders` целиком:** `folder.create`, `folder.update`, `folder.move`;
  - **`tags` целиком:** `tag.create`, `tag.rename`;
  - **`attributes` целиком:** `attribute.create`, `attribute.update`;
  - **`units` целиком:** `unit.create`, `unit.update`;
  - **строка `inventory`:** `inventory.create`, `inventory.update`, `archive` инвентаря;
  - **`null` (полная загрузка):**
    - `restore`;
    - `archive` и `deletePermanently` папки;
    - `deletePermanently` инвентаря;
    - `tag.delete`, `attribute.delete`, `unit.delete`.

- [ ] **Step 1: Failing tests** в `apply-result.test.ts`:
  - `prevRev is the revision before the write and rev the one after`: сверка с `listInventories` до и после;
  - `stock.receive returns the item's slice with the new stock line`: `patch.itemIds` = `[item]`, количество обновлено;
  - `photo.remove returns the item's slice without the photo`;
  - `deletePermanently of a variant returns the item's slice without it`;
  - `deletePermanently of an item returns its id with no item row`;
  - `folder.create returns the whole folders table with the new folder`;
  - `inventory.update returns the inventory row`;
  - `a wide command returns no patch`: каждая команда из списка `null`;
  - `a replayed command returns the same rows and a new revision`;
  - `the patch does not grow with the inventory`. 2 000 предметов вставляются одним SQL-запросом через исполнитель. Затем `JSON.stringify(result.patch).length` для `item.create` и для `photo.add` ≤ 5 000 и отличается от той же записи в инвентаре из одного предмета не больше чем на 10 %.

    **[решение Claude]** Этот тест вместе с тестами 1–2 Task 6 закрывает приёмку 12 спеки без прогона 4 000 записей: 4 000 × ≤ 5 КБ ≤ 20 МБ ≤ 50 МБ, полных загрузок 0.
- [ ] **Step 2: Conformance** (HTTP и WS):
  - `apply returns rows and revisions`;
  - `concurrent applies are serialized on the revision row`: две записи одновременно через два исполнителя → `prevRev` одной равен `rev` другой.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `pnpm test` → PASS (существующие `await storage.apply(...)` не ломаются); `pnpm typecheck` → PASS.
- [ ] **Step 6: Commit** `feat(storage): apply returns revisions and the rows the command touched`.

---

### Task 5: Свойство-тест — патч равен полной загрузке

**Files:**
- Modify: `packages/storage-postgres/package.json` (dev: `fast-check@^4.10.2`), `pnpm-lock.yaml`.
- Create: `packages/storage-postgres/test/patch.property.test.ts`.

**Interfaces:**
- Consumes: `apply(...): Promise<ApplyResult>` (Task 4), `patchSnapshot` (Task 3), `loadInventoryWithRev` (Task 2).

- [ ] **Step 1: Write** `patch equals a fresh load after every command`.
  - Одна PGlite-база на файл. Каждый прогон создаёт свой инвентарь с затравкой: 2 папки, 3 предмета с вариантами, тег, атрибут, единица.
  - Генератор строит команды по текущему снимку: id берутся из снимка. Покрыты все типы `Command`. Команды, которые отклоняет `validateCommand` или база, пропускаются.
  - После каждой команды:
    - `if (r.patch) expect(norm(patchSnapshot(before, r.patch))).toEqual(norm(after.snapshot))`;
    - `expect(r.rev).toBe(after.rev)`.
  - `norm` сортирует каждый массив по id; `stock` — по `itemId`, затем `variantId`.
  - `numRuns: 200`, длина последовательности до 15.
  - После прогонов проверяется, что каждый тип команды применён хотя бы раз.
- [ ] **Step 2: Write** `a foreign write between own writes shows as a different prevRev`.
  - Второй «актор» пишет между двумя своими командами.
  - `r2.prevRev !== r1.rev`. Патч всё равно совпадает с загрузкой по затронутым предметам.
- [ ] **Step 3: Check the UI does not depend on SQL row order.** Пройти `lib/views.ts`, `lib/item-view.ts`, `lib/lists.ts` и компоненты, которые читают `state.snapshot` напрямую. Если где-то используется порядок из SQL — сортировать там.
- [ ] **Step 4: Run** `pnpm vitest run packages/storage-postgres/test/patch.property.test.ts` → PASS. Расхождения чинятся в `reads.ts` или `patch.ts`, а не в тесте.
- [ ] **Step 5: Commit** `test(storage): property test — a patched snapshot equals a fresh load`.

---

### Task 6: Запись в workspace без полной загрузки

**Files:**
- Modify: `packages/app/app/lib/{workspace,workspace-types,device-db}.ts`, `packages/app/app/plugins/workspace.client.ts` (только `flushCache` на `hidden`).
- Test: `packages/app/test/workspace.test.ts`, `packages/app/test/device-db.test.ts`.

**Interfaces:**
- Consumes: `ApplyResult` (Task 4), `patchSnapshot` (Task 3), `loadInventoryWithRev` (Task 2).
- Produces:
  - `DeviceDb.advanceSnapshotRevs(sourceId: string, from: string, to: string, exceptInventoryId: string): Promise<void>`. Каждая сохранённая копия источника, кроме `exceptInventoryId`, записанная при ревизии `from`, теперь записана при `to`. Ревизия хранится отдельным ключом `snapshotRev:<sourceId>:<inventoryId>`, чтобы не переписывать сам снимок. Поле `rev` внутри старых записей читается как запасное.
  - `DeviceDb.markSnapshotStale(ref: InventoryRef): Promise<void>` — ревизия копии становится неизвестной.
  - `Workspace.flushCache(): Promise<void>` — немедленно сохраняет отложенную копию.
  - `CACHE_PUT_DELAY_MS = 2_000`: отложенное сохранение копии не чаще раза в 2 с. Снимок и его ревизия пишутся вместе.
- **Правила `write()` после ответа.** Цель — инвентарь, в который ушла команда. «Известная ревизия источника» — `sourceRevs`.
  1. **Синхронность:** `inSync = r.prevRev !== null && r.prevRev === sourceRevs.get(sourceId)`.
  2. **Цель показана, за время записи полных загрузок не было** (сравнить `appliedSeq` до и после), `r.patch` есть и `r.patch.inventoryId === цель`:
     - `state.snapshot = markRaw(patchSnapshot(state.snapshot, r.patch))`;
     - отложенное сохранение.
  3. **Цель показана, за время записи прошла полная загрузка:** патч не применяется. Если `shownRev !== r.rev`, копия помечается устаревшей (`shownRev = null`).
  4. **Цель показана, `r.patch === null`** (широкая команда): `loadCurrent()` без пропуска.
  5. **Цель не показана:** `db.markSnapshotStale(цель)`.
  6. **Ревизии.**
     - Если `inSync`:
       - `sourceRevs.set(sourceId, r.rev)`;
       - если показанная копия была при `r.prevRev`, то `shownRev = r.rev`;
       - `db.advanceSnapshotRevs(sourceId, r.prevRev, r.rev, цель.inventoryId)`;
       - `state.lastRefreshAt = nowIso()`: запись считается проверкой.
     - Иначе показанная копия этого источника помечается устаревшей, а `lastRefreshAt` не трогается.
  7. **Команды списка** (`isRelistCommand`): как сейчас, `relist` + `resolveCurrent`. После правил 2–6 это не должно давать полной загрузки при `inSync`.
  8. **Исход неизвестен** (`apply` отклонён с `unavailable`): показанная копия этого источника помечается устаревшей, `sourceRevs.delete(sourceId)`. Ошибка пробрасывается.
  9. **Отклонено базой** (`StorageError('failed')` или `DomainError` из `apply`): сразу `refresh()`, затем ошибка пробрасывается.

- [ ] **Step 1: Failing tests** (`workspace.test.ts`). Для теста 7 харнесс получает флаг «записать, затем отклонить с `unavailable`».
  1. `twenty stock receipts in a row load nothing`: `loadCalls` +0, остаток в `state.snapshot` равен сумме.
  2. `quick add with a photo loads nothing`: `item.create` + `addPhotos`, `loadCalls` +0, предмет и фото в копии.
  3. `a foreign write between two own writes keeps both own rows and marks the copy stale; the next refresh loads once`.
  4. `an own write in inventory A keeps B's cached copy current`: запись в A, `selectInventory(B)` → `loadCalls` +0.
  5. `a write to a non-current inventory marks its cached copy stale`: `applyTo(B)` при показанном A, затем `selectInventory(B)` → `loadCalls` +1.
  6. `a wide command reloads the current inventory once`: `tag.delete` → `loadCalls` +1.
  7. `an unknown outcome marks the copy stale; retrying the same command leaves the item once`.
  8. `a rejected write refreshes at once`: `applyError = new StorageError('failed')` → `listCalls` +1 до того, как `apply` отклонён.
  9. `a load that finished during a write is not overwritten by the write's older rows`: `applyGate` держит запись, `refresh()` грузит копию, запись завершается.
  10. `the cached copy and its revision are saved together`.
      - Запись, затем новый workspace на той же `DeviceDb` без `flushCache`: копия либо содержит запись, либо её ревизия ≠ ревизии источника.
      - После `flushCache` — содержит, и ревизии равны.
  11. `an in-sync write counts as a check, a stale one does not`: `lastRefreshAt` обновлён или не тронут.
- [ ] **Step 2: Failing tests** (`device-db.test.ts`) для `advanceSnapshotRevs` и `markSnapshotStale` на memory и IndexedDB (`workspace-idb.test.ts` уже поднимает fake-indexeddb).
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement.** Если `workspace.ts` (777 строк) мешает, выделить запись в `lib/workspace-write.ts`. Отдельный рефакторинг не нужен.
- [ ] **Step 5: Run** `pnpm test` → PASS. Существующие тесты, которые ждали перезагрузку после записи, переписать под новые правила, ничего не ослабляя.
- [ ] **Step 6: Commit** `perf(app): writes patch the local copy instead of reloading the inventory`.

---

### Task 7: «Sync», «Reload everything», интервал проверки

**Files:**
- Modify: `packages/app/app/lib/{workspace,workspace-types,device-db}.ts`, `packages/app/app/plugins/workspace.client.ts`.
- Test: `packages/app/test/workspace.test.ts`.

**Interfaces:**
- Produces:
```ts
export type CheckInterval = '5m' | '15m' | '1h' | '6h' | '1d' | 'never'
export const DEFAULT_CHECK_INTERVAL: CheckInterval = '15m'
export const CHECK_INTERVAL_MS: Record<Exclude<CheckInterval, 'never'>, number> // 5, 15, 60, 360, 1440 minutes
// DeviceSettings.checkInterval?: CheckInterval; WorkspaceState.checkInterval: CheckInterval
sync(): Promise<'unchanged' | 'updated'>
reloadSource(sourceId: string): Promise<void>
syncIfDue(): Promise<void>
setCheckInterval(value: CheckInterval): Promise<void>
```
- **`sync()`** = `refresh()`: списки всех источников и проверка ревизии.
  - `'updated'` — если показанная копия за этот вызов заменена полной загрузкой.
  - Отклоняется с `StorageError('unavailable')`, если текущий источник после вызова не подключён.
- **`reloadSource(id)`:**
  - все сохранённые копии источника и показанная, если она из него, помечаются устаревшими;
  - затем `refresh()`;
  - та же ошибка, если источник не подключён.
- **`syncIfDue()` заменяет `refreshIfStale(maxAgeMs)`.**
  - Ветка неисправных источников не меняется:
    - текущий неисправен → `refresh()` сразу;
    - другой неисправен → не чаще раза в `FAILED_RETRY_MS`.
  - Исправные:
    - `'never'` → ничего;
    - иначе `refresh()`, если `lastRefreshAt` нет или он старше интервала.
- **Вызовы `syncIfDue()`:**
  - в `write()` перед проверкой команды (внутри очереди);
  - в `loadMovements()` перед чтением;
  - в плагине на `visibilitychange: visible`. `STALE_AFTER_MS` удалить.

- [ ] **Step 1: Failing tests:**
  1. `sync with an unchanged source lists once, loads nothing and returns unchanged` — и сразу после запуска, и после трёх своих записей;
  2. `sync after another device wrote loads once and returns updated`;
  3. `sync lists every source`: два источника, `listCalls` +2;
  4. `reloadSource loads the current inventory even when the revision matches; another cached inventory of the source loads when opened`;
  5. `syncIfDue within the interval does nothing; after it, it checks once`: `flags.clock`;
  6. `with never, syncIfDue leaves a healthy source alone; sync still checks`;
  7. `a failing current source is retried at once whatever the interval`;
  8. `a write after the interval checks first`: `listCalls` +1 до `applyCalls` +1;
  9. `the interval is kept on the device`: `setCheckInterval('1h')`, новый workspace на той же `DeviceDb` → `state.checkInterval === '1h'`, по умолчанию `'15m'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Существующие тесты `refreshIfStale` перевести на `syncIfDue` с интервалом.
- [ ] **Step 4: Run** `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(app): sync by revision, reload a source, and a check interval`.

---

### Task 8: Интерфейс — «Sync», интервал, «Reload everything»

**Files:**
- Modify:
  - `packages/app/app/components/InventorySwitcher.vue`;
  - `packages/app/app/pages/settings/index.vue`;
  - `packages/app/app/lib/format.ts`;
  - `packages/app/i18n/locales/en.json`.
- Test: `packages/app/test/format.test.ts`.

**Interfaces:**
- Consumes: `sync`, `reloadSource`, `setCheckInterval`, `state.checkInterval`, `state.lastRefreshAt` (Task 7).
- Produces: `checkedAgo(iso: string | null, now: Date): { key: 'sync.notChecked' | 'sync.checkedJustNow' | 'sync.checkedMinutes' | 'sync.checkedHours' | 'sync.checkedDays'; n?: number }` в `lib/format.ts`. Округление вниз.

**Тексты (`en.json`, дословно):**
```json
"sync": {
  "action": "Sync",
  "notChecked": "Not checked yet",
  "checkedJustNow": "Checked just now",
  "checkedMinutes": "Checked {n} min ago",
  "checkedHours": "Checked {n} h ago",
  "checkedDays": "Checked {n} d ago",
  "upToDate": "Up to date",
  "updated": "Updated",
  "reload": "Reload everything",
  "reloadHint": "Downloads this source's data again. Use it if something looks wrong.",
  "reloading": "Reloading…",
  "reloaded": "Reloaded",
  "interval": "Check for changes",
  "intervalHint": "How often to look for changes made on other devices",
  "every5m": "Every 5 min",
  "every15m": "Every 15 min",
  "every1h": "Every hour",
  "every6h": "Every 6 hours",
  "every1d": "Once a day",
  "never": "Never"
}
```

- **Меню инвентаря.**
  - Первым пунктом после разделителя, перед «New inventory», идёт «Sync»: иконка `RefreshCw` (lucide), под названием мелко — `checkedAgo(state.lastRefreshAt, now)`.
  - Во время вызова иконка вращается (`motion-safe:animate-spin`), а пункт неактивен.
  - Результат — `toast` `sync.upToDate` или `sync.updated`. Ошибка — `toast.error(t(errorMessageKey(e)))`.
  - Пункт виден, если есть хоть один источник.
- **Settings, раздел «This device»**, под именем устройства: подпись `sync.interval`, `Select` из `components/ui/select` с шестью вариантами, подсказка `sync.intervalHint`.
- **Settings, действия источника:** рядом с «Export backup», в том же стиле (`sourceAction`), кнопка `sync.reload`.
  - Во время вызова — `sync.reloading`.
  - Неактивна, пока источник не `ready` и не `read_only`.
  - Под кнопкой — `sync.reloadHint`, тем же мелким стилем, что `exportHint`.
  - Результат — `toast` `sync.reloaded`. Подтверждение не нужно.

- [ ] **Step 1: Failing test** `checkedAgo`: `null` → `notChecked`; 59 с → `checkedJustNow`; 60 с → `checkedMinutes` 1; 59 мин → 59; 60 мин → `checkedHours` 1; 24 ч → `checkedDays` 1.
- [ ] **Step 2: Implement** компоненты и тексты.
- [ ] **Step 3: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 4: Browser check** — два скриншота, из отдельного worktree на порту 3001, демо-источник:
  - меню инвентаря на телефонной ширине 390 px с пунктом «Sync» и подписью;
  - Settings с интервалом и «Reload everything».

  Нажать «Sync» → тост «Up to date».
- [ ] **Step 5: Commit** `feat(app): Sync in the inventory menu, check interval and Reload everything in Settings`.

---

## Приёмка владельцем

1. На телефоне быстро добавить 5–10 пакетиков с фото: сохранение мгновенное, полосы «updating» нет.
2. Поменять что-то с компьютера, на телефоне нажать «Sync» в меню инвентаря → изменение видно, тост «Updated». Нажать ещё раз → «Up to date».
3. Settings → «Check for changes» → «Never». Свернуть и развернуть приложение — проверки нет. «Sync» работает.
4. Settings → источник → «Reload everything» → тост «Reloaded».
