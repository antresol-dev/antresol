# Поступления создают всё, что нужно предмету; явных дублей нет нигде — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ядро запрещает явные дубли во всём приложении; черновик поступления несёт иконки и цвета, свои единицы, «Show in lists», новые значения списков (для строк любого предмета) и описания вариантов; атрибуты, теги и единицы объявляются только под предметом; MCP подсказывает похожие имена.

**Architecture:** Запрет дублей — в проверке команд ядра (`validate.ts`), без проверок в базе. Черновик и `intake.commit` расширяются, как в двух прошлых планах; «живут, пока используются» для атрибутов, тегов, единиц и добавленных значений — через обрезку в ядре (`pruneNewItems`-подобно). Общая логика (объявления под предметом, проверка имён, похожие имена) — в `kit`, ею пользуются приложение и MCP.

**Tech Stack:** TypeScript, Vitest, PGlite / Neon, Nuxt 4 / Vue 3, `@modelcontextprotocol/sdk`.

**Spec:** `docs/superpowers/specs/2026-11-17-antresol-intake-full-entities-design.md`. Действуют спеки `2026-11-16-…-intake-entities`, `2026-11-14-…-mcp`, `2026-11-13-…-intakes`.

## Global Constraints

- **Место:** worktree `/Users/as/dev/graymatter/.worktrees/mcp`, ветка `mcp`; параллельные задачи — в своих worktree от `mcp`. Не пушить, не вливать в `master`, без тегов. Сервер владельца на 3021 работает из этого worktree — не останавливать, второй `nuxt dev` здесь не запускать.
- **Git:** без строк атрибуции; без голых `git stash`; явные пути; не добавлять `packages/app/nuxt.config.ts`, `proposals.md`, `.claude/`, `.superpowers/`, `.env.local`, `Claude outputs/`, `dist/`, `*.mcpb`.
- **Явный дубль** = совпадение имени после trim, без учёта регистра (`sameName` из `core/intake-entities.ts`). Уникальность: предмет — среди **всех** предметов той же папки, **включая архивные**; папка — среди всех папок того же родителя, включая архивные; атрибут, тег — во всём инвентаре; своя единица — среди своих **и встроенных** (`BUILTIN_UNITS`) по имени (без регистра) и по символу (**с учётом регистра**).
- **Только ядро,** без проверок в SQL. Уже существующие дубли не трогаются — проверяется только изменяемое.
- **Коды ошибок:** `duplicate_name` — живой двойник; новый `duplicate_archived` — двойник в архиве (текст: «An archived item “X” is in this folder — restore it or choose another name», то же для папки).
- **Черновик:** новые поля необязательные, отсутствие = пусто; `rev` не меняется; всё настоящее — только в атомарном `intake.commit`, повтор ничего не создаёт дважды. Иконки и цвета — по правилам `item.create`/`folder.create`/`tag.create` (`isIconName`, `isColorHex`).
- **Добавленные значения списка** дописываются в конец, уже существующие не повторяются; ими может пользоваться строка **любого** предмета.
- **Предел «Show in lists»:** `MAX_PINNED_ATTRIBUTES` — проверяется при проведении.
- **Похожие имена (совет, не отказ):** равны после удаления пробелов, `-`, `.`, `_`; равны после свёртки единственного/множественного (конечные `s`/`es`); расстояние правки ≤ 2 при длине ≥ 6 (≤ 1 короче); одно входит в другое целым словом. Предметы — в той же папке и по всему инвентарю (другие папки помечены).
- **Интерфейс:** английские тексты в `en.json`; дизайн-система `docs/superpowers/plans/2026-11-13-antresol-12-design-system.md` обязательна; подписи по `--field-inset`; контраст ≥ 4.5:1.
- **Команды:** `pnpm vitest run <path>`, тяжёлые с `--maxWorkers=3`; `pnpm typecheck`; `pnpm lint`; Neon `_test` только в задаче 3 (`ANTRESOL_NEON_TEST_URL` из `/Users/as/dev/graymatter/.env.local`, не печатать).

## Review Focus

1. **Переименование и перенос:** переименовать предмет в имя архивного соседа, перенести папку туда, где есть одноимённая (в т. ч. архивная) — отказ с правильным кодом. Тест в задаче 1.
2. **Проведение против копии и внутри себя:** две новые папки с одним именем у одного родителя, новый предмет с именем архивного, новая единица с символом `m` или с символом `M` при существующей `m` (разрешено). Тест в задаче 2.
3. **Обрезка неиспользуемого:** удалили последнюю строку с добавленным значением / последний предмет с новым атрибутом — они исчезают из черновика и не создаются при проведении. Тест в задаче 2.
4. **Повтор проведения** с новыми единицами, добавленными значениями и описаниями вариантов ничего не задваивает (опции списка не дублируются). Тест в задаче 3.
5. **MCP:** объявление атрибута/единицы/значения внутри предмета и строки, отказ на явный дубль с id существующего, `similar` в ответе. Тест в задаче 5.

