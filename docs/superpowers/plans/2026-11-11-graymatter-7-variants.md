# План 7 — варианты по осям и числовые атрибуты

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вариант определяется значениями атрибутов-осей предмета, а не именем. Добавляется числовой тип атрибута с точным хранением. Схема базы строится с нуля, версия 3.

**Architecture:**
- **Ядро (`packages/core`).** Чистый модуль чисел (`numbers.ts`) и модуль вариантов (`variants.ts`: подпись, сортировка, уникальность, предпросмотр смены роли). Правила проверяет `validate.ts` по локальной копии.
- **Postgres-адаптер.** Выполняет команды одной транзакцией и возвращает изменённые строки по правилам Плана 6.
- **Приложение.** Показывает подпись из `core` везде, где раньше было `variant.name`.

**Tech Stack:** TypeScript, Vitest, Postgres (PGlite, Neon), drizzle-kit, Nuxt 4, Vue 3, shadcn-vue, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-11-11-graymatter-variants-design.md`. Основная спека — `docs/superpowers/specs/2026-11-10-graymatter-revival-design.md`. Правила записи и синхронизации — `docs/superpowers/specs/2026-11-11-graymatter-sync-design.md`.

## Global Constraints

- **Ветка.** Работа идёт в ветке `plan7-variants`. Каждая задача — в своём worktree `.worktrees/p7-tN` на ветке `p7-tN`, ответвлённой от текущей вершины `plan7-variants`. Контроллер вливает задачи в `plan7-variants`, а в конце `plan7-variants` вливается в `revival` локально.
- **Git.** Никаких push, PR и Pages. Никаких строк атрибуции в коммитах (`Co-Authored-By`, `Claude-Session`).
- **Что не трогать в git.** Не добавлять в индекс `packages/app/nuxt.config.ts`, `proposals.md`, `.claude/`, `.superpowers/`. Файлы добавляются только явными путями. Общий stash не трогать: никаких голых `stash` и `pop`.
- **Инструменты.** Только pnpm. Глобальную конфигурацию npm не менять. Легаси `api/` и `web/` не трогать.
- **Секреты.** Строки подключения, ключи и `.env.local` не печатать и не коммитить.
- **Тестовая база Neon.** Только база с именем на `_test`, адрес из `GM_NEON_TEST_URL`. Набор соответствия на Neon запускает только задача, где это написано: база общая, и параллельные прогоны дают ложные падения.
- **Dev-сервер** — только из своего worktree, на порту 3001, без `--host`. Серверы владельца на 3000 и 3002 не трогать.
- **Проверка в браузере** — только общая картина: один снимок главного экрана задачи на 1280 px и один на 360 px (без горизонтальной прокрутки). Сценарии не прокликивать.
- **Интерфейс.** Тексты на английском, в `packages/app/i18n/locales/en.json`, в стиле существующих. Никаких цветных кнопок, только существующие компоненты и токены.
- **Числа атрибутов** не хранятся и не сравниваются как float: только каноническая десятичная строка и BigInt.
- **Команды.** Все тесты: `pnpm test` (`vitest run` в корне). Один файл: `pnpm vitest run <path>`. Проверка типов: `pnpm typecheck`. Линтер: `pnpm lint`.
- **Временно красная сборка.** Между задачами 3 и 6 часть пакетов может не собираться: модель в `core` уже новая, а адаптер и приложение ещё старые. Задача проверяет свой пакет. Ошибки типов в файлах, которыми владеет другая задача, ожидаемы — перечислите их в отчёте и не чините.

## Review Focus

1. **Ввод с телефона.** Русские приставки и автозаглавные буквы: `4,7к` — это 4700, `М` — мега, `м` — милли. У числового поля выключены `autocapitalize` и `autocorrect`. Тест в задаче 1, атрибуты поля в задаче 6.
2. **Дубль при устаревшей копии.** Другое устройство уже добавило вариант с теми же значениями, а локальная копия о нём не знает. В базе появляются два одинаковых варианта. Это допустимо, как сейчас с именами, но подпись и сортировка не должны падать: дубли идут по id. Тест в задаче 3.
3. **Смена единицы или приставок у атрибута, у которого уже есть значения.** Хранимые значения не меняются, меняется только показ. Тест в задаче 1 (формат при выключенных приставках) и в задаче 4 (`attribute.update` не трогает значения).
4. **Значения за пределами приставок y и Y.** Показ — `0.1 yF` и `1000 YΩ`, без исключений. Тест в задаче 1.
5. **Вставка списка из другой программы.** Переводы строк `\r\n`, лишний `;` в конце строки, пустые строки. Тест в задаче 6 (`lists.ts`).

---

## Порядок и параллельность

| Волна | Задачи (параллельно) | Зависят от |
|---|---|---|
| 1 | 1 (числа), 2 (схема и кэш) | — |
| 2 | 3 (модель и правила ядра) | 1 |
| 3 | 4 (адаптер Postgres), 5 (поиск), 6 (данные приложения) | 4 — от 2 и 3; 5 и 6 — от 3 |
| 4 | 7 (оси и общие атрибуты), 8 (добавление и правка вариантов) | 4 и 6 |
| 5 | 9 (демо-данные и полная проверка) | все |

Ревью по ходу получают только задачи 3 и 4: это логика данных. Всё остальное проверяет итоговое ревью ветки.

Сопоставление с приёмкой спеки (§6):

| Пункты приёмки | Задачи |
|---|---|
| 1 | 1, 8 |
| 2 | 1 |
| 3 | 1, 3 |
| 4 | 3, 8 |
| 5 | 3, 4 |
| 6 | 3, 7 |
| 7 | 3 |
| 8 | 8 |
| 9 | 3, 4, 7 |
| 10 | 2 |
| 11 | 5 |
| 12 | 3, 8 |
| 13 | 6 |
| 14 | 2 |
| 15 | 4 |

---

### Task 1: Модуль чисел атрибутов

**Files:**
- Create: `packages/core/src/numbers.ts`
- Modify: `packages/core/src/index.ts` (экспорт)
- Test: `packages/core/test/numbers.test.ts`

**Interfaces:**
- Consumes: `SI_PREFIXES` из `packages/core/src/units.ts`.
- Produces:
  - `export type NumberValue = string` — каноническая десятичная строка (спека §4.1);
  - `export interface NumberRules { unit: string; siPrefixes: boolean }`;
  - `export function parseNumberValue(input: string, rules: NumberRules): NumberValue | null`;
  - `export function formatNumberValue(value: NumberValue, rules: NumberRules): string`;
  - `export function isCanonicalNumber(s: string): boolean`;
  - `export function compareNumberValues(a: NumberValue, b: NumberValue): -1 | 0 | 1`.

- [ ] **Step 1: Write the failing table tests** in `numbers.test.ts`

Правила: `ohm = { unit: 'Ω', siPrefixes: true }`, `farad = { unit: 'F', siPrefixes: true }`, `meter = { unit: 'm', siPrefixes: true }`, `plainOhm = { unit: 'Ω', siPrefixes: false }`, `bare = { unit: '', siPrefixes: true }`, `count = { unit: '', siPrefixes: false }`.

`parseNumberValue`:

| input | rules | expected |
|---|---|---|
| `4k7`, `4.7k`, `4,7к`, `4700`, `4.7 kΩ`, `4.7kΩ`, `  4.7 k ` | ohm | `'4700'` |
| `100p` | farad | `'0.0000000001'` |
| `4,7p`, `4700f` | farad | `'0.0000000000047'` (оба) |
| `1e-9` | farad | `'0.000000001'` |
| `4E7` | ohm | `'40000000'` |
| `5E` | ohm | `'5000000000000000000'` |
| `5m` | meter | `'5'` |
| `5mm` | meter | `'0.005'` |
| `5k` | meter | `'5000'` |
| `1M`, `1М` | ohm | `'1000000'` |
| `1m`, `1м` | ohm | `'0.001'` |
| `100мк`, `100u`, `100µ`, `100μ` | farad | `'0.0001'` |
| `2u2` | farad | `'0.0000022'` |
| `-40`, `-0`, `0.50`, `007` | count | `'-40'`, `'0'`, `'0.5'`, `'7'` |
| `4700 Ω`, `4700` | plainOhm | `'4700'` |
| `4k7` | plainOhm | `null` |
| `4.7 Ohm` | ohm | `null` |
| `''`, `abc`, `4k7k`, `k47`, `1.2.3`, `1da` | ohm | `null` |
| `1234567890123456` (16 значащих цифр) | count | `null` |

`formatNumberValue`:

| value | rules | expected |
|---|---|---|
| `4700` | ohm | `4.7 kΩ` |
| `0.0000001` | farad | `100 nF` |
| `0` | ohm | `0 Ω` |
| `0.0000000000000000000000001` | farad | `0.1 yF` |
| `1000000000000000000000000000` | ohm | `1000 YΩ` |
| `4700` | plainOhm | `4700 Ω` |
| `4700` | bare | `4.7k` |
| `14` | count | `14` |
| `-40` | `{ unit: 'V', siPrefixes: true }` | `-40 V` |
| `999.5` | ohm | `999.5 Ω` |
| `1000` | bare | `1k` |

`isCanonicalNumber`:
- `true` для `4700`, `0`, `-40`, `0.0000000001`;
- `false` для `04700`, `4700.0`, `-0`, `1e3`, `''`, `1234567890123456` (16 значащих цифр), `1` с тридцатью нулями (≥ 10³⁰), `0.` и тридцать нулей и `1` (< 10⁻³⁰).

`compareNumberValues`:
- `('4700', '10000')` → `-1`;
- `('-1', '0.5')` → `-1`;
- `('0.0000000001', '0.00000000001')` → `1`;
- `('4700', '4700')` → `0`.

- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/numbers.test.ts`. Expected: FAIL (модуля нет).

