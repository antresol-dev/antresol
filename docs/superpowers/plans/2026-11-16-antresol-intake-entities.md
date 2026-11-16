# Поступления, которые создают папки, предметы и атрибуты — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Черновик поступления создаёт вложенные папки, атрибуты и самостоятельные новые предметы (с фото и описанием) и проводится одной атомарной записью; экран поступления показывает «Will be created»; MCP умеет всё то же; во встроенных формах шторок есть крестик.

**Architecture:**
- Сначала `master` вливается в `mcp` (там миграции 0004–0005 и правки файлов, которые `mcp` перенёс в `@antresol/kit`).
- **Ядро** расширяет черновик (`newFolders`, `newAttributes`, описание и фото у `DraftNewItem`), разбор (`resolveIntake` → проблемы строк и сущностей) и команду `intake.commit`. **Хранилище** пишет это в одном батче, миграция 0006 добавляет `intakes.created`.
- Правка черновика — общие чистые функции в `kit/intake-line.ts`, ими пользуются приложение и MCP.

**Tech Stack:** TypeScript, Vitest, PGlite / Neon, drizzle-kit (генерация миграции), Nuxt 4 / Vue 3, `@modelcontextprotocol/sdk`.

**Spec:** `docs/superpowers/specs/2026-11-16-antresol-intake-entities-design.md`. Действуют спеки поступлений (`2026-11-13-…-intakes-design.md`) и MCP (`2026-11-14-…-mcp-design.md`).

## Global Constraints

- **Ветка и место:** worktree `/Users/as/dev/graymatter/.worktrees/mcp`, ветка `mcp`; параллельные задачи — в своих worktree от `mcp`. Не пушить, не вливать в `master`, тегов не ставить.
- **Git:** без строк атрибуции; голые `git stash` / `git stash pop` запрещены; файлы добавлять явными путями; не добавлять `packages/app/nuxt.config.ts`, `proposals.md`, `.claude/`, `.superpowers/`, `.env.local`, `Claude outputs/`, `dist/`, `*.mcpb`.
- **Инструменты:** только pnpm. Neon — только `_test` через `ANTRESOL_NEON_TEST_URL` (лежит в `/Users/as/dev/graymatter/.env.local`, не печатать); набор соответствия гоняют только задачи 1 и 3.
- **Черновики не меняют `rev`.** Всё новое (папки, атрибуты, теги, предметы) становится настоящим только в `intake.commit`, одной атомарной записью, повтор ничего не создаёт дважды.
- **Новые поля черновика необязательны** (`?`), отсутствие = пусто. Совместимость со старыми версиями приложения не нужна (владелец, 2026-11-16).
- **Дубли имён** (trim, без регистра): папка — с существующей (не в архиве) или черновой папкой под тем же родителем; атрибут — с любым существующим или черновым атрибутом. Теги — как сейчас (одноимённый существующий берётся).
- **Одна строка на создаваемый вариант:** две строки не создают один новый вариант (тот же предмет и значения осей); у нового предмета без осей не больше одной строки. Пополнение существующего — как сейчас (можно дважды, с предупреждением).
- **Фото (вариант B):** фото предмета — у нового предмета (в галерею при проведении); фото строки нового варианта — фото варианта; у строки нового предмета без осей поле фото — это фото предмета; строки пополнения фото не несут, «Replace photo» убирается. Фото строк пополнения из старых черновиков проводятся как раньше.
- **Не делаем:** иконки и цвета у черновых папок и предметов (ставятся потом), единицы и «Show in lists» у черновых атрибутов, новые значения в существующих атрибутах-списках, правку существующих предметов.
- **Числа** без float; **тексты** интерфейса — английские в `packages/app/i18n/locales/en.json`, ключи `intakes.*`; контраст ≥ 4.5:1.
- **Проверка в браузере** — только в UI-задачах: два снимка (1280 и 360 px, без горизонтальной прокрутки), demo-данные, свой dev-сервер на порту `3030 + N` из своего worktree, без `--host`.
- **Команды:** `pnpm vitest run <path>`, тяжёлые прогоны с `--maxWorkers=3`; `pnpm typecheck`; `pnpm lint`.