---

### Task 1: Ядро — запрет явных дублей во всём приложении

Ревью — сильная модель.

**Files:** Modify `packages/core/src/validate.ts` (и, если нужно, `limits.ts`/`intake-entities.ts` для общих функций); `packages/app/i18n/locales/en.json` (`errors.domain.duplicate_archived`); Test: `packages/core/test/validate*.test.ts` по месту.

**Interfaces — Produces:** код ошибки `duplicate_archived` в списке доменных ошибок; функции `itemNameTaken(s, folderId, name, exceptId?) : 'active' | 'archived' | null`, `folderNameTaken(s, parentId, name, exceptId?)`, `unitClash(s, { name, symbol }, exceptId?) : 'name' | 'symbol' | null` (учитывает встроенные), экспортируемые из core.

- [ ] **Step 1: Failing tests:** `item.create` с именем живого соседа → `duplicate_name`, архивного → `duplicate_archived`, в другой папке → ok; `item.update` (rename) и `item.move` в папку с двойником → отказ; `folder.create/update/move` аналогично; `attribute.create/update` с именем другого атрибута → `duplicate_name`; `unit.create` с именем «meters» → `duplicate_name`, с символом `m` → `duplicate_name`, с символом `M` → ok, с символом `ml` при своей `mL` → ok; `restore` предмета, чьё имя занято живым соседом → `duplicate_name`; регистр и пробелы: «  Resistor » = «resistor».
- [ ] **Step 2: Run** `pnpm vitest run packages/core` — FAIL.
- [ ] **Step 3: Implement.** Проверки в `check` для каждой команды; сам себе не двойник (`exceptId`); повтор команды (тот же id уже в копии) проходит, как сейчас у тегов.
- [ ] **Step 4: Run** `pnpm vitest run packages/core packages/app --maxWorkers=3`, `pnpm typecheck` — PASS (тесты приложения, которые создавали дубли в фикстурах, поправить).
- [ ] **Step 5: Commit** `feat(core): no hard duplicates anywhere: items per folder (archived included), folders per parent, attributes, units (built-in too)`.

---

### Task 2: Ядро — новые части черновика, обрезка, проведение

После задачи 1. Ревью — сильная модель.

**Files:** Modify `packages/core/src/intakes.ts`, `intake-entities.ts`, `commands.ts`, `validate.ts`, `index.ts`; Test: `packages/core/test/intakes.test.ts`.

**Interfaces — Produces:**
- `DraftNewItem` += `icon?: string | null`, `color?: string | null`; `DraftNewFolder` += `icon?: string | null`; `DraftNewTag` += `color?: string | null`; `DraftNewAttribute` += `pinned?: boolean`.
- `interface DraftNewUnit { id: Id; name: string; symbol: string; prefixPowers: number[] }`; `IntakeDraftContent` += `newUnits?: DraftNewUnit[]`; новый предмет может иметь `unitKey = customUnitKey(draftUnit.id)`.
- `IntakeDraftContent` += `addedOptions?: { attributeId: Id; values: string[] }[]` (только существующие атрибуты-списки).
- `DraftLine` += `variantDescription?: string | null` (у строки, создающей вариант).
- `pruneDraft(draft)` (заменяет/расширяет `pruneNewItems`): выкидывает новые теги, атрибуты, единицы, которыми не пользуется ни один новый предмет, и добавленные значения, которыми не пользуется ни одна строка и ни один новый предмет.
- `EntityProblem` += `{ code: 'duplicate_archived'; existingId }`, `{ code: 'pinned_limit' }`; `ResolvedIntake.entities` включает `unit`, `tag`, `option` (kind).
- `intake.commit` += `newUnits`, `newAttributes[].pinned`, `newTags[].color`, `newFolders[].icon`, `newItems[].icon/color`, `newVariants[].description`, `appendOptions: { attributeId; values }[]`; `IntakeCreated` += `units`, `appendedOptions`.