- [ ] **Step 3: Implement `numbers.ts`** по спеке §4.1–4.3.
  - Вся арифметика — сдвигом десятичной точки в строке и BigInt (мантисса и порядок), без `Number`.
  - **Приставки:**
    - латиница — из `SI_PREFIXES`, плюс `u` и `μ` (U+03BC) для микро;
    - кириллица — `п н мк м с к М Г Т`;
    - `da` не поддерживается.
  - **Порядок разбора суффикса:**
    1. весь суффикс равен единице — это единица без приставки;
    2. приставка плюс единица;
    3. одна приставка.
  - **Формы `4k7` и `e`/`E`:**
    - форма `4k7` разрешена только при `siPrefixes`;
    - `e` или `E`, за которыми идут знак и/или цифры, — это экспонента;
    - одиночная `E` в конце — приставка экса.
  - **Показ:** приставка с кратной трём степенью от −24 до 24 такая, что 1 ≤ |мантисса| < 1000. Если подходящей нет, берётся крайняя (y или Y). Все значащие цифры, разделитель — точка, между числом и единицей пробел, без единицы пробела нет.

- [ ] **Step 4: Run** `pnpm vitest run packages/core/test/numbers.test.ts`. Expected: PASS. Затем `pnpm --filter @graymatter/core typecheck`.

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/numbers.ts packages/core/src/index.ts packages/core/test/numbers.test.ts
git commit -m "feat(core): number attribute values — parse, canonical form, format, compare"
```

---

### Task 2: Схема с нуля, версия 3, кэш устройства, демо-хранилище

**Files:**
- Modify: `packages/storage-postgres/src/schema.ts` (новые колонки; `variants.name` пока остаётся — его убирает задача 4)
- Replace: `packages/storage-postgres/migrations/0000_init.sql`, `0001_rev.sql`, `migrations/meta/*` — одна начальная миграция, пересобранная drizzle-kit (найдите конфигурацию и скрипт в пакете) и дополненная строкой ревизии из бывшей `0001_rev.sql`
- Modify: `packages/storage-postgres/src/migrator.ts`
- Modify: `packages/core/src/storage.ts` (`STORAGE_ERROR_CODES` + `'outdated'`)
- Modify: `packages/app/app/lib/sources.ts` (`FailureReason` + `'outdated'`)
- Modify: `packages/app/app/lib/workspace.ts` (`SNAPSHOT_FORMAT`, показ кэша)
- Modify: `packages/app/app/lib/dev/demo-source.ts` (только имя хранилища)
- Modify: `packages/app/i18n/locales/en.json` (только сообщения `outdated` рядом с существующими `incompatible`)
- Test: `packages/storage-postgres/test/migrator.test.ts`, `packages/app/test/workspace.test.ts`, `packages/app/test/sources.test.ts`, `packages/app/test/demo-source.test.ts`

**Interfaces:**
- Produces:
  - Колонки в `schema.ts`:
    - `attributes.unit text not null default ''`;
    - `attributes.si_prefixes boolean not null default false`;
    - `item_attributes.axis_position integer` (может быть null), с частичным уникальным индексом `(item_id, axis_position) where axis_position is not null`.
  - `migrator.ts`:
    - `export const SCHEMA_BASE = 2`;
    - `APP_SCHEMA_VERSION = SCHEMA_BASE + migrations.length`, сейчас `3`;
    - пустая база (версия 0) получает начальную миграцию и сразу версию 3;
    - база с версией от 1 до `SCHEMA_BASE` отклоняется: `StorageError('outdated', 'the database was created by a pre-release GrayMatter; reset it')`.
  - `workspace.ts`: `SNAPSHOT_FORMAT = 2`.
  - Демо-хранилище: `idb://graymatter-dev-s${APP_SCHEMA_VERSION}-${config.id}`.

- [ ] **Step 1: Write failing tests.**
  - `migrator.test.ts` (PGlite):
    - пустая база → `ensureSchema` возвращает `{ state: 'ready', dbVersion: 3, appVersion: 3 }`, строка `rev` в `gm_meta` есть;
    - база с `schema_version = '2'` → `ensureSchema` отклоняется с `StorageError` кода `'outdated'`, схема не меняется;
    - база с `schema_version = '4'` → `{ state: 'newer' }`;
    - два параллельных `ensureSchema` на пустой базе оба заканчиваются `ready`.
  - `sources.test.ts`: отказ `outdated` даёт `FailureReason` `'outdated'`.
  - `workspace.test.ts`:
    - кэш, сохранённый с другим префиксом формата (старый `SNAPSHOT_FORMAT` или другая версия схемы), не показывается при старте (`state.snapshot === null`), даже без сети;
    - кэш с правильным префиксом показывается, как раньше.
  - `demo-source.test.ts`: имя хранилища содержит `-s3-`.
- [ ] **Step 2: Run** эти четыре файла. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Кэш.** Нужно уметь отличить «чужой формат» от «ревизия неизвестна». Сейчас `cacheRev(null)` даёт `null`, и `uncacheRev` эти случаи не различает. Храните отдельную метку формата в записи кэша (`device-db.ts`, поле на усмотрение) или иным способом. Снимок показывается только при совпадении метки.
  - **Тексты** `outdated` в `en.json`: `"This database was made by a pre-release version of GrayMatter. Reset it to use it here."` — в обоих блоках, где есть `incompatible`.
- [ ] **Step 4: Run** эти файлы, затем `pnpm test` и `pnpm typecheck`: всё зелёное. Затем — один раз — набор соответствия на Neon (`packages/storage-postgres/test/neon.conformance.test.ts` с `GM_NEON_TEST_URL`).
- [ ] **Step 5: Commit** (явными путями, включая удалённые файлы миграций): `feat: schema from scratch at version 3; pre-release databases need a reset; foreign cached snapshots are not shown`.

---

### Task 3: Модель, команды и правила ядра

**Files:**
- Modify: `packages/core/src/model.ts`, `commands.ts`, `validate.ts`, `search.ts` (только `v.name` → `variantLabel`), `index.ts`
- Create: `packages/core/src/variants.ts`
- Test: `packages/core/test/variants.test.ts` (новый), `validate.test.ts`, `fixtures.ts`, `search.test.ts` (ожидаемые подписи), `patch.test.ts`

**Interfaces:**
- Consumes (задача 1): `isCanonicalNumber`, `compareNumberValues`, `formatNumberValue`.
- Produces:

```ts
// model.ts
export type AttributeKind = 'text' | 'enum' | 'number'
export interface Attribute extends Audited { id: Id; inventoryId: Id; name: string; kind: AttributeKind; options: string[]; unit: string; siPrefixes: boolean }
export interface ItemAttribute { itemId: Id; attributeId: Id; value: string | null; axisPosition: number | null }
export interface Variant extends Audited, Archivable { id: Id; itemId: Id; description: string | null; position: number } // name удалено

// commands.ts — изменённые и новые
| { type: 'attribute.create'; id: Id; inventoryId: Id; name: string; kind: AttributeKind; options: string[]; unit: string; siPrefixes: boolean }
| { type: 'attribute.update'; id: Id; name?: string; options?: string[]; unit?: string; siPrefixes?: boolean }
| { type: 'item.setAttribute'; itemId: Id; attributeId: Id; value: string | null }   // только общий
| { type: 'item.removeAttribute'; itemId: Id; attributeId: Id }                       // общий или ось
| { type: 'item.addAxis'; itemId: Id; attributeId: Id; firstVariantId: Id }
| { type: 'item.removeAxis'; itemId: Id; attributeId: Id }                            // ось → общий
| { type: 'item.reorderAxes'; itemId: Id; attributeIds: Id[] }
| { type: 'variant.createMany'; itemId: Id; variants: { id: Id; values: { attributeId: Id; value: string }[] }[] }
| { type: 'variant.update'; id: Id; description?: string | null }
| { type: 'variant.setAttribute'; variantId: Id; attributeId: Id; value: string | null }

// validate.ts — новые коды ошибок в DOMAIN_ERROR_CODES
'duplicate_variant' | 'axis_required' | 'axis_value_required' | 'attribute_is_axis' | 'not_an_axis' | 'option_in_use' | 'invalid_number'

// variants.ts
export function itemAxes(s: InventorySnapshot, itemId: Id): Attribute[]            // по axisPosition
export function formatAttributeValue(a: Attribute, value: string): string           // число — formatNumberValue, иначе как есть
export function variantLabel(s: InventorySnapshot, v: Variant): string              // части через ' · ', пусто — '—'
export function compareVariants(s: InventorySnapshot, a: Variant, b: Variant): number // спека §4.8
export function sameAxisValue(a: Attribute, x: string | null, y: string | null): boolean // спека §4.7
export function duplicateOf(s: InventorySnapshot, itemId: Id, values: ReadonlyMap<Id, string | null>, exceptVariantId?: Id): Variant | null // включая архивные
export interface AxisRemoval { blocked: 'axis_required' | 'duplicate_variant' | null; collisions: Variant[][]; sharedValue: string | null; removedValues: { variantId: Id; value: string }[] }
export function axisRemovalPreview(s: InventorySnapshot, itemId: Id, attributeId: Id): AxisRemoval
```

**Правила `validate.ts`** (спека §4.5–4.7):

- **`item.setAttribute`.**
  - Атрибут уже ось у этого предмета → `attribute_is_axis`.
  - Значение проверяется по типу:
    - список — из `options`, иначе `invalid_option`;
    - число — `isCanonicalNumber`, иначе `invalid_number`;
    - текст — после обрезки пробелов; пустой текст нормализуется в `null`.
- **`item.addAxis`.** Если атрибут уже ось, команда ничего не делает и ошибкой не считается.
- **`item.removeAxis` и `item.removeAttribute` для оси.** Используют `axisRemovalPreview`: `blocked` ≠ null → ошибка с этим кодом.
- **`item.reorderAxes`.** Список должен совпадать с набором осей предмета, иначе `invalid_option`.
- **`variant.createMany`.**
  - У предмета нет осей → `axis_required`.
  - Нет значения по какой-то оси → `axis_value_required`.
  - Значение по атрибуту, который не ось → `not_an_axis`.
  - Дубль среди существующих (включая архивные) или внутри самой пачки → `duplicate_variant`.
- **`variant.setAttribute`.**
  - Атрибут — не ось → `not_an_axis`.
  - Пустое значение разрешено.
  - Дубль после изменения → `duplicate_variant`.
- **`attribute.delete`.** Атрибут — ось у предмета, где есть варианты (включая архивные) → `attribute_is_axis`.
- **`attribute.update`.** Из `options` убрано значение, которое используется у предмета или варианта → `option_in_use`. `unit` длиннее 16 символов → `name_too_long`.
- **`splitVariantNames`** и `checkVariantNames` удаляются.

- [ ] **Step 1: Write failing tests** в `variants.test.ts` и `validate.test.ts`. Фикстура — резистор с осью `Resistance` (`Ω`, приставки) и конденсатор с осями `Capacitance` (`F`) и `Voltage` (`V`).
  - **Подписи:**
    - `variantLabel` → `'4.7 kΩ'`, `'100 nF · 50 V'`;
    - пустое значение второй оси → `'100 nF · —'`.
  - **Сортировка `compareVariants`:**
    - `1k < 4k7 < 10k` по числу, а не по тексту;
    - список — по порядку `options`;
    - пустые значения последними;
    - равные наборы — по id (Review Focus 2).
  - **Создание вариантов:**
    - `createMany` с `'4700'` при существующем архивном `'4700'` → `duplicate_variant`;
    - пачка `['4700', '4700']` → `duplicate_variant`;
    - пачка без значения `Voltage` → `axis_value_required`;
    - у предмета без осей → `axis_required`.
  - **Совпадение значений `sameAxisValue`:**
    - текст: `' Red '` = `'red'`;
    - список — только точное совпадение;
    - пустое = пустому.
  - **`axisRemovalPreview`:**
    - `(100n, 16V)` и `(100n, 50V)` → `blocked: 'duplicate_variant'`, в `collisions` эта пара;
    - `(100n, 50V)` и `(10u, 50V)` при удалении `Voltage` → `sharedValue: '50'`, `removedValues` — две строки;
    - последняя ось у предмета с архивным вариантом → `blocked: 'axis_required'`.
  - **Справочник атрибутов:**
    - `attribute.update`, который убирает используемое значение списка → `option_in_use`;
    - добавление значения и смена порядка проходят.
  - **Проверка значений:**
    - `item.setAttribute` с `'4.7k'` для числового атрибута → `invalid_number`;
    - с `'4700'` проходит.
  - **Прочее:**
    - `variant.setAttribute`, который делает два варианта одинаковыми → `duplicate_variant`;
    - `attribute.delete` оси предмета с вариантами → `attribute_is_axis`.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/test`. Expected: FAIL.
- [ ] **Step 3: Implement** `variants.ts`, модель, команды и правила. В `normalizeCommand` текстовые значения обрезаются по краям, пустая строка общего значения становится `null`.
- [ ] **Step 4: Run** `pnpm vitest run packages/core/test` и `pnpm --filter @graymatter/core typecheck`: зелёное. Адаптер и приложение могут не собираться (Global Constraints).
- [ ] **Step 5: Commit**: `feat(core): variants are defined by axis attributes; number kind; role-change and uniqueness rules`.

---

### Task 4: Адаптер Postgres — команды, срезы, набор соответствия

**Files:**
- Modify: `packages/storage-postgres/src/schema.ts` (удалить `variants.name`; `attributes.kind` допускает `'number'`); пересобрать `migrations/0000_init.sql` и `meta` так же, как в задаче 2; версия по-прежнему 3
- Modify: `src/rows.ts`, `src/commands/dictionaries.ts`, `items.ts`, `variants.ts`, `index.ts`, `reads.ts`, `queries.ts`
- Test: `packages/storage-postgres/test/variants.test.ts`, `items.test.ts`, `dictionaries.test.ts`, `snapshot.test.ts`, `apply-result.test.ts`, `patch.property.test.ts`, `helpers.ts`

**Interfaces:**
- Consumes (задача 3): команды и модель выше. Проверку правил делает `core` до SQL, а SQL выполняет последствия по состоянию базы на момент записи.
- Produces — поведение команд:
  - **`item.addAxis`:**
    - не подключён → подключить осью в конец;
    - общий, у предмета есть варианты → непустое общее значение копируется всем вариантам, включая архивные; значение предмета становится `null`;
    - общий, вариантов нет, значение непустое → создаётся вариант `firstVariantId` с этим значением по оси; позиция — как у первого варианта;
    - общий, вариантов нет, значение пустое → только смена роли.
  - **`item.removeAxis`:**
    - роль меняется на общую, позиции оставшихся осей сжимаются до 0..n−1;
    - если у всех вариантов (включая архивные) одно и то же непустое значение, оно становится значением предмета, иначе `null`;
    - значения вариантов по этому атрибуту удаляются.
  - **`item.removeAttribute` для оси** — то же, что `removeAxis`, после чего строка связи удаляется.
  - **`item.reorderAxes`** записывает позиции в порядке списка. Учитывайте частичный уникальный индекс: например, сначала сдвиг на отрицательные позиции в той же транзакции.
  - **Изменённые строки (План 6)** — все команды предмета и вариантов возвращают срез одного предмета:
    - `item.*`;
    - `variant.createMany`;
    - `variant.update`;
    - `variant.setAttribute`.

    `attribute.create` и `attribute.update` возвращают малую таблицу `attributes`. `attribute.delete` по-прежнему широкая команда (`null`).

- [ ] **Step 1: Write failing tests** (PGlite и общий набор соответствия):
  - каждое поведение `addAxis` и `removeAxis` выше — по тесту;
  - `createMany` с двумя осями записывает значения; снимок после перезагрузки равен снимку с применёнными изменёнными строками;
  - `attribute.update` меняет `unit` и `siPrefixes`, но хранимые значения остаются теми же (Review Focus 3);
  - `reorderAxes` на трёх осях без ошибки уникальности;
  - генераторы в `patch.property.test.ts` получают новые команды (`addAxis`, `removeAxis`, `reorderAxes`, `createMany` со значениями, `setAttribute` со стиранием). Свойство то же, что сейчас: применение изменённых строк равно перезагрузке.
- [ ] **Step 2: Run** `pnpm vitest run packages/storage-postgres/test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Каждая команда — один пакет запросов внутри существующего порядка записи (блокировка ревизии → пред-разрешение → команда → смена ревизии → чтение среза).
- [ ] **Step 4: Run** `pnpm vitest run packages/storage-postgres/test`, `pnpm --filter @graymatter/storage-postgres typecheck`, затем набор соответствия на Neon один раз. Всё зелёное.
- [ ] **Step 5: Commit**: `feat(storage): axis and variant commands, number attributes, schema without variant names`.

---

### Task 5: Поиск по числу

**Files:**
- Modify: `packages/core/src/search.ts`
- Test: `packages/core/test/search.test.ts`

**Interfaces:**
- Consumes: `parseNumberValue` (задача 1), `itemAxes`, `variantLabel`, `formatAttributeValue` (задача 3).
- Produces: прежний API поиска. В индекс варианта попадают отформатированные значения осей, а не имя.

- [ ] **Step 1: Write failing tests:**
  - запросы `4k7`, `4.7k`, `4700` находят вариант `4.7 kΩ`;
  - у атрибута `{ unit: 'm', siPrefixes: true }` со значением `5` запрос `5m` находит предмет, а в «Resistance» он не находит `5 mΩ`, если такого значения нет;
  - у атрибута без приставок запрос `4k7` ничего не находит;
  - текстовое совпадение работает как раньше.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/search.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** по спеке §4.11. Каждое слово запроса разбирается по правилам каждого числового атрибута инвентаря. Совпадение — по `compareNumberValues === 0` со значениями этого атрибута (общими и по осям). Совпадение по числу объединяется с текстовым.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit**: `feat(core): search finds number values in any notation`.

---

### Task 6: Данные приложения, подписи, общее поле значения

**Files:**
- Modify: `packages/app/app/lib/item-view.ts`, `views.ts`, `palette.ts`, `archive.ts`, `stock-forms.ts`, `lists.ts`, `errors.ts`
- Create: `packages/app/app/lib/attribute-values.ts`
- Modify: `packages/app/app/components/AttributeValueField.vue`
- Modify (минимально, чтобы собиралось): места с `v.name` / `variant.name` в `LooseTransferSheet.vue`, `ItemScreen.vue`, `JournalList.vue`, `SearchPalette.vue`, `ArchiveList.vue`, `PhotoPicker.vue`
- Modify: `packages/app/i18n/locales/en.json` (блок `errors.domain` и ключи поля значения)
- Test: `packages/app/test/item-view.test.ts`, `views.test.ts`, `palette.test.ts`, `archive.test.ts`, `lists.test.ts`, `errors.test.ts`, новый `attribute-values.test.ts`

**Interfaces:**
- Consumes (задачи 1 и 3): `variantLabel`, `compareVariants`, `itemAxes`, `formatAttributeValue`, `parseNumberValue`.
- Produces:

```ts
// item-view.ts
export interface AxisRow { attributeId: Id; name: string; kind: AttributeKind; options: string[]; unit: string; siPrefixes: boolean }
export interface AttributeRow { attributeId: Id; name: string; kind: AttributeKind; options: string[]; unit: string; siPrefixes: boolean; value: string | null; display: string | null } // только общие; perVariant удалено
// ItemView: + axes: AxisRow[]; attributes: AttributeRow[] (только общие)
// BucketRow: name — подпись варианта (variantLabel) или null для «без варианта»; values: { attributeId: Id; name: string; value: string | null; display: string }[] по осям; + incomplete: boolean (есть пустая ось)
// варианты в buckets — в порядке compareVariants
// attributeWrites удаляется

// attribute-values.ts
export type ParsedInput = { value: string } | { error: 'invalid_number' | 'invalid_option' | 'name_required' }
export function parseAttributeInput(a: Pick<Attribute, 'kind' | 'options' | 'unit' | 'siPrefixes'>, text: string): ParsedInput
// число — parseNumberValue; список — совпадение без учёта регистра даёт значение из options; текст — обрезка пробелов, непустое

// lists.ts
export function splitValueList(input: string, kind: AttributeKind): string[]   // \n, \r\n, ';' и ',' — разделители; для 'number' запятая между двумя цифрами десятичная; пустые отбрасываются; повторы НЕ убираются
export function splitVariantLines(input: string): string[][]                    // строка → значения через ';' по порядку осей; пустые строки и хвостовые пустые части отбрасываются

// AttributeValueField.vue
// props: { attribute: Pick<Attribute,'kind'|'options'|'unit'|'siPrefixes'>; modelValue: string | null; id?: string; disabled?: boolean }
// emits: update:modelValue(value: string | null)  — каноническое значение или null, если пусто
//        update:error(key: string | null)          — ключ i18n, если ввод не разобрался
// число: поле текста с подсказкой разбора («= 4.7 kΩ»), autocapitalize="off", autocorrect="off", spellcheck=false
```

**Тексты ошибок** (`errors.domain.*`):

| Код | Текст |
|---|---|
| `duplicate_variant` | `A variant with these values already exists.` |
| `axis_required` | `Variants need at least one attribute they differ by.` |
| `axis_value_required` | `Every variant needs a value for each attribute it differs by.` |
| `attribute_is_axis` | `Variants differ by this attribute. Change that on the item first.` |
| `not_an_axis` | `Variants don't differ by this attribute.` |
| `option_in_use` | `This value is still in use. Change it where it's used first.` |
| `invalid_number` | `Not a number this attribute understands.` |

- [ ] **Step 1: Write failing tests:**
  - `itemView`: оси в порядке `axisPosition`; общие атрибуты отдельно; варианты отсортированы `1k, 4.7k, 10k`; подписи в `BucketRow.name`; `incomplete` у варианта с пустой осью;
  - подписи в журнале, палитре и архиве из `variantLabel`;
  - `lists.test.ts`:
    - `splitValueList('1k, 4,7k;10k\r\n', 'number')` → `['1k', '4,7k', '10k']`;
    - `splitValueList('a,b', 'text')` → `['a', 'b']`;
    - `splitVariantLines('100n; 50V;\r\n\r\n10u;16V')` → `[['100n', '50V'], ['10u', '16V']]` (Review Focus 5);
  - `attribute-values.test.ts`: число, список без учёта регистра, пустой текст → `name_required`;
  - `errors.test.ts`: у каждого нового кода есть ключ.
- [ ] **Step 2: Run** эти файлы. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Минимальные правки компонентов.** Только то, без чего приложение не соберётся: `v.name` → подпись из представления. Переделку `AttributeValueSheet.vue`, `ItemAttributes.vue`, `VariantsForm.vue`, `VariantForm.vue` и `VariantValuesSheet.vue` делают задачи 7 и 8. Ошибки типов в этих пяти файлах здесь ожидаемы.
  - **Тесты с PGlite.** Тесты, которым нужен настоящий адаптер, могут падать до слияния задачи 4. Перечислите их в отчёте.
- [ ] **Step 4: Run** изменённые тесты: PASS.
- [ ] **Step 5: Commit**: `feat(app): variant labels from axis values, typed attribute input, value lists`.

---

### Task 7: Интерфейс — оси и общие атрибуты

**Files:**
- Create: `packages/app/app/components/ItemAxes.vue`
- Modify: `ItemScreen.vue`, `ItemDialogs.vue`, `ItemAttributes.vue`, `AttributeValueSheet.vue`, `AttributeForm.vue`, `AttributesSection.vue`, `BucketList.vue`
- Modify: `packages/app/i18n/locales/en.json` — только ключи под `axes.*`, `attributeForm.*`, `attributeSheet.*` и `item.*`
- Test: `packages/app/test/dictionaries.test.ts` (форма атрибута), при необходимости новый `axes.test.ts` для логики, вынесенной из компонента

**Interfaces:**
- Consumes:
  - задача 6: `ItemView.axes`, `AttributeRow`, `AttributeValueField`;
  - задача 3: команды `item.addAxis`, `item.removeAxis`, `item.reorderAxes`, `item.removeAttribute`, `item.setAttribute`, `attribute.create` (`unit`, `siPrefixes`), `axisRemovalPreview`.
- Produces: экран предмета по спеке §4.9. Компоненты задачи 8 подключаются через уже существующие точки (`VariantsForm` с `itemId` и `done`, `VariantForm`), их пропсы не меняются.

**Поведение:**

- **Секция вариантов.**
  - Заголовок показывает оси: `by Resistance · Voltage`.
  - Меню осей:
    - `Add attribute variants differ by` — выбрать из справочника или создать;
    - `Reorder` — вверх и вниз;
    - `Make shared` и `Remove` — для каждой оси.
  - Перед `Make shared` и `Remove` показывается предпросмотр `axisRemovalPreview`:
    - если `blocked`, кнопка недоступна и показан текст ошибки, а для `duplicate_variant` — перечень совпадающих подписей;
    - иначе, если `removedValues` не пусто, нужно подтверждение с перечнем.
- **Секция `Attributes`** показывает только общие атрибуты. Меню строки: `Edit value`, `Make it a variant axis`, `Remove`.
- **`Make it a variant axis`** отправляет `item.addAxis` с новым `firstVariantId`. Если появился первый вариант, а у предмета был остаток «без варианта», показывается существующее предложение переноса (`LooseTransferSheet`).
- **`AttributeValueSheet`.** Переключатель `Differs by variant` удаляется, лист правит только общее значение через `AttributeValueField`.
- **`AttributeForm`.** Тип `Text` / `List` / `Number`. Для `Number` есть поле `Unit` (необязательное, до 16 символов) и переключатель `SI prefixes` с примером: при `Ω` и включённых приставках — `4k7 → 4.7 kΩ`.

- [ ] **Step 1: Write failing tests** для вынесенной логики: построение команды для формы атрибута с `kind: 'number'`, `unit` и `siPrefixes`; выбор текста предпросмотра удаления оси по `AxisRemoval`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** тесты приложения и `pnpm --filter @graymatter/app typecheck` — без ошибок в файлах задачи. Затем снимки экрана предмета на 1280 px и 360 px (dev-сервер из своего worktree на 3001, демо-источник).
- [ ] **Step 5: Commit**: `feat(app): variant axes and shared attributes on the item screen; number attributes in the dictionary`.

---

### Task 8: Интерфейс — добавление и правка вариантов

**Files:**
- Modify: `packages/app/app/components/VariantsForm.vue`, `VariantForm.vue`, `VariantValuesSheet.vue`
- Create (при необходимости): `packages/app/app/lib/variant-batch.ts`
- Modify: `packages/app/i18n/locales/en.json` — только ключи под `variantsForm.*`, `variantForm.*` и `variantValues.*`
- Test: `packages/app/test/variant-batch.test.ts`

**Interfaces:**
- Consumes:
  - задача 6: `splitValueList`, `splitVariantLines`, `parseAttributeInput`, `AttributeValueField`, `ItemView.axes`;
  - задача 3: `duplicateOf`, `variantLabel`, команды `variant.createMany`, `variant.setAttribute`, `variant.update`, `item.addAxis`, `attribute.create`, `restore`.
- Produces:

```ts
// variant-batch.ts
export interface BatchLine { raw: string; values: { attributeId: Id; value: string }[] | null; label: string | null; error: string | null /* i18n key */; duplicate: { variantId: Id; archived: boolean; archiveId: Id | null } | null; repeat: boolean }
export function planVariantBatch(s: InventorySnapshot, itemId: Id, input: string): BatchLine[]
// одна ось — splitValueList; две и больше — splitVariantLines с проверкой числа значений; repeat — повтор внутри списка
```

Пропсы и события `VariantsForm` (`itemId`, `done`) и `VariantForm` сохраняются. Тип `VariantsAdded.created` становится `{ id: Id; label: string }[]`.

**Поведение:**

- **Предмет без осей.** `VariantsForm` сначала показывает шаг выбора или создания атрибута с подсказкой правила §3.4: `Variants differ only by values like resistance. If they look different, make separate items.` Затем отправляется `item.addAxis`, и форма переходит ко вводу значений.
- **Ввод значений.**
  - Под полем — живой предпросмотр строк `planVariantBatch`: подпись, ошибка, «already exists» или «in the archive».
  - Кнопка недоступна, пока есть строки с ошибкой.
  - Строки-дубли и повторы пропускаются.
  - Если совпал архивный вариант, рядом есть действие `Restore` (команда `restore` с его `archiveId`).
- **Правка варианта.** `VariantForm` содержит поле `AttributeValueField` на каждую ось и описание. Изменённые значения отправляются как `variant.setAttribute`, описание — как `variant.update`.
- **Таблица значений.** `VariantValuesSheet` показывает варианты × оси, пустые значения заметны (`—`).

- [ ] **Step 1: Write failing tests** `variant-batch.test.ts`:
  - ось `Resistance`, ввод `1k, 4k7, 4,7k` → подписи `1 kΩ`, `4.7 kΩ`, `4.7 kΩ` (третья с `repeat: true`) — приёмка 1;
  - две оси, ввод `100n; 50V\n100n; 16V` → две строки без ошибок;
  - `100n` при двух осях → ошибка `axis_value_required`;
  - значение архивного варианта → `duplicate.archived: true` с `archiveId` — приёмка 12;
  - `abc` в числовой оси → ошибка `invalid_number`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** тесты и проверку типов приложения — без ошибок в файлах задачи. Снимки листа «Add variants» на 1280 px и 360 px.
- [ ] **Step 5: Commit**: `feat(app): add variants by axis values with a live parse preview; edit variant values`.

---

### Task 9: Демо-данные и полная проверка

**Files:**
- Modify: `packages/app/app/lib/dev/demo-source.ts`
- Test: `packages/app/test/demo-source.test.ts`

**Interfaces:**
- Consumes: всё выше.

- [ ] **Step 1: Write failing test.** После заполнения демо-данных:
  - у резистора одна ось `Resistance` (`Ω`, приставки) и варианты `1 kΩ`, `10 kΩ`, `100 kΩ` (последний в архиве, как сейчас);
  - у конденсатора оси `Capacitance` (`F`, приставки) и `Voltage` (`V`, приставки), не меньше двух вариантов;
  - у TL072 общий списочный атрибут `Package = DIP-8`;
  - ни у одного варианта нет текстового дубля номинала.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** новое заполнение. Движения, архив и теги остаются, как сейчас.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck` и `pnpm lint` — всё зелёное. Набор соответствия на Neon — один раз.