## Review Focus

1. **Циклы и удаление в дереве черновых папок:** перенос папки внутрь её же потомка отказывается; удаление папки, в которой что-то лежит, отказывается — тесты в задачах 2 и 4.
2. **Дубль появился между составлением и проведением** (папку завели в приложении): проведение блокируется с пометкой, «Use existing» перенаправляет ссылки и снимает блок — тесты в задачах 2 и 4.
3. **Резервная копия с новыми частями** (папки, атрибуты, фото и описание предмета, `created`) переживает экспорт → разбор → восстановление «с новыми id» — тест в задаче 3.
4. **Повтор проведения** после неизвестного исхода с черновыми папками и атрибутами ничего не создаёт дважды — тест в задаче 3.
5. **MCP:** фото на строке пополнения и вторая строка того же нового варианта отклоняются с текстом, называющим причину и существующую строку — тест в задаче 5.

---

### Task 1: Влить `master` в `mcp`

Слияние с правилами разрешения. Ревью — сильная модель (данные, миграции).

**Files:** всё, что даст `git merge master`.

- [ ] **Step 1:** `git merge master` в `/Users/as/dev/graymatter/.worktrees/mcp`.
- [ ] **Step 2: Правила разрешения конфликтов:**
  - `packages/app/app/lib/{amounts,attribute-values,quick-add,views,photo-url,intake-line}.ts` в `mcp` — однострочные реэкспорты из `@antresol/kit/<module>`. Правки `master` в этих файлах (`views.ts`, `photo-url.ts`) перенести в `packages/kit/src/<module>.ts`; в `app/lib` оставить реэкспорт.
  - Ядро и хранилище: взять обе стороны — иконки и цвета из `master`, теги черновика из `mcp` (`intake.commit`, `validate.ts`, `restore.ts`, `rows.ts`).
  - Миграции: `0004_icons`, `0005_colors` и их `meta` — из `master` как есть.
  - Компоненты поступлений (`IntakeLineSheet.vue`, `IntakeList.vue`, `IntakeRecord.vue`), `TagPicker.vue`, `pages/settings/index.vue`: обе стороны (теги и «Connect AI» из `mcp`, стили и иконки из `master`).
- [ ] **Step 3:** `pnpm install`, `pnpm vitest run --maxWorkers=3`, `pnpm typecheck`, `pnpm lint`, один прогон набора Neon (`neon.conformance.test.ts`) — PASS; `pnpm --filter @antresol/mcp run pack:mcpb` собирается.
- [ ] **Step 4:** Коммит слияния: `Merge master into mcp: icons and colors (0004, 0005), structural UX`.

---

### Task 2: Ядро — сущности черновика, разбор и команда проведения

После задачи 1. Ревью — сильная модель.

**Files:**
- Modify: `packages/core/src/intakes.ts`, `packages/core/src/commands.ts`, `packages/core/src/validate.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/intakes.test.ts`, тесты валидации `intake.commit` по месту существующих

**Interfaces:**
- Produces (в `intakes.ts`):
  - `interface DraftNewFolder { id: Id; name: string; parentId: Id | null }` — `parentId`: существующая папка, черновая папка или корень.
  - `interface DraftNewAttribute { id: Id; name: string; kind: AttributeKind; unit: string; siPrefixes: boolean; options: string[] }`
  - `DraftNewItem` += `description?: string | null`, `photo?: PhotoFile | null`, `photoId?: Id` (выдаётся при создании предмета; id фото в галерее при проведении).
  - `IntakeDraftContent` += `newFolders?: DraftNewFolder[]`, `newAttributes?: DraftNewAttribute[]`.
  - `interface IntakeCreated { folders: { id: Id; name: string; parentId: Id | null }[]; attributes: { id: Id; name: string }[]; tags: { id: Id; name: string }[]; items: { id: Id; name: string; folderId: Id | null }[] }`; `Intake` += `created: IntakeCreated | null` (null у черновика и у старых проведённых).
  - `type EntityProblem = { code: 'duplicate_name'; existingId: Id } | { code: 'parent_gone' } | { code: 'cycle' } | { code: 'invalid_value' }`
  - `ResolvedIntake` += `entities: { kind: 'folder' | 'attribute' | 'item'; id: Id; problem: EntityProblem | null }[]`; `ok` = нет проблем ни у строк, ни у сущностей, и черновик что-то делает (есть строки или создаёт что-то).
  - `LineResolution` problem codes += `'duplicate_line'` (вторая строка того же создаваемого варианта или нового предмета без осей).
  - `pruneNewItems` больше не выкидывает новые предметы без строк; выкидывает только новые теги, на которые не ссылается ни один новый предмет. Черновые папки и атрибуты не выкидываются.
  - `intake.commit` += `newFolders: { id: Id; parentId: Id | null; name: string }[]` (родители раньше детей), `newAttributes: { id: Id; name: string; kind: AttributeKind; options: string[]; unit: string; siPrefixes: boolean }[]`, `newItems[].description: string | null`, `created: IntakeCreated`. Фото нового предмета — запись в `photos` с `itemId`, `variantId: null`, `id = photoId`.
  - `snapshotAfterIntake` добавляет папки и атрибуты.

