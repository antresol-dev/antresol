# Цвета предметов и тегов, поиск по всем инвентарям — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (или superpowers:executing-plans). Шаги — чекбоксы.

**Goal:** предмету и тегу можно выбрать цвет из палитры Appearance; палитра команд умеет искать во всех инвентарях.

**Architecture:** цвет хранится буквальным hex (`#RRGGBB`) в `items.color` и `tags.color` (миграция `0005`), путь данных — как у иконок (d7bcaef). Как цвет рисуется — решает приложение: `app/lib/item-colors.ts` (палитра, тёмный оттенок, цвет по id) и CSS-переменные `--c-light` / `--c-dark`. Поиск по всем инвентарям — сохранённые на устройстве копии других инвентарей, через новый `workspace.cachedSnapshot`.

**Tech Stack:** TypeScript, Vitest, Postgres (PGlite, Neon `_test`), drizzle-kit, Nuxt 4, Vue 3, Reka UI, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-11-15-antresol-minor-ideas-design.md`

**Где:** ветка `minor-ideas`, worktree `.worktrees/minor-ideas` (от master 4ac38dc). Задачи — в своих worktree от `minor-ideas`, вливаются по готовности. Без проверки в браузере: владелец смотрит сам. Ревью отдельной задачи — только у задачи 1 (данные, opus). В конце одно ревью всей ветки (opus). Vitest `--maxWorkers=3`, полный прогон один раз на задачу; набор соответствия Neon `_test` — один прогон, не параллельно с другим worktree.

## Global Constraints

- Палитра — `ACCENTS` из `app/lib/accent.ts`, в порядке `ACCENT_NAMES`; хранимое значение — `ACCENTS[name].light`.
- Формат цвета: `^#[0-9A-F]{6}$` (верхний регистр). `normalizeCommand` переводит `color` в верхний регистр, проверка ядра отклоняет остальное с `invalid_option`.
- `items.color` null — цвет по id; `tags.color` null — серый чип, как сейчас.
- Тёмный оттенок: цвет палитры — свой `dark`; любой другой hex — `mix(hex, '#FFFFFF', 0.55)`.
- Цвет только у предмета; у вариантов нет ни цвета, ни настройки. Новый предмет из черновика приёмки — `color: null`.
- Миграция аддитивная, `min_app_schema` не меняется; `APP_SCHEMA_VERSION` становится 8.
- Пользовательские строки — только в `packages/app/i18n/locales/en.json`.

## Review Focus

1. **Старая резервная копия (schema ≤ 7) без поля `color`** восстанавливается, у всех предметов и тегов `color = null` — тест в задаче 1.
2. **Цвет, которого больше нет в палитре** (`#123456`, записан MCP) — рисуется с тёмным оттенком по правилу 55 % и показывается в выборе отдельным выбранным кружком, не теряется при сохранении формы — тесты в задачах 2 и 3.
3. **Hex в нижнем регистре от MCP** (`#4f46e5`) — принимается и хранится как `#4F46E5`, а не отклоняется — тест в задаче 1.
4. **Поиск по всем при отсутствии копий:** другие инвентари ни разу не открывались на устройстве — результаты только текущего, строка «пропущено N», без ошибки — тест в задаче 4.
5. **Один и тот же инвентарь в двух источниках** (копия восстановлена в другой источник с теми же id) — строки палитры не схлопываются: ключ строки содержит `sourceId` — тест в задаче 4.

---

### Task 1: данные — `color` у предмета и тега

**Files:**
- Modify: `packages/core/src/model.ts` (`Item.color`, `Tag.color`), `limits.ts` (`isColorHex`), `commands.ts`, `validate.ts`, `intakes.ts` (`snapshotAfterIntake`: `color: null`)
- Modify: `packages/storage-postgres/src/schema.ts`, `rows.ts`, `queries.ts`, `restore.ts`, `commands/items.ts`, `commands/dictionaries.ts`, `commands/index.ts`, `commands/reads.ts`
- Create: `packages/storage-postgres/migrations/0005_colors.sql` + `meta/` (только `pnpm --filter @antresol/storage-postgres exec drizzle-kit generate --name colors`)
- Create: `packages/storage-postgres/test/fixtures/schema7-color-writes.ts` (FROZEN: текущий `tag.create` insert без `color`, дословно)
- Modify: `packages/app/app/lib/backup.ts`
- Test: `packages/core/test/validate.test.ts`, `packages/storage-postgres/test/{items,migrator,restore,neon.conformance}.test.ts`, `packages/app/test/backup.test.ts`, фикстуры (`core/test/fixtures.ts`, `restore-fixtures.ts`)