- [ ] **Step 5: Commit**: `feat(app): demo data with axis variants and number attributes`.

---

## Итоги выполнения

**Как шло.**
- Исполнение без ultracode, максимально параллельно: каждая задача в своём worktree, контроллер вливал их в `plan7-variants`.
- Волны:
  - 1 и 2 — параллельно;
  - затем 3;
  - затем 4, 5 и 6 — параллельно;
  - 7 и 8 стартовали сразу после 6, не дожидаясь 4.
- Ревью по ходу было только у задачи 3. Ревью задачи 4 вошло в итоговое ревью ветки. Отдельные снимки по задачам заменены двумя общими в задаче 9.

**Что сделано.**
- Ядро:
  - `numbers.ts` — разбор, каноническая форма, показ, сравнение; без float;
  - `variants.ts` — подпись, сортировка, уникальность, `axisRemovalPreview`, `addAxisPreview`;
  - новая модель и команды, семь новых кодов ошибок.
- Схема с нуля, версия 3 (`SCHEMA_BASE = 2`). База версии 1 или 2 даёт `outdated` и при проверке источника, и при открытии.
- Адаптер: команды осей и вариантов, изменённые строки по правилам Плана 6, генераторы property-теста для новых команд.
- Поиск по числу в любой записи.
- Интерфейс: блок осей на экране предмета, добавление вариантов с живым предпросмотром, правка вариантов по осям, тип Number в справочнике.
- Кэш устройства с меткой формата. Демо-данные: резистор с одной осью, конденсатор с двумя, TL072 с общим списочным атрибутом.
- Итог прогона: `pnpm test` — 878 пройдено, 16 пропущено (Neon без переменной окружения). `typecheck` и `lint` — 0. Набор соответствия на Neon — зелёный (в последнем исправлении 18 пройдено, 1 пропущен).