- [ ] **Step 1: Write failing tests**
  - вложенные черновые папки `A` (в существующей `Passives`) → `B` (в `A`) и предмет в `B`: `buildIntakeCommit` даёт `newFolders` в порядке `[A, B]`, предмет с `folderId = B`;
  - черновой атрибут `Inductance` (number, `H`, SI) как ось нового предмета: `newAttributes` содержит его, вариант со значением `4.7µ` → каноническое значение по правилам атрибута;
  - черновая папка с именем существующей папки под тем же родителем (`'passives'` vs `Passives` в корне) → сущность `{ kind: 'folder', problem: { code: 'duplicate_name', existingId } }`, `ok = false`; то же для атрибута;
  - родитель черновой папки — существующая папка в архиве → `parent_gone`; черновая папка, чей `parentId` указывает на её потомка → `cycle`;
  - две строки создают вариант `4.7 µH` одного нового предмета → вторая `duplicate_line`; две строки пополнения одного существующего варианта → обе `add`;
  - новый предмет без строк: `ok = true`, в команде предмет есть, `receipts = []`; черновик без строк и без новых сущностей → `ok = false`;
  - фото и описание нового предмета → запись в `photos` (`variantId: null`, `id = photoId`), `newItems[0].description`;
  - `created` перечисляет папки, атрибуты, новые теги и предметы с именами;
  - валидация: `newFolders` с родителем-потомком → `invalid_option`; дубль имени папки под тем же родителем → `duplicate_name`; повтор команды (папки и атрибуты уже есть в снимке с этими id) проходит;
  - черновик в старом формате (без новых полей) разбирается и проводится как раньше.
- [ ] **Step 2: Run** `pnpm vitest run packages/core` — новые тесты FAIL.
- [ ] **Step 3: Implement** по Interfaces. Значения на черновом атрибуте разбираются так же, как на существующем (`canonicalValue` получает атрибут из снимка или из `newAttributes`).
- [ ] **Step 4: Run** `pnpm vitest run packages/core --maxWorkers=3`, `pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(core): intake drafts create nested folders, attributes and standalone items`.

---

### Task 3: Хранилище и резервные копии

После задачи 2. Ревью — сильная модель.

**Files:**
- Create: `packages/storage-postgres/migrations/0006_intake_created.sql` (+ `meta` через drizzle-kit), правка `schema.ts`
- Modify: `packages/storage-postgres/src/commands/intakes.ts`, `src/rows.ts`, `src/queries.ts`, `src/restore.ts`; `packages/app/app/lib/backup.ts`
- Test: `packages/storage-postgres/test/intakes.test.ts`, `test/restore.test.ts`, `packages/app/test/backup.test.ts`

**Interfaces:**
- Consumes: типы и команда задачи 2.
- Produces: колонка `intakes.created jsonb null` (аддитивно, `min_app_schema` не трогать); `Intake.created` читается из неё.