- [ ] **Step 1: Failing tests:** предмет с иконкой и цветом → в команде и в снимке после; папка с иконкой; тег с цветом; черновая единица как единица предмета → создаётся, количества в ней разбираются; черновой атрибут `pinned` → создан с pinned, третий pinned при пределе 2 → `pinned_limit`; добавленное значение «0805» к существующему `Package` используется строкой **существующего** предмета (новый вариант) → `appendOptions`, вариант создан; описание варианта у создающей строки → у варианта; **Review Focus 2** (дубли внутри команды и против копии, включая архивный предмет и регистр символа единицы); **Review Focus 3** (обрезка); старый черновик без новых полей проводится как раньше.
- [ ] **Step 2: Run** `pnpm vitest run packages/core` — FAIL.
- [ ] **Step 3: Implement** по Interfaces; `canonicalValue` для атрибута-списка принимает и добавленные значения черновика; валидация `intake.commit` — те же правила дублей, что в задаче 1 (общие функции), значения списка — без повторов.
- [ ] **Step 4: Run** `pnpm vitest run packages/core --maxWorkers=3`, `pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(core): drafts carry icons, colours, units, pinned attributes, added list values and variant descriptions; unused parts are pruned`.

---

### Task 3: Хранилище и резервные копии

После задачи 2. Ревью — сильная модель.

**Files:** Modify `packages/storage-postgres/src/commands/intakes.ts`, `restore.ts`, `rows.ts`; `packages/app/app/lib/backup.ts`; Test: `storage-postgres/test/intakes.test.ts`, `restore.test.ts`, `app/test/backup.test.ts`.

- [ ] **Step 1: Failing tests:** проведение со всеми новыми частями → в снимке единица, pinned, цвета и иконки, описание варианта, опции списка дописаны в конец; **Review Focus 4** (повтор после смены `rev` ничего не задваивает, опции без повторов); резервная копия со всеми частями проходит экспорт → разбор → восстановление `new-ids` (переименованы id единиц, `custom:` ключи, `addedOptions.attributeId`); старая копия без новых полей восстанавливается без изменений.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Порядок батча: папки → единицы → атрибуты → теги → дописанные опции (`options = options || новые, которых нет`, под `PENDING`) → предметы → варианты (с `description`) → фото → поступление → движения. Миграция не нужна, если все колонки уже есть (иконки, цвета, `pinned`, `variants.description`, `units`); если нет — аддитивная, `min_app_schema` не трогать.
- [ ] **Step 4: Run** тесты, `pnpm typecheck`, один прогон набора Neon — PASS.
- [ ] **Step 5: Commit** `feat(storage): intake.commit writes units, pinned attributes, colours, icons, appended list values and variant descriptions`.

---

### Task 4: `kit` — объявления под предметом, проверка имён, похожие имена

После задачи 2. Параллельно с задачей 3. Ревью — сильная модель.

**Files:** Modify `packages/kit/src/intake-draft.ts`, `intake-line.ts`; Create `packages/kit/src/similar-names.ts`; Test: `packages/kit/test/*.test.ts`.

**Interfaces — Produces:**
- `similarNames(candidates: { id: Id; name: string; where?: string }[], name: string): { id: Id; name: string; where?: string; why: 'spacing' | 'plural' | 'typo' | 'contains' }[]` — правила из Global Constraints.
- `nameClash` расширяется: `{ kind: 'item'; name; folderId }`, `{ kind: 'unit'; name; symbol }` (встроенные, регистр символа), архивные двойники → `{ id; draft; archived: true }`.
- `withItemAttribute(draft, s, itemId, def | existingId)`, `withItemTag(draft, s, itemId, name | id, color?)`, `withItemUnit(draft, s, itemId, unitDef | key)`, `withAddedOption(draft, s, attributeId, value)` — объявления «под предметом/строкой»; все возвращают черновик после `pruneDraft` или `{ errorKey; params? }`.
- `buildDraftLine` — принимает `variantDescription` для создающей строки; значение существующего списка из `addedOptions` проходит.

- [ ] **Step 1: Failing tests** на каждую функцию, включая `similarNames` («Resistors»→«Resistor» plural, «Res-istor» spacing, «Resitor» typo, «SMD Resistor» contains; короткие имена — только typo ≤ 1), `nameClash` для архивного предмета и символа единицы `M` vs `m`.
- [ ] **Step 2–4:** RED → implement → GREEN (`pnpm vitest run packages/kit packages/app/test/intake-line.test.ts`, `pnpm typecheck`).
- [ ] **Step 5: Commit** `feat(kit): declare attributes, tags, units and list values under an item; name clashes incl. archived and units; similar names`.

---

### Task 5: MCP

После задач 3 и 4. Ревью — средняя модель.