**Что поймали ревью.**
- **Ревью задачи 3:**
  - падение на `null` в значении оси;
  - единица у нечисловых атрибутов;
  - id в пачке вариантов не проверялись;
  - тест не доходил до нужной ветки.
- **Автоматическая проверка безопасности:** число, сохранённое не в канонической форме, роняло поиск. Теперь подпись показывает его как есть, а поиск пропускает.
- **Итоговое ревью:**
  - устаревшая копия могла снять последнюю ось у предмета с вариантами и стереть значения. Теперь SQL опирается на состояние базы, а property-тест проверяет запись с другого устройства;
  - «сделать осью» молча теряло общее значение — добавлены предпросмотр и подтверждение;
  - база версий 1–2 обещала «обновить»;
  - при правке не предлагалось восстановить совпавший архивный вариант;
  - на первом шаге «Add variants» нельзя было выбрать уже подключённый атрибут;
  - пример в форме атрибута не учитывал настройки;
  - в поле пачки работало автоисправление;
  - в листе значения оставался текст от прошлого атрибута;
  - кэш разбора чисел в поиске.

**Решения контроллера.**
- Общее значение при снятии оси переходит предмету только при точном совпадении строк. Перед удалением интерфейс перечисляет, что удалится.
- `item.addAxis` создаёт первый вариант только при трёх условиях: вариантов нет, общее значение непустое, других осей нет. Иначе меняется только роль, а потеря значения подтверждается.
- `variant.createMany` отклоняет существующие id. Идемпотентность хранилища держится на SQL, формы создают новые id при каждой отправке.
- Запрещённое снятие оси при устаревшей копии пропускается без ошибки: приложение перезагружает данные по правилам ревизии.

**Перенос.**
- Правка варианта уходит несколькими записями `variant.setAttribute`. Промежуточное состояние может совпасть с другим вариантом, а при сбое правка применится частично. Нужна одна команда `variant.setValues` с проверкой конечного состояния.
- Пропущенное снятие оси не показывает сообщения.
- Устаревшие `createMany` и `setAttribute` могут создать одинаковые варианты: уникальности в базе нет.
- Сравнение текста без учёта регистра в SQL (`lower()`) зависит от локали базы.
- Старая сборка на базе версии 3 открывает её только для чтения, но загрузка падает на `variants.name`. Для предварительной версии это ожидаемо.
- Поиск при равном ранге упорядочивает варианты по `position` (косметика).
- Демо-конденсатор поменял счётчики в тестах — учитывать при правке демо-данных.
- Перенос из Плана 6 остаётся открытым: разбить `workspace.ts`, блокировка ревизии в `migrationPrologue` перед следующей миграцией, детерминированный тест параллельности на Neon.