- [ ] **Step 1: Write failing tests**
  - проведение черновика с вложенными папками, атрибутом, предметом с фото и описанием → в снимке папки с нужными `parentId`, атрибут, предмет с `description`, фото в галерее предмета; `created` у проведённого поступления совпадает с командой; патч записи равен свежему снимку;
  - **Review Focus 4:** повтор той же команды после смены `rev` → ничего не создано второй раз (папки, атрибуты, фото, связи);
  - **Review Focus 3:** черновик со всеми новыми частями и проведённое поступление с `created` проходят экспорт → `parseBackup` → восстановление `new-ids`: все id и ссылки (`parentId` между черновыми папками, `folderId`, `attributeId` в атрибутах предметов и `axisValues`, `photoId`, `created.*`) переименованы; копия без новых полей восстанавливается без изменений.
- [ ] **Step 2: Run** `pnpm vitest run packages/storage-postgres packages/app/test/backup.test.ts --maxWorkers=3` — FAIL.
- [ ] **Step 3: Implement.** Порядок батча: проверка → папки (`on conflict (id) do nothing`, под `PENDING`, родители раньше) → атрибуты → теги → предметы (с `description`) → … как сейчас; запись `created` в строку поступления. Миграцию генерировать `drizzle-kit`, номер 0006.
- [ ] **Step 4: Run** те же тесты, `pnpm typecheck`, один прогон набора Neon — PASS.
- [ ] **Step 5: Commit** `feat(storage): intake.commit writes draft folders, attributes, item photos and the created record (migration 0006)`.

---

### Task 4: Правка черновика в `kit`

После задачи 2. Параллельно с задачей 3. Ревью — сильная модель (общая логика приложения и MCP).

**Files:**
- Modify: `packages/kit/src/intake-line.ts` (или новый `packages/kit/src/intake-draft.ts` для функций сущностей — на выбор исполнителя, с реэкспортом из индекса)
- Test: `packages/app/test/intake-line.test.ts`, `packages/kit/test/intake-draft.test.ts`

**Interfaces:**
- Produces (все чистые, возвращают новый черновик или `{ errorKey; params? }`):
  - `withNewFolder(draft, s, folder: DraftNewFolder)`; `withoutNewFolder(draft, id)` (`intakes.folder.notEmpty`, если в ней черновая папка или новый предмет);
  - `withNewAttribute(draft, s, attribute: DraftNewAttribute)`; `withoutNewAttribute(draft, id)` (`intakes.attribute.inUse`, если им пользуется новый предмет);
  - `withNewItem(draft, item: DraftNewItem)`; `withoutNewItem(draft, id)` (удаляет предмет и его строки; для Undo — `restoreNewItem(draft, removed)`);
  - `nameClash(s, draft, q: { kind: 'folder'; name: string; parentId: Id | null } | { kind: 'attribute'; name: string }, exceptId?: Id): { id: Id; draft: boolean } | null`;
  - `useExisting(draft, draftId: Id, existingId: Id)` — перенаправляет все ссылки (дети папки, `folderId` предметов, `attributeId` в атрибутах предметов и `axisValues` строк) и удаляет черновую сущность;
  - `creatingLineOf(s, draft, itemId: Id, values: { attributeId: Id; value: string }[], exceptLineId?: Id): Id | null`;
  - `buildDraftLine` (существующая) — новые правила: строка пополнения с фото → `intakes.line.noPhotoOnTopUp`; у нового предмета без осей фото формы уходит в `newItem.photo`, `line.photo = null`; вторая создающая строка → `intakes.line.alreadyCreated` с `params.line`; папка/атрибут нового предмета может быть черновым;
  - `withLine` больше не удаляет новые предметы без строк (см. `pruneNewItems`).

- [ ] **Step 1: Write failing tests:** по одному на каждую функцию из Interfaces, включая **Review Focus 1** (перенос папки внутрь потомка через `withNewFolder` → `intakes.folder.cycle`; удаление непустой → `notEmpty`) и **Review Focus 2** (`nameClash` находит существующую `Passives`; `useExisting` перенаправляет предмет и дочернюю черновую папку, после чего `resolveIntake` без проблем сущностей).
- [ ] **Step 2: Run** `pnpm vitest run packages/kit packages/app/test/intake-line.test.ts` — FAIL.
- [ ] **Step 3: Implement**; новые ключи текстов — в `en.json` (`intakes.folder.*`, `intakes.attribute.*`, `intakes.line.noPhotoOnTopUp`, `intakes.line.alreadyCreated`).
- [ ] **Step 4: Run** те же тесты, `pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(kit): draft folders, attributes and standalone items; use existing; one line per created variant`.