**Interfaces — Produces:**
- `Item.color: string | null`, `Tag.color: string | null`
- `isColorHex(v: string): boolean` в `@antresol/core` (`/^#[0-9A-F]{6}$/`)
- Команды: `item.create` и `item.update` — `color?: string | null`; `tag.create` — `color?: string | null`; новая `{ type: 'tag.update'; id: Id; name?: string; color?: string | null }`. `tag.rename` остаётся как есть (старые приложения и MCP).

- [ ] **Шаг 1: падающие тесты ядра** в `validate.test.ts`:
  - `item.update` с `color: '#4F46E5'` и с `null` проходит; `'red'`, `'#4F46E'`, `'#4F46E5FF'` → `invalid_option`;
  - `normalizeCommand({ type: 'item.update', id, color: '#4f46e5' }).color === '#4F46E5'`, то же для `tag.create` и `tag.update`;
  - `tag.update` несуществующего тега → `not_found`; имя как у другого тега → `duplicate_name`; только `color` без `name` — проходит; `color: '#zzzzzz'` → `invalid_option`.
- [ ] **Шаг 2:** `pnpm vitest run packages/core/test/validate.test.ts` — FAIL.
- [ ] **Шаг 3: ядро.** Поля модели, `isColorHex`, команды, `checkColor(c?: string | null)` по образцу `checkIcon`; `tag.update` проверяется как `tag.rename`, но `name` необязательно; `normalizeCommand` — `color` в верхний регистр, если строка.
- [ ] **Шаг 4:** тесты ядра PASS.
- [ ] **Шаг 5: падающие тесты хранилища** (`items.test.ts` или новый блок рядом с иконками): `item.create` с цветом и `item.update` на другой и на `null` — снимок отдаёт их; `tag.create` с цветом, `tag.update` только цвета, только имени; прямой insert `color = '#4f46e5'` в базу отклоняется проверкой; `migrator.test.ts`: `APP_SCHEMA_VERSION` 8, пустая база проходит 0000–0005 (шестой батч содержит `"color"`), записи схемы 7 (frozen `tag.create` и frozen `item.create` из schema6-фикстуры) работают на базе схемы 8; `restore.test.ts`: копия с цветами восстанавливается с ними.
- [ ] **Шаг 6: хранилище.** `color text` у `items` и `tags` в `schema.ts` с `check('items_color_check', sql\`${t.color} ~ '^#[0-9A-F]{6}$'\`)` и `tags_color_check`; сгенерировать `0005_colors` (drizzle-kit только генерирует, руками SQL не писать, кроме комментария-шапки как в `0004_icons.sql`); `color` в insert/update предметов и тегов (`tag.update` через `updateSet({ name, color, updated_by })`), в `snapshotSql.items` / `snapshotSql.tags`, `toItem` / `toTag`, `RESTORE_TABLES` и `segmentsOf`; `affectedReads` для `tag.update` — как `tag.rename`; `commands/index.ts` направляет `tag.update` в `dictionaryStatements`.
- [ ] **Шаг 7:** тесты хранилища PASS; набор соответствия Neon один раз (`ANTRESOL_NEON_TEST_URL` из `.env.local`, значение не печатать), ожидание `{ dbVersion: 8, appVersion: 8, minAppSchema: 3 }`.
- [ ] **Шаг 8: резервная копия.** `backup.test.ts`: копия с `color` у предмета и тега сохраняет их; `color: '#zzz'` → `{ error: 'format' }`; файл схемы 7 без `color` читается, у всех предметов и тегов `color === null`. В `backup.ts`: `colorHex` check, `COLOR_DEFAULTS = { color: null }` для `items` и `tags` (формат файла остаётся версии 1, как с иконками).
- [ ] **Шаг 9:** `pnpm test --maxWorkers=3` и `pnpm typecheck` — зелёные (в т.ч. `demo-source.test.ts`, если сид называет поля).
- [ ] **Шаг 10: commit** `feat(core,storage): items and tags carry a colour (migration 0005), tag.update, kept in backups`.

### Task 2: как цвет рисуется — миниатюры

**Files:**
- Create: `packages/app/app/lib/item-colors.ts`, `packages/app/test/item-colors.test.ts`
- Modify: `packages/app/app/components/ItemThumb.vue`, `packages/app/app/lib/views.ts` (`ItemRow.color`, `SearchRow.color`), места `<ItemThumb>` (`ItemList`, `SearchPalette`, `QuickAddForm`, `ShareSheet`, `UsedBySheet`, `ItemGallery`), `packages/app/app/assets/css/main.css`
- Test: `packages/app/test/views.test.ts`