**Files:** Modify `packages/mcp/src/tools/drafts.ts`, `tools/read.ts`, `shape.ts`, `server.ts`, `prompts.ts`; Test: `packages/mcp/test/*.test.ts`.

- [ ] **Step 1: Failing tests:** `create_attribute`/`update_attribute`/`remove_attribute` больше нет в `listTools`; новый предмет в `add_intake_lines` объявляет атрибут (с `pinned`), тег с цветом, свою единицу, иконку и цвет; строка существующего предмета добавляет значение в список (`addValues: { attribute, value }`) и `description` нового варианта; `create_folder` с `icon`; **Review Focus 5** (явный дубль — ошибка с id/путём существующего, в т. ч. архивного; ответ содержит `similar` для каждого нового имени); `get_overview` содержит значения списков и приставки единиц; `get_intake` показывает новые части.
- [ ] **Step 2–4:** RED → implement → GREEN (`pnpm vitest run packages/mcp --maxWorkers=3`, `pnpm typecheck`, `pnpm --filter @antresol/mcp run pack:mcpb`). Промпт: перед созданием смотреть `similar` и обзор, предпочитать существующее, не полагаться на регистр и пробелы; атрибуты, теги, единицы — только под предметом.
- [ ] **Step 5: Commit** `feat(mcp): declare everything under the item; icons, colours, units, pinned, list values, variant descriptions; similar names in every answer`.

---

### Task 6: Приложение — поступления

После задачи 4. Параллельно с задачей 5. Без отдельного ревью (UI).

**Files:** Modify `IntakeWillCreate.vue`, `IntakeNewItemCard.vue`, `IntakeLineSheet.vue`, `IntakeNewItemAttributes.vue`, `IntakeFolderSheet.vue`, `IntakeRecord.vue`, `AttributeForm.vue` (draft: pinned), форма единицы (draft-режим), `en.json`.

- [ ] **Step 1: Implement** по спеке §6: блоки «Will be created» для единиц, атрибутов (с «Show in lists»), тегов (с цветом), добавленных значений («Package: + 0805») — правка и «Remove from all items», без создания; карточка предмета — `IconField` и `ColorSwatches`; шторка строки — «New unit…» (черновик), «Add “0805” to the list» (и для существующего предмета), описание создающей строки (свёрнуто); шторка папки — иконка; «Created» — единицы и значения; подсказка о похожих — в месте «Looks like you already have this».
- [ ] **Step 2: Run** `pnpm vitest run packages/app --maxWorkers=3`, `pnpm typecheck`, `pnpm lint` — PASS. Снимки: экран черновика со всеми блоками и шторка с «New unit…» (1280 и 360 px, Liquid glass) — с сервера 3021 только на демо-данных.
- [ ] **Step 3: Commit** `feat(app): intakes declare units, attributes, tags and list values under items; icons and colours; variant descriptions`.

---

### Task 7: Приложение — явные дубли в обычных формах

После задачи 1. Параллельно с задачами 2–6. Без отдельного ревью (UI).

**Files:** формы предмета (`ItemForm.vue`, быстрое добавление), папок (`FolderDialogs.vue`), атрибутов (`AttributesSection.vue`/`AttributeForm.vue`), единиц (`UnitsSection.vue`), тегов (`TagsSection.vue`), восстановление из архива (`ArchiveList.vue` и место вызова `restore`), `en.json`.

- [ ] **Step 1: Implement:** при вводе имени форма сразу говорит, что имя занято (живым или архивным двойником, с его названием), и не даёт сохранить; отказ ядра (`duplicate_name`/`duplicate_archived`) показывается понятным текстом; у восстановления — текст «“X” уже есть в этой папке — переименуйте его, чтобы вернуть этот».
- [ ] **Step 2: Run** `pnpm vitest run packages/app --maxWorkers=3`, `pnpm typecheck`, `pnpm lint` — PASS. Снимок формы предмета с занятым именем (360 px).
- [ ] **Step 3: Commit** `feat(app): forms refuse names that are already taken, archived twins included`.

---

## Порядок и параллельность

1. Задача 1, затем параллельно 2 и 7.
2. После 2 — параллельно 3 и 4.
3. После 3 и 4 — 5; после 4 — 6 (параллельно с 5).
4. Итоговое ревью двумя половинами: данные (1–5) и приложение (6–7).

## Перенос на потом (carry-over)

- Проверки дублей в базе (гонка двух устройств) — по решению владельца позже.
- Переименование при восстановлении из архива.
- Цвет у папок.