---

### Task 5: MCP

После задач 3 и 4. Ревью — средняя модель.

**Files:**
- Modify: `packages/mcp/src/tools/drafts.ts` (или новый `tools/draft-entities.ts`), `src/shape.ts`, `src/server.ts`, `src/prompts.ts`
- Test: `packages/mcp/test/drafts.test.ts`, `test/protocol.test.ts`

**Interfaces:**
- Consumes: функции задачи 4; `editDraft`, `checkEditable`, `attachPhoto`, `markPhotosUsed` (существующие).
- Produces — инструменты:
  - `create_folder` (`intake`, `name`, `parent?`: id или путь, существующий или черновой), `update_folder`, `remove_folder`;
  - `create_attribute` (`intake`, `name`, `kind`: `number | list | text`, `unit?`, `siPrefixes?`, `options?`), `update_attribute`, `remove_attribute`;
  - `add_intake_lines.newItems[]` += `description?`, `photo?` (путь), `withoutLines?: true` разрешает предмет без строк; `update_new_item` += `description`, `photo`; `remove_new_item`;
  - `get_intake` (`IntakeView`) += `newFolders` (путь, проблема), `newAttributes`, у `newItems` — `description`, `photo`, проблема сущности;
  - пути папок в аргументах (`folder`, `parent`) понимают и черновые папки этого черновика.
- Ошибки — тексты `messageFor` по ключам задачи 4; дубль имени — ошибка с путём или именем существующей сущности и её id.

- [ ] **Step 1: Write failing tests:** вложенные `create_folder` по путям; дубль папки и атрибута → ошибка с id существующего; **Review Focus 5** (фото на строке пополнения → ошибка `noPhotoOnTopUp`; вторая строка `4.7 µH` нового предмета → ошибка с номером первой строки); предмет с фото без строк; `remove_folder` непустой → ошибка; `get_intake` показывает всё новое; `listTools` содержит новые инструменты.
- [ ] **Step 2: Run** `pnpm vitest run packages/mcp` — FAIL.
- [ ] **Step 3: Implement.** Промпт `intake_from_photos`: одно фото на новый предмет; фото варианта — только если вариант выглядит иначе; папки и атрибуты создавать, только если ничего подходящего нет (сначала `get_overview` и `search`); нужного значения в списке нет → оставить пустым и сказать в чате.
- [ ] **Step 4: Run** `pnpm vitest run packages/mcp --maxWorkers=3`, `pnpm typecheck`, `pnpm --filter @antresol/mcp run pack:mcpb` — PASS.
- [ ] **Step 5: Commit** `feat(mcp): draft folders and attributes, item photos and descriptions, items without lines`.

---

### Task 6: Экран поступления — «Will be created», New folder, «Created»

После задачи 4. Параллельно с задачами 5 и 7. Без отдельного ревью (UI).

**Files:**
- Create: `packages/app/app/components/IntakeWillCreate.vue` (блоки папок, атрибутов, предметов), `IntakeNewItemCard.vue`, `IntakeFolderSheet.vue`
- Modify: `IntakeDraftScreen.vue` (кнопка «New folder» в шапке рядом с «Details», блоки сверху, подпись кнопки проведения), `IntakeRecord.vue` (раздел «Created»), `AttributeForm.vue` (режим черновика: проп `draft` → `emit('draft', DraftNewAttribute)` вместо `apply`), `en.json`
- Test: `packages/app/test/intake-commit-label.test.ts` (подпись кнопки — чистая функция)

**Interfaces:**
- Consumes: задачу 4.
- Produces: `AttributeForm` с пропом `draft?: boolean` и событием `draft`; `commitLabel(draft, resolved): { key: string; count: number } | null` в `packages/kit/src/intake-line.ts` или `app/lib` (null — кнопка выключена).