**Interfaces:**
- Consumes: `Item.color` (задача 1).
- Produces (`app/lib/item-colors.ts`):
  - `PALETTE: readonly string[]` — `ACCENT_NAMES.map((n) => ACCENTS[n].light)`;
  - `paletteName(hex: string): AccentName | null`;
  - `darkShade(hex: string): string` — верхний регистр;
  - `defaultItemColor(id: string): string` — `PALETTE[thumbTone(id, PALETTE.length)]`;
  - `itemColor(item: { id: string; color: string | null }): string`;
  - `colorVars(hex: string): { '--c-light': string; '--c-dark': string }`.
- CSS (`main.css`): `.colored { --c: var(--c-light) }`, `.dark .colored { --c: var(--c-dark) }`; `.thumb-colored` — фон `color-mix(in srgb, var(--c) 15%, var(--thumb))` (в `.dark` — 20 %), текст и иконка `var(--c)`, рамка `outline: 1.5px solid var(--c); outline-offset: -1.5px` (рамка поверх фото, размер не меняется).

- [ ] **Шаг 1: падающие тесты** `item-colors.test.ts`: `PALETTE.length === ACCENT_NAMES.length` и `PALETTE[0] === '#4F46E5'`; `darkShade('#4F46E5') === '#B0ACF3'`; `darkShade('#9A4F1E') === '#E0A273'` (медь — свой оттенок); `darkShade('#000000') === '#8C8C8C'`; `defaultItemColor(id)` входит в `PALETTE` и одинаков при повторе; `itemColor({ id, color: '#123456' }) === '#123456'`, при `null` — `defaultItemColor(id)`; `paletteName('#123456') === null`. `views.test.ts`: строка списка и строка поиска несут `color` предмета (null или hex).
- [ ] **Шаг 2:** FAIL.
- [ ] **Шаг 3:** реализовать `item-colors.ts`; `color` в `ItemRow` / `SearchRow`; `ItemThumb` получает проп `color: string | null`, вешает `colored thumb-colored` и `colorVars(itemColor({ id, color }))`; массив `TONES` и `--st-thumb-tone-*` больше не используются миниатюрой. Если у `thumbTones` в `lib/styles/` не осталось потребителей — убрать токен и его тесты (`style.test.ts`), `thumb-tone.ts` (хеш) оставить.
- [ ] **Шаг 4:** тесты PASS, `pnpm typecheck`, design-scale guard зелёный.
- [ ] **Шаг 5: commit** `feat(app): item thumbnails take the item's colour from the accent palette, framed; the default comes from the id`.

### Task 3: выбор цвета — предмет и тег

**Files:**
- Create: `packages/app/app/components/ColorSwatches.vue`, `packages/app/test/color-swatches.test.ts` (логика списка — в `item-colors.ts`)
- Modify: `ItemForm.vue`, `IconField.vue`, `TagsSection.vue`, `ItemAbout.vue`, `TagPicker.vue`, `ItemScreen.vue` (теги с цветом в `ItemAbout`), `i18n/locales/en.json`

**Interfaces:**
- Consumes: задача 1 (команды, `Tag.color`), задача 2 (`PALETTE`, `paletteName`, `colorVars`, `defaultItemColor`, CSS `.colored`).
- Produces:
  - `swatchChoices(current: string | null): string[]` в `item-colors.ts` — `PALETTE`, а если `current` не null и не в палитре — плюс `current` в конце;
  - `<ColorSwatches v-model="color" :auto="hex | null" :label="string" :disabled="bool" />` — радиогруппа по образцу `AccentPicker`: первым кружок «Auto» (если `auto` задан, залит этим цветом и подписан «Auto») или «None» (если `auto === null`), дальше `swatchChoices(modelValue)`; `aria-label` кружка — имя из `settings.appearance.accents.<name>`, для цвета вне палитры — его hex.

- [ ] **Шаг 1: падающий тест** `swatchChoices(null)` равен `PALETTE`; `swatchChoices('#2563EB')` равен `PALETTE`; `swatchChoices('#123456')` — `PALETTE` и `'#123456'` последним.
- [ ] **Шаг 2:** FAIL → реализовать → PASS.
- [ ] **Шаг 3: предмет.** В `ItemForm` под `IconField` — `ColorSwatches` с `auto = defaultItemColor(id)`; значение уходит в `item.update` (и в `item.create`, если форма создаёт предмет) только когда изменилось. `IconField` получает `color: string` (действующий цвет) и красит иконку превью.
- [ ] **Шаг 4: тег.** В листе тега (`TagsSection`, create и rename) под полем имени — `ColorSwatches` с `auto = null`; создание шлёт `tag.create` с `color`, правка — один `tag.update` с изменёнными `name` / `color`. Чип в `ItemAbout`: цветной тег — `.colored`, фон `color-mix(in srgb, var(--c) 15%, transparent)`, текст `var(--c)`; серый — как сейчас. В строках `TagPicker` и `TagsSection` перед именем цветного тега — точка 8 px цвета `var(--c)`.
- [ ] **Шаг 5:** строки i18n: подпись поля «Colour», «Auto», «None»; `pnpm test --maxWorkers=3`, `pnpm typecheck`, guard — зелёные.
- [ ] **Шаг 6: commit** `feat(app): pick a colour for an item beside its icon, and for a tag`.