- [ ] **Step 1: Write failing test:** `commitLabel` — 3 строки → `intakes.screen.commitLines` с 3; нет строк, 2 новых предмета → `intakes.screen.commitItems` с 2; ничего → `null`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** по спеке §4:
  - блок папок — компактное дерево под ближайшей существующей папкой с её путём; тап открывает `IntakeFolderSheet` (имя, родитель: дерево существующих и черновых, «Remove»); при вводе имени дубля — «Use existing <name>» вместо сохранения;
  - блок атрибутов — строка на атрибут (имя, тип, единица), правка в `AttributeForm` (режим черновика), удаление; дубль — «Use existing»;
  - блок предметов — свёрнутая строка: миниатюра или пустой слот, имя, путь папки, значения вариантов из строк без количества; развёрнутая карточка: фото (поставить, заменить, убрать — `PhotoPicker`), имя, папка, описание, единица, теги, атрибуты, список вариантов; «Remove item» с Undo;
  - проблемы сущностей — пометка на карточке или строке блока с «Use existing», где это дубль;
  - блоки скрыты, когда пусты; у проведённого поступления — раздел «Created» из `intake.created`.
- [ ] **Step 4: Run** `pnpm vitest run packages/app --maxWorkers=3`, `pnpm typecheck`, `pnpm lint` — PASS. Два снимка экрана черновика с папками, атрибутом и раскрытым предметом (1280 и 360 px).
- [ ] **Step 5: Commit** `feat(app): intake screen shows what the commit will create; draft folders and attributes; item cards with photo`.

---

### Task 7: Шторка строки и крестики встроенных форм

После задачи 6 (общий `AttributeForm`). Без отдельного ревью (UI).

**Files:**
- Modify: `IntakeLineSheet.vue`, `IntakeNewItemAttributes.vue`, `IntakeNewItemTags…`/папки в шторке (по месту), компоненты встроенных форм создания внутри шторок (найти все: `AttributeForm` в `IntakeNewItemAttributes.vue`, `ItemAxes.vue`, `AttributeValueSheet.vue`; формы единиц и тегов, где они встроены), `en.json`
- Test: `packages/app/test/intake-line.test.ts` (если появится новая чистая логика)

- [ ] **Step 1: Implement** по спеке §4 «Line sheet changes»:
  - выбор папки показывает черновые папки (чипы и «Other…», с пометкой new);
  - «New attribute» — `AttributeForm` в режиме черновика → `withNewAttribute`; список атрибутов показывает черновые с пометкой new;
  - описание нового предмета (свёрнуто, как «Price & link»);
  - фото: у строки пополнения поля нет, «Replace photo» убран; у нового предмета без осей — фото предмета (то же поле, что в карточке); у нового варианта — фото варианта;
  - вторая создающая строка: «Already in this intake» и «Edit that line» вместо сохранения.
- [ ] **Step 2: Крестики:** каждая встроенная форма создания внутри шторки получает видимую кнопку × (как у шторки), которая отменяет форму; `aria-label` по-английски.
- [ ] **Step 3: Run** `pnpm vitest run packages/app --maxWorkers=3`, `pnpm typecheck`, `pnpm lint` — PASS. Два снимка: шторка нового предмета с черновой папкой и встроенной формой атрибута с крестиком (1280 и 360 px).
- [ ] **Step 4: Commit** `feat(app): line sheet uses draft folders and attributes, photo rules, one line per created variant; close buttons on inline forms`.

---

## Порядок и параллельность

1. Задача 1.
2. Задача 2.
3. Задачи 3 и 4 — параллельно.
4. Задачи 5 и 6 — параллельно (5 после 3 и 4; 6 после 4).
5. Задача 7 (после 6).
6. Итоговое ревью двумя половинами: данные (1–5) и приложение (6–7).

## Перенос на потом (carry-over)

- Новые значения в существующих атрибутах-списках из черновика.
- Иконки и цвета у черновых папок и предметов; единицы и «Show in lists» у черновых атрибутов.
- Остальной перенос — из плана MCP (`2026-11-14-antresol-mcp.md`).