### Task 4: поиск по всем инвентарям

**Files:**
- Modify: `packages/app/app/lib/workspace-types.ts`, `workspace.ts` (`cachedSnapshot`), `packages/app/app/lib/palette.ts`, `packages/app/app/components/SearchPalette.vue`, `i18n/locales/en.json`
- Test: `packages/app/test/palette.test.ts`, тест workspace рядом с существующими тестами кэша

**Interfaces:**
- Produces:
  - `Workspace.cachedSnapshot(ref: InventoryRef): Promise<InventorySnapshot | null>` — копия из `DeviceDb.getSnapshot`, без сети; для текущего инвентаря не нужен (берётся `state.snapshot`).
  - `PaletteContext.others: { entry: InventoryEntry; snapshot: InventorySnapshot | null }[] | null` — null: чип выключен; `snapshot: null` — копии на устройстве нет.
  - Строки: `{ kind: 'item'; …; inventory: { ref: InventoryRef; name: string } | null }` и то же у `'folder'` (null — текущий инвентарь). Ключ строки другого инвентаря: `item:${sourceId}:${inventoryId}:${itemId}:${variantId ?? ''}`, `folder:${sourceId}:${inventoryId}:${id}`.
  - `PaletteGroup` получает необязательное `skipped?: number` у группы `items` — число инвентарей без копии.
  - `searchAcross(others, query, limit): …` — внутренняя функция `palette.ts`, переиспользуется будущей страницей «Расширенный поиск»; экспортировать.

- [ ] **Шаг 1: падающие тесты** `palette.test.ts`:
  - чип выключен (`others: null`) — результаты как сейчас (существующие тесты не меняются);
  - два инвентаря, оба с копией: строки текущего первыми, у строк другого `inventory.name` и путь вида `"Workshop · Box 3"`; общий предел `ITEM_LIMIT` (20) — текущий не вытесняется чужими;
  - архивный инвентарь (`entry.inventory.archivedAt !== null`) не ищется и не считается пропущенным;
  - инвентарь без копии — `skipped === 1`, без исключения;
  - одинаковые id в двух источниках — ключи строк различаются;
  - действия (`addItem`, `newFolder`, …) — только текущего.
- [ ] **Шаг 2:** FAIL → реализовать `palette.ts` (`snapshotSearch` на каждый снимок кэшируется как сейчас — по объекту снимка) и `cachedSnapshot` → PASS.
- [ ] **Шаг 3: палитра.** Чип «All inventories» рядом с названием инвентаря в поле (на телефоне — справа в строке поля, до «Cancel»), `aria-pressed`; состояние — `useLocalStorage('antresol.palette.allInventories', false)`. При открытии палитры с включённым чипом (или при включении) загрузить `cachedSnapshot` всех других неархивных инвентарей из `state.inventories`. Строка чужого предмета или папки: `run` закрывает палитру, вызывает `workspace.selectInventory(ref)` и сразу `router.push` пути предмета / папки (как `act` для `switchInventory`, ошибки — тостом). Под результатами, если `skipped > 0`, приглушённая строка «N inventories aren't on this device yet — open them once to search them».
- [ ] **Шаг 4:** `pnpm test --maxWorkers=3`, `pnpm typecheck`, guard — зелёные.
- [ ] **Шаг 5: commit** `feat(app): the palette can search every inventory saved on this device`.

## Порядок

Задачи 1 и 4 независимы — запускаются сразу параллельно. Задача 2 зависит от 1 только типом `Item.color` (можно начать параллельно на заглушке и влить после 1). Задача 3 — после 1 и 2. Задачи 2 и 4 обе трогают `SearchPalette.vue` (2 — один проп `color` у `ItemThumb`), конфликт мелкий: при слиянии оставить оба изменения.

## Перенос

- Ветка MCP (`@antresol/kit`): её записи предметов и тегов должны передавать `color`; `tag.update` доступен вместо `tag.rename`.
- Страница «Расширенный поиск»: заменит чип действием «Search in all inventories» в конце результатов; переиспользует `searchAcross`.
