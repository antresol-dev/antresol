# GrayMatter — План 3: предметы

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Новая раскладка приложения и работа с предметами целиком:
- каркас по `2026-11-10-graymatter-shell-design.md`: левая панель приложения, дерево с линиями, шапка экрана со стрелками «назад» и «вперёд», действия на виду, палитра поиска, долгое нажатие на телефоне, hover и анимации;
- экран «Архив» с восстановлением и окончательным удалением;
- карточка предмета: количества, цены, журнал, правка, перенос, архивация;
- быстрое добавление кнопкой «+»;
- движения запаса, варианты, атрибуты, теги, свои единицы.

Плюс долги плана 2: обновления без лишних запросов, редкие гонки workspace, доступность и формы.

**Architecture:** Как в плане 2.
- Логика живёт в чистых модулях `packages/app/app/lib/` и тестируется Vitest без Nuxt. Компоненты тонкие: показывают данные из `lib` и вызывают действия workspace.
- Ядро и хранилище уже умеют все нужные команды: `item.*`, `variant.*`, `stock.*`, `tag.*`, `attribute.*`, `unit.*`, `archive`, `restore`, `deletePermanently`. Этот план почти не трогает `packages/core` и `packages/storage-postgres`.
- **Каркас (Tasks 2, 5, 6) идёт до экранов архива и карточки**, чтобы они сразу легли в новую раскладку.
  - Один layout `default` для всех экранов с инвентарём и настроек: левая панель, панель дерева в разделе Items, основная колонка.
  - `/welcome` получает layout `bare` без каркаса.
  - Каждый экран рисует свою шапку `ScreenHeader` и тело `ScreenBody`.
- **Общие диалоги.** Формы папки, предмета и быстрого добавления открываются из многих мест: кнопки шапки, «⋯» строк, долгое нажатие, палитра. Поэтому их состояние живёт в `composables/useDialogs.ts`, а сами шторки смонтированы один раз в layout.
- Новые экраны: `/archive`, `/item/[id]`, `/dictionaries`, все в layout `default`.
- **[решение Claude]** На компьютере карточка предмета — отдельная страница рядом с деревом папок, без трёхпанельной раскладки «дерево, список, карточка».

**Tech Stack:** без новых зависимостей, кроме компонентов shadcn-vue `textarea`, `checkbox`, `switch`, `tooltip`. Их добавляют через `pnpm dlx shadcn-vue@latest add …` из `packages/app`, утилита `cn` берётся из пакета `cn`, как в плане 2.

**Spec:**
- `docs/superpowers/specs/2026-11-10-graymatter-revival-design.md` — основная спека;
- `docs/superpowers/specs/2026-11-10-graymatter-shell-design.md` — каркас, заменяет в основной спеке пункт 4.6 про главный экран и раскладку на компьютере;
- `docs/superpowers/specs/2026-11-10-graymatter-shell-mockup.html` — макет каркаса: структура, размеры, поведение. Где макет и текст расходятся, прав текст.

**Предыдущие планы:** `2026-11-10-graymatter-1-core-storage.md` и `2026-11-10-graymatter-2-app-shell.md` выполнены. Долги плана 2 перечислены в конце его файла, в разделе «Перенос в план 3». Этот план закрывает их в Tasks 2, 4, 13 и 14.

## Последовательность планов

1. Ядро и хранилище (готово).
2. Каркас приложения (готово).
3. **Предметы** (этот). Без фото: в карточке и списках остаётся заглушка-иконка.
4. **Фото** **[решение Claude: фото вынесены из плана 3, чтобы карточка и архив появились раньше]**:
   - интерфейс файлов в `core` и пакет `files-uploadcare`;
   - уменьшение до 2048 px на устройстве;
   - галерея предмета с обложкой, фото варианта, фото в быстром добавлении, миниатюры в списках.
5. **Выпуск** (бывший план 4). Включает раздел «Перенос в план 4» из плана 2.

## Перед началом

1. Работаем в ветке `revival`, все команды — `pnpm` из корня (Node закреплён через `devEngines`).
2. Экраны проверяются на демо-источнике: `pnpm dev`, затем на `/welcome` кнопка «Use demo data». Демо-данные заполняются только в пустой базе. Чтобы увидеть новые демо-данные, удалите демо-источник в настройках и добавьте его снова.
3. Владелец может держать свой `pnpm dev` на порту 3000. Его не останавливать. Для своей проверки запускайте `pnpm --filter @graymatter/app dev --port 3001` и останавливайте после проверки. `--host` не использовать.

## Global Constraints

- **Своего сервера нет.** Всё работает в браузере. Node-only API — только в конфигах и тестах.
- **Секреты только на устройстве.** Строка подключения не попадает в код, URL, логи и тексты ошибок. Пользовательский контент не вставляется через `v-html` (`vue/no-v-html`: error).
- **Тексты интерфейса только через i18n**, локаль `en`. Правила `@intlify/vue-i18n/no-raw-text` и `no-missing-keys` — error, в том числе в скопированных компонентах shadcn-vue и в `sr-only`.
- **Не клиент базы данных.** В интерфейсе слова «item», «variant», «inventory», «source», «history». Новых текстов со словами «database», «schema», «table», «row», «record» нет. Исключения из плана 2 — подсказка к строке подключения и сообщение о несовместимой базе — остаются.
- **Без оптимистичных обновлений.** Запись идёт сразу в источник. Пока она идёт, кнопка показывает «Saving…». После подтверждения снимок перезагружается, и экран берёт данные из нового снимка. Кнопки записи выключены, пока `state.readOnly` не пуст.
- **Числа.**
  - Количество — строка `Quantity` из `core`. Арифметика только через `addQ`, `cmpQ` и другие помощники `core`, никогда через `Number`.
  - Деньги — целые минорные единицы валюты инвентаря.
  - Показ чисел, денег и дат — с локалью `'en'`.
- **Ссылки из данных** (`sourceUrl`) выводятся как `<a href target="_blank" rel="noopener noreferrer">`. Ядро пропускает только `http(s)://`.
- **Стиль E.** Цвета — только токены из `main.css`:
  - `bg-background`, `bg-surface`, `border-border`, `bg-divider`;
  - `text-foreground`, `text-muted-foreground`, `text-subtle-foreground`, `text-dimmed-foreground`;
  - `bg-chip`, `bg-primary`, `text-primary`, `text-primary-foreground`, `bg-accent-soft`, `text-accent-soft-foreground`;
  - `bg-thumb`, `text-thumb-foreground`, `text-icon`, `text-destructive`;
  - новые из Task 2: `bg-hover` (строка под указателем), `bg-rail` (левая панель), `border-tree-line` (линии дерева).

  Других новых цветов не вводить. **Действия нейтральные:** кнопки «New folder», «Rename», «Move», «Archive», «Edit» — обычные или прозрачные, без цветных подложек. Акцент — только у главной кнопки, выделения и иконок папок (анти-цель из дизайна каркаса).
- **Каркас** — по дизайну `2026-11-10-graymatter-shell-design.md`:
  - **Ширина.** От 1024 px (`lg`) три колонки, ниже — мобильная раскладка.
  - **Ввод.** Долгое нажатие работает при касании, на любой ширине. Видимость «⋯» и «+» в строках задаёт утилита `.row-action` (Task 5).
  - **Hover.** Только через вариант Tailwind `hover:`, он срабатывает лишь при `(hover: hover)`. Переходы `transition-colors duration-150`.
  - **Без движения при `prefers-reduced-motion: reduce`.** Выезды, масштаб и поворот стрелки выключены вариантом `motion-reduce:`.
  - **Фокус.** Кольцо `focus-visible:ring-2 ring-ring` вокруг самого элемента, не вокруг контейнера.
  - **Без подъёма при наведении.** Ничего, кроме открытых слоёв, не поднимается тенью и не обводится.
  - **Зазор 2 px** (`gap-0.5`) между скруглёнными строками, которые можно выделить или навести: дерево, палитра, меню, списки в шторках, разделы панели.
  - **Число в строке** не скрывается и не сливается с фоном при наведении или выделении.
- **Размеры:**
  - скругления `rounded-field` (14), `rounded-card` (16), `rounded-thumb` (12), `rounded-icon` (10), `rounded-fab` (18);
  - строки: папки 50 px, предметы и варианты 62 px;
  - зоны нажатия ≥ 44 px;
  - заголовок экрана — `h1` 24 px, жирный, letter-spacing −0.02em;
  - отступы экрана `10px 16px`, вертикальный шаг 14 px.
- **Ширина.** На 360 px нет горизонтальной прокрутки, длинные имена обрезаются многоточием или переносятся.
- **Шторки на телефоне.** Клавиатура сжимает окно (`interactive-widget=resizes-content`, коммит `3b9b10e`). Шторка с полями ввода помещается над клавиатурой, а если не помещается, прокручивается внутри (Task 7).
- **Окружение:**
  - `api/` и `web/` не трогаем;
  - глобальный конфиг npm не меняем;
  - коммиты без трейлеров `Claude-Session` и `Co-Authored-By`.
- **Проверки:** `pnpm test`, `pnpm typecheck`, `pnpm lint` зелёные после каждой задачи.

## Review Focus

1. **Предмет или его папку заархивировали или удалили на другом устройстве, пока открыта карточка.**
   - Ожидание: карточка показывает «этого предмета здесь больше нет» со ссылкой в инвентарь. Нет падения и пустого экрана.
   - Тест `itemView` в Task 4.
2. **Количества и цены в человеческом виде.**
   - Ввод: `1,5`, `50cm`, `10k` для штук, `0.0000001`, пробелы, минус; цена за партию 2,30 $ на 100 шт; валюта без копеек (JPY).
   - Ожидание: ввод либо разбирается точно, либо даёт понятную ошибку у поля. Без `NaN` и без тихого округления. Цена за штуку видна с нужной точностью: `$0.023`.
   - Тесты `format` в Task 3, `amounts` в Task 7, `stock-forms` в Task 9.
3. **Длинная форма в шторке и палитра поиска при открытой клавиатуре на телефоне 360×640.**
   - Ожидание: шторка прокручивается внутри, поле в фокусе и кнопка сохранения достижимы. Поле палитры стоит прямо над клавиатурой, «Cancel» и лучший результат видны.
   - Исполнитель проверяет в DevTools на 360×640. Контроллер после Tasks 6, 7 и 9 проверяет на телефоне владельца через `adb`, как при исправлении `3b9b10e`, если телефон подключён. Иначе пункт уходит в приёмку владельцем.
4. **Нет сети или источник только для чтения, пока открыта карточка.**
   - Ожидание: кнопки записи выключены, баннер объясняет причину. Журнал пишет, что недоступен без связи, и даёт Retry, без вечного индикатора загрузки.
   - Тесты `loadMovements` в Task 1, ручная проверка в Task 4.
5. **Архив: предмет заархивировали отдельно, а потом заархивировали его папку.**
   - Ожидание: в архиве две записи. Восстановление папки не возвращает отдельно заархивированный предмет. Восстановление предмета возвращает и цепочку его папок. Удаление папки навсегда удаляет и предмет внутри, и текст подтверждения об этом предупреждает.
   - Тесты `archiveEntries` в Task 3. Правила хранилища уже покрыты тестами плана 1.

---

## Структура файлов

```
packages/app/
  nuxt.config.ts                  (без изменений; viewport уже исправлен)
  i18n/locales/en.json            + ключи каждой задачи
  app/assets/css/main.css         + токены hover, rail, tree-line; утилита .row-action (Tasks 2, 5)
  app/layouts/
    default.vue                   каркас: левая панель, панель дерева, основная колонка, общие шторки (Task 2)
    bare.vue                      без каркаса, для /welcome (Task 2)
    inventory.vue                 удаляется (Task 2)
  app/plugins/
    history-sync.client.ts        записи истории помечаются инвентарём (Task 2)
  app/composables/
    useShell.ts                   открытие выдвижного меню и палитры (Tasks 2, 6)
    useNavHistory.ts              «назад» и «вперёд» (Task 2)
    useDialogs.ts                 общие диалоги папки, предмета, быстрого добавления (Tasks 5, 7, 8)
    useLongPress.ts, useCloseWatcher.ts   (Task 5)
  app/lib/
    shell.ts                      разделы, раздел по маршруту, текущая строка дерева (Task 2)
    tree-state.ts                 раскрытие дерева и его хранение на устройстве (Task 2)
    history-nav.ts                доступность стрелок, синхронизация инвентаря с историей (Task 2)
    palette.ts                    compactText, highlightParts, matchFolders, paletteActions (Task 6)
    workspace.ts                  + archivedInventories, applyTo, loadMovements; гонки (Task 13)
    device-db.ts                  + списки инвентарей на устройстве (Task 13)
    archive.ts                    archiveEntries
    format.ts                     formatMoney, formatUnitPrice, formatDate, formatDateTime
    item-view.ts                  itemView, journalRows, looseTransferOffer, attributeChoices
    amounts.ts                    unitChoices, parseAmountText, parseMoneyText
    quick-add.ts                  buildQuickAdd
    stock-forms.ts                buildStockCommand, quickStep
    lists.ts                      parseNameList
    tags.ts                       tagMatches
    dictionaries.ts               dictionaryView
    views.ts                      + itemCount в TreeNode, inventoryItemCount, обобщённый collapseCrumbs (Task 2); folderChoices (Task 7)
    dev/demo-source.ts            + архивные записи, теги, атрибуты
  app/pages/
    archive.vue
    item/[id].vue
    dictionaries.vue
  app/components/
    AppNav.vue, TreePanel.vue, FolderTree.vue, FolderTreeNode.vue, NavDrawer.vue    (Task 2)
    ScreenHeader.vue, ScreenBody.vue, NavArrows.vue                                  (Task 2)
    FolderHeader.vue, Breadcrumbs.vue                                                удаляются (Task 2)
    FolderDialogs.vue, FolderActions.vue, RowMenu.vue                                (Task 5)
    FolderMenu.vue                                                                   удаляется (Task 5)
    SearchPalette.vue, MobileDock.vue                                                (Task 6)
    SearchField.vue, SearchResults.vue                                               удаляются (Task 6)
    AppSheet.vue                  + прокрутка, initialFocus, locked, жест «назад»
    ArchiveList.vue
    ItemScreen.vue, StockCard.vue, BucketList.vue, JournalList.vue, ItemAttributes.vue
    ItemActions.vue, ItemDialogs.vue, ItemForm.vue, TagPicker.vue, FolderPickerList.vue
    QuickAddSheet.vue, QuickAddForm.vue, AmountField.vue
    StockSheet.vue, VariantsForm.vue, VariantForm.vue, LooseTransferSheet.vue
    AttributeForm.vue, AttributeValueSheet.vue
    TagsSection.vue, AttributesSection.vue, UnitsSection.vue, UnitForm.vue
    ui/textarea, ui/checkbox, ui/switch, ui/tooltip   (shadcn-vue)
  test/
    shell.test.ts, tree-state.test.ts, history-nav.test.ts, palette.test.ts,
    long-press.test.ts, close-watcher.test.ts,
    archive.test.ts, format.test.ts, item-view.test.ts, amounts.test.ts, quick-add.test.ts,
    stock-forms.test.ts, lists.test.ts, tags.test.ts, dictionaries.test.ts
    workspace.test.ts, views.test.ts, device-db.test.ts, currencies.test.ts, demo-source.test.ts   (дополняются)
```

Снимки для тестов `lib` строятся так же, как в `test/views.test.ts`: демо-драйвер в памяти, затем нужные команды через `storage.apply`, затем `storage.loadInventory`. Все тесты `lib`, старые и новые, берут демо-данные без дополнений: `createDemoDriver({ memory: true, extras: false })` (Task 3). Нужное для теста каждый тест создаёт сам.

Композиции из `app/composables/`, которые тестируются (`useLongPress`, `useCloseWatcher`), импортируют `ref`, `watch` и другое из `vue` явно, без автоимпорта Nuxt, и тестируются внутри `effectScope()`.

---

### Task 1: Workspace — архивные инвентари, запись в любой инвентарь, журнал

**Files:**
- Modify: `packages/app/app/lib/workspace.ts`
- Test: `packages/app/test/workspace.test.ts`

**Interfaces:**
- Consumes: `InventoryStorage.loadMovements(itemId)` из `core` (новые записи первыми).
- Produces:
  - `WorkspaceState.archivedInventories: InventoryEntry[]` — архивные инвентари всех источников, сортировка как у `inventories`. Внутренний `listings` теперь хранит все инвентари источника, активные отбираются при сборке списков.
  - `Workspace.applyTo(ref: InventoryRef, command: Command): Promise<void>` — запись в любой инвентарь подключённого источника. Проверка идёт по снимку этого инвентаря: `state.snapshot`, если `ref` текущий, иначе `conn.storage.loadInventory(ref.inventoryId)` внутри задания очереди.
  - `Workspace.apply(command)` — это `applyTo(state.current, command)`, контракт прежний.
  - `Workspace.loadMovements(itemId: Id): Promise<Movement[]>` — журнал предмета текущего инвентаря, новые записи первыми.
    - Без подключения или при статусе `unreachable`/`error` сразу отклоняет `StorageError('unavailable')`, не обращаясь к сети.
    - Ошибки чтения проходят через `redactError`. `unavailable` помечает источник так же, как неудачная загрузка снимка.
  - После успешного `deletePermanently` с `target: 'inventory'`: список перечитывается (`isRelistCommand` расширен) и удаляется кеш снимка этого инвентаря (`db.deleteSnapshot(ref)`).

- [ ] **Step 1: Write the failing tests** (номера продолжают существующие в файле):

```ts
it('21. keeps archived inventories in their own list', async () => {
  // two inventories A, B in one source; archive B via apply while B is current, or via applyTo
  expect(ws.state.inventories.map((e) => e.inventory.name)).toEqual(['A'])
  expect(ws.state.archivedInventories.map((e) => [e.inventory.name, e.sourceName])).toEqual([['B', source.name]])
})
it('22. restores an archived inventory while another one is current', async () => {
  const b = ws.state.archivedInventories[0]!
  await ws.applyTo(b.ref, { type: 'restore', archiveId: b.inventory.archiveId! })
  expect(ws.state.inventories.map((e) => e.inventory.name)).toEqual(['A', 'B'])
  expect(ws.state.archivedInventories).toEqual([])
  expect(ws.state.current).toEqual(refA)
})
it('23. permanently deletes an archived inventory and its cached copy', async () => {
  await ws.applyTo(b.ref, { type: 'deletePermanently', target: 'inventory', id: b.inventory.id })
  expect(ws.state.archivedInventories).toEqual([])
  expect(await db.getSnapshot(b.ref)).toBeNull()
})
it('24. applyTo validates against the target inventory', async () => {
  await expect(ws.applyTo(b.ref, { type: 'restore', archiveId: newId() })).rejects.toMatchObject({ code: 'not_found' })
})
it('25. loads the journal of the current inventory newest first', async () => {
  // item with stock.receive 37 then stock.use 5
  expect((await ws.loadMovements(itemId)).map((m) => [m.kind, m.quantity])).toEqual([['usage', '-5'], ['receipt', '37']])
})
it('26. the journal fails fast when the source is unreachable', async () => {
  // harness flag makes the source unreachable, refresh() marks it
  await expect(ws.loadMovements(itemId)).rejects.toMatchObject({ code: 'unavailable' })
  // the harness counts executor calls: none were made by loadMovements
})
```

- [ ] **Step 2: Run, verify they fail:** `pnpm test --project @graymatter/app -t "workspace"` — FAIL: `archivedInventories` и `applyTo` не определены.
- [ ] **Step 3: Implement** по Interfaces. `write(sourceId, command, snapshotFor)` остаётся общим путём записи.
- [ ] **Step 4: Run all app tests:** `pnpm test --project @graymatter/app` — PASS.
- [ ] **Step 5: Commit:** `feat(app): archived inventories, writes to any inventory and the item journal in the workspace`

---

### Task 2: Каркас — левая панель, дерево, шапка экрана, «назад» и «вперёд»

Дизайн: разделы 6.1–6.4 и 8 из `2026-11-10-graymatter-shell-design.md`, макет `2026-11-10-graymatter-shell-mockup.html`. Поиск в этой задаче остаётся старым полем над списком: палитра — Task 6. Действия папки пока остаются в меню `FolderMenu`, оно переезжает в слот действий шапки: кнопки на виду — Task 5.

**Files:**
- Create:
  - `app/lib/shell.ts`, `app/lib/tree-state.ts`, `app/lib/history-nav.ts`;
  - `test/shell.test.ts`, `test/tree-state.test.ts`, `test/history-nav.test.ts`;
  - `app/composables/useShell.ts`, `app/composables/useNavHistory.ts`;
  - `app/plugins/history-sync.client.ts`;
  - `app/layouts/bare.vue`;
  - `app/components/AppNav.vue`, `TreePanel.vue`, `FolderTreeNode.vue`, `NavDrawer.vue`, `ScreenHeader.vue`, `ScreenBody.vue`, `NavArrows.vue`.
- Modify:
  - `app/layouts/default.vue` — каркас;
  - `app/components/FolderTree.vue` — новое дерево;
  - `app/components/InventorySwitcher.vue` — новая кнопка и порядок переключения;
  - `app/components/FolderScreen.vue` — `ScreenHeader` и `ScreenBody`;
  - `app/pages/index.vue`, `app/pages/folder/[id].vue` — layout `default`;
  - `app/pages/welcome.vue` — layout `bare`;
  - `app/pages/settings/*.vue` — `ScreenHeader` вместо своего заголовка;
  - `app/lib/views.ts`, `test/views.test.ts`;
  - `app/assets/css/main.css`;
  - `en.json`.
- Delete: `app/layouts/inventory.vue`, `app/components/FolderHeader.vue`, `app/components/Breadcrumbs.vue`.

**Interfaces:**
- Consumes: `workspace.selectInventory`, `state.current`, `state.inventories`, `useWorkspaceReady()`.
- Produces:

```ts
// shell.ts
export type Section = 'items' | 'archive' | 'dictionaries' | 'settings'
/** Sections in the app panel between the inventory switcher and Settings. Task 3 adds archive, Task 12 adds dictionaries. */
export const NAV_SECTIONS: { key: Exclude<Section, 'settings'>; to: string }[]   // [{ key: 'items', to: '/' }]
/** index, folder-id, item-id → items; archive; dictionaries; settings, settings-sources-id, settings-sources-new → settings; anything else → null. */
export function sectionOf(routeName: string | null | undefined): Section | null
/** The tree panel shows in the items section only. */
export function showsTree(routeName: string | null | undefined): boolean
/** The current tree row: 'root' on index; the folder on folder-id; the item's folder ('root' when it has none) on item-id;
 *  null on other routes, without a snapshot, or when the item is unknown. */
export function treeCurrent(s: InventorySnapshot | null, routeName: string | null | undefined, params: Record<string, string | string[]>): Id | 'root' | null

// tree-state.ts
/** Folder ids the user has open. Absent = closed: folders start collapsed. */
export type TreeOpen = Record<Id, true>
export interface TreeRow {
  id: Id
  name: string
  /** Active items in the subtree, the same number as in the folder list. */
  itemCount: number
  hasChildren: boolean
  open: boolean
  current: boolean
  /** Rows of the children; empty while closed. */
  children: TreeRow[]
}
export function treeRows(s: InventorySnapshot, open: TreeOpen, current: Id | 'root' | null): TreeRow[]
/** Opens every ancestor of folderId, not the folder itself; returns the same object when nothing changes. */
export function openPath(s: InventorySnapshot, open: TreeOpen, folderId: Id | null): TreeOpen
export function toggleOpen(open: TreeOpen, id: Id): TreeOpen
/** localStorage key `gm-tree:<inventoryId>`; {} when missing, unreadable or the storage throws. */
export function loadTreeOpen(inventoryId: Id): TreeOpen
/** Failures are ignored: the tree state is a convenience. */
export function saveTreeOpen(inventoryId: Id, open: TreeOpen): void

// history-nav.ts
/** Vue Router keeps `back` and `forward` (string or null) in history.state. */
export function navAvailability(historyState: unknown): { canBack: boolean; canForward: boolean }
export const INVENTORY_KEY = 'gmInventory'
export function entryInventory(historyState: unknown): InventoryRef | null
export type EntrySync = { kind: 'stamp' } | { kind: 'none' } | { kind: 'switch'; ref: InventoryRef } | { kind: 'root' }
/** After a navigation lands on a history entry:
 *  - not stamped yet → stamp it with the current inventory;
 *  - stamped with the current inventory → nothing;
 *  - stamped with another inventory that is still active (in `known`) → switch to it;
 *  - stamped with an inventory that is gone → open the current inventory's root. */
export function entrySync(entry: InventoryRef | null, current: InventoryRef | null, known: InventoryRef[]): EntrySync

// views.ts
export interface TreeNode { id: Id; name: string; itemCount: number; children: TreeNode[] }   // + itemCount
export function inventoryItemCount(s: InventorySnapshot): number                             // active items in the whole inventory
export function collapseCrumbs<T>(crumbs: T[], max?: number): (T | 'ellipsis')[]            // generic, same rule

// useShell.ts — useState, shared by the layout and the screens
export function useShell(): { drawerOpen: Ref<boolean> }        // Task 6 adds paletteOpen
// useNavHistory.ts
export function useNavHistory(): { canBack: Ref<boolean>; canForward: Ref<boolean>; back(): void; forward(): void }
```

```vue
<!-- ScreenHeader.vue -->
props: { title: string; subtitle?: string | null; crumbs?: { name: string; to: string }[]; current?: string | null }
slot actions: { compact: boolean }   <!-- compact = below 1024 px: icon-only buttons in the top bar -->
<!-- ScreenBody.vue: the content column of a screen -->
```

- [ ] **Step 1: Write the failing tests.**

`test/shell.test.ts`:

```ts
it('maps routes to sections', () => {
  expect(['index', 'folder-id', 'item-id'].map(sectionOf)).toEqual(['items', 'items', 'items'])
  expect(['archive', 'dictionaries', 'settings', 'settings-sources-id', 'settings-sources-new'].map(sectionOf))
    .toEqual(['archive', 'dictionaries', 'settings', 'settings', 'settings'])
  expect([sectionOf('welcome'), sectionOf(null)]).toEqual([null, null])
  expect(['index', 'item-id', 'archive', 'settings'].map(showsTree)).toEqual([true, true, false, false])
})
it('finds the current tree row', () => {
  expect(treeCurrent(snap, 'index', {})).toBe('root')
  expect(treeCurrent(snap, 'folder-id', { id: opamps })).toBe(opamps)
  expect(treeCurrent(snap, 'item-id', { id: tl072 })).toBe(opamps)
  expect(treeCurrent(snap, 'item-id', { id: newId() })).toBeNull()
  expect(treeCurrent(null, 'index', {})).toBeNull()
  expect(treeCurrent(snap, 'archive', {})).toBeNull()
})
```

`test/tree-state.test.ts`:

```ts
it('starts collapsed with subtree counts', () => {
  expect(treeRows(snap, {}, 'root').map((r) => [r.name, r.itemCount, r.hasChildren, r.open, r.children.length]))
    .toEqual([['ICs', 3, true, false, 0], ['Passive components', 1, true, false, 0], [expect.stringContaining('Очень длинное'), 0, false, false, 0]])
})
it('opens the path to the current folder and marks it', () => {
  const open = openPath(snap, {}, opamps)
  expect(open).toEqual({ [ics]: true })
  const rows = treeRows(snap, open, opamps)
  expect(rows[0]!.children.map((r) => [r.name, r.current])).toEqual([['Op-amps', true]])
  expect(openPath(snap, open, opamps)).toBe(open)
})
it('toggles a folder open and closed', () => {
  expect(toggleOpen(toggleOpen({}, ics), ics)).toEqual({})
})
it('skips archived folders and folders under them', () => { /* archive 'ICs' → rows have no ICs, Op-amps */ })
it('keeps the tree state per inventory and survives a broken storage', () => {
  saveTreeOpen('inv-a', { [ics]: true })
  expect(loadTreeOpen('inv-a')).toEqual({ [ics]: true })
  expect(loadTreeOpen('inv-b')).toEqual({})
  // localStorage.getItem throws → {}; stored 'not json' → {}; setItem throws → no throw
})
```

`test/history-nav.test.ts`:

```ts
const A = { sourceId: 's', inventoryId: 'a' }, B = { sourceId: 's', inventoryId: 'b' }, C = { sourceId: 's', inventoryId: 'c' }
it('reads back and forward from the router state', () => {
  expect(navAvailability({ back: '/folder/1', forward: null })).toEqual({ canBack: true, canForward: false })
  expect(navAvailability({ back: null, forward: '/x' })).toEqual({ canBack: false, canForward: true })
  expect(navAvailability(null)).toEqual({ canBack: false, canForward: false })
})
it('reads the inventory stamped on an entry', () => {
  expect(entryInventory({ back: null, [INVENTORY_KEY]: A })).toEqual(A)
  expect(entryInventory({ [INVENTORY_KEY]: 'junk' })).toBeNull()
  expect(entryInventory(undefined)).toBeNull()
})
it('decides what to do after landing on an entry', () => {
  expect(entrySync(null, A, [A, B])).toEqual({ kind: 'stamp' })
  expect(entrySync(A, A, [A, B])).toEqual({ kind: 'none' })
  expect(entrySync(B, A, [A, B])).toEqual({ kind: 'switch', ref: B })
  expect(entrySync(C, A, [A, B])).toEqual({ kind: 'root' })
  expect(entrySync(B, null, [B])).toEqual({ kind: 'switch', ref: B })
})
```

`test/views.test.ts`: `folderTree` отдаёт `itemCount` (`ICs` — 3), `inventoryItemCount(snap)` — 4, `collapseCrumbs` работает и со строками.

- [ ] **Step 2: Run, verify fail:** `pnpm test --project @graymatter/app` — FAIL, модулей нет.
- [ ] **Step 3: Implement `shell.ts`, `tree-state.ts`, `history-nav.ts` и правки `views.ts`.** `treeRows` строится поверх `folderTree`. `TreeOpen` хранит только открытые папки.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Токены** в `main.css` со светлым и тёмным значением и строкой в `@theme inline`:
  - `--hover`: `#F1F1F4` / `#1F1F23` → `bg-hover`;
  - `--rail`: `#EFEFF2` / `#131316` → `bg-rail`;
  - `--tree-line`: `#DCDCE2` / `#2E2E33` → `border-tree-line`.
- [ ] **Step 6: Layout `default.vue`.**
  - Ниже 1024 px — одна колонка.
  - От 1024 px — сетка во всю высоту окна (`lg:h-dvh`):
    - `212px` — `AppNav variant="rail"` на `bg-rail`;
    - `264px` — `TreePanel`, только при `showsTree(route.name)`, белая с рамкой справа;
    - остальное — основная колонка с `lg:overflow-y-auto`.
  - На телефоне прокручивается страница, на компьютере — каждая колонка.
  - Layout монтирует `NavDrawer`.
  - `bare.vue` — только `<slot />` на фоне.
- [ ] **Step 7: `AppNav`** (проп `variant: 'rail' | 'drawer'`), сверху вниз:
  - логотип и «GrayMatter» ссылкой на `/`;
  - `InventorySwitcher`;
  - разделы из `NAV_SECTIONS` (Items — иконка `Boxes`);
  - внизу ссылка «Settings» (`SlidersHorizontal`).

  Активный раздел — `bg-surface text-primary`, остальные — `text-icon hover:bg-hover`. Строки `min-h-11` и `gap-0.5`.
- [ ] **Step 8: `InventorySwitcher`.**
  - **Кнопка.** Карточка `bg-surface border rounded-field`: мелкая подпись «Inventory», ниже имя жирным, справа `ChevronsUpDown`. Пока снимок не загружен, имя берётся из `state.inventories` по `state.current`.
  - **Меню** — как сейчас: от 768 px выпадающее, ниже — шторка.
  - **`choose()`** сначала вызывает `workspace.selectInventory(ref)` без `await` (текущий инвентарь меняется сразу), потом `router.push({ path: '/', force: true })`, потом ждёт выбор. `force` создаёт новую запись истории, даже если мы уже на `/`.
- [ ] **Step 9: Дерево.**
  - **`FolderTree`** (проп `variant: 'panel' | 'drawer'`) — `nav` с `aria-label`.
    - **Корень.** Иконка `Boxes`, имя инвентаря, `inventoryItemCount`, ссылка на `/`.
    - **Ниже** — `FolderTreeNode` по `treeRows`, рекурсивно. Вложенный `ul` с отступом и `border-l border-tree-line`: линия идёт от стрелки родителя вдоль всех детей.
  - **Строка:**
    - кнопка-стрелка `ChevronRight` с `aria-expanded` и `aria-label` «Expand {name}» / «Collapse {name}», поворот на 90° при раскрытии `motion-safe:transition-transform`; без детей — пустое место того же размера;
    - иконка `Folder`;
    - имя ссылкой на `/folder/{id}` с обрезкой;
    - число `text-subtle-foreground tabular-nums`.

    Текущая строка — `bg-accent-soft text-accent-soft-foreground`, число того же цвета. Наведение — `hover:bg-hover`. Высота строки 32 px в панели и `min-h-11` в выдвижном меню. Между строками `gap-0.5`.
  - **Состояние раскрытия.** `loadTreeOpen` при смене инвентаря. На каждом переходе `openPath` до `treeCurrent`, для карточки — до папки предмета. `saveTreeOpen` после изменения.
- [ ] **Step 10: `TreePanel`** — подпись «Folders» и `FolderTree variant="panel"` с прокруткой внутри панели. Кнопки поиска и «New folder» добавят Tasks 6 и 5.
- [ ] **Step 11: `NavDrawer`.**
  - Reka `Dialog` слева, ширина 86% до 340 px, `bg-rail`, выезд `motion-safe:` за 200 мс. Открытие — `useShell().drawerOpen`.
  - Внутри `AppNav variant="drawer"`, а между разделами и Settings — `FolderTree variant="drawer"` в белой карточке с прокруткой.
  - Закрывается при смене `route.fullPath`.
- [ ] **Step 12: `ScreenHeader`, `NavArrows`, `ScreenBody`.**
  - **Шапка** закреплена: `sticky top-0 z-20 bg-background border-b border-border`. Внутри ширина как у тела: `max-w-[720px] lg:max-w-[760px] mx-auto px-4 lg:px-7`.
  - **От 1024 px:**
    - строка 1 — `NavArrows`, путь `crumbs` ссылками через `ChevronRight`, затем `current` обычным текстом, справа индикатор сохранения (`Loader2` и `status.saving` в `sr-only`, как в старом `FolderHeader`);
    - строка 2 — `h1` (24 px, жирный, −0.02em) и `subtitle` мелко слева, слот `actions` (`compact: false`) справа.
  - **Ниже 1024 px:**
    - строка 1 — кнопка ☰ (`Menu`, `aria-label` «Menu», открывает `drawerOpen`), `NavArrows`, распорка, индикатор сохранения, слот `actions` (`compact: true`);
    - ниже — путь мелко (`collapseCrumbs`, «…» с `aria-hidden`, ссылки высотой от 44 px) без `current`, затем `h1`.
  - **Под шапкой** `AppStatus`, всегда видна вместе с ней.
  - **Слот** рендерится один раз, в месте по `useMediaQuery('(min-width: 1024px)')`.
  - **`NavArrows`** — кнопки `ChevronLeft`/`ChevronRight` 44 px, `aria-label` «Back» / «Forward», `disabled` при `!canBack` / `!canForward` (`opacity-35`).
  - **`useNavHistory`** читает `navAvailability(window.history.state)` при монтировании и в `router.afterEach`.
  - **`ScreenBody`** — колонка содержимого: та же ширина, `grid content-start gap-3.5 pt-3.5 pb-28 lg:pb-8`. Нижний отступ на телефоне оставляет место нижней панели из Task 6.
- [ ] **Step 13: Синхронизация инвентаря с историей** — `plugins/history-sync.client.ts`.
  - **Когда.** `router.afterEach` без ошибки навигации, после `useWorkspaceReady()`.
  - **Что.** `entrySync(entryInventory(history.state), state.current, state.inventories.map((e) => e.ref))`:
    - `stamp` при непустом `current` — `history.replaceState({ ...history.state, [INVENTORY_KEY]: current }, '')`;
    - `switch` — `workspace.selectInventory(ref)`, ошибки через `toast.error(t(errorMessageKey(e)))`;
    - `root` — `router.replace('/')`.

  Vue Router сохраняет чужие ключи в `history.state` при своих `replaceState`, поэтому пометка не теряется.
- [ ] **Step 14: Экраны.**
  - **`FolderScreen`:**
    - `ScreenHeader` с `title` — имя папки, в корне имя инвентаря, а пока снимка нет — `app.name`;
    - `subtitle` — «{n} folders · {m} items» (`folder.summary` из двух множественных ключей), прямые подпапки и предметы;
    - `crumbs` — корень (`/`) и предки без текущей папки, `current` — имя папки;
    - в слоте `actions` пока `FolderMenu`.

    Тело в `ScreenBody`: поле поиска, результаты, списки и пустые состояния — как сейчас.
  - **Настройки** — `ScreenHeader` с заголовком «Settings» (и именем источника на его странице), без пути. Старый заголовок и ссылка на настройки из старого `default.vue` убираются.
- [ ] **Step 15: Verify.**
  - `pnpm test`, `pnpm typecheck`, `pnpm lint` — зелёные.
  - На демо-данных:
    - переключить инвентарь, нажать «назад» — открылась прежняя папка прежнего инвентаря, «вперёд» вернул новый;
    - раскрыть ветку дерева, перезагрузить — осталась раскрытой;
    - открыть глубокую папку по ссылке — путь в дереве раскрылся;
    - длинная папка обрезается в дереве и в шапке.
  - Снимки на 360 px (светлая тема, с открытым выдвижным меню) и 1280 px (тёмная), без горизонтальной прокрутки.
- [ ] **Step 16: Commit:** `feat(app): app shell — left panel, folder tree with guides, screen header with back and forward`

---

### Task 3: Экран «Архив»

**Files:**
- Create: `packages/app/app/lib/archive.ts`, `packages/app/test/archive.test.ts`
- Create: `packages/app/app/lib/format.ts`, `packages/app/test/format.test.ts`
- Create: `packages/app/app/pages/archive.vue`, `packages/app/app/components/ArchiveList.vue`
- Modify:
  - `packages/app/app/lib/shell.ts`: раздел `archive` в `NAV_SECTIONS`; `packages/app/app/components/AppNav.vue`: его иконка;
  - `packages/app/app/components/FolderScreen.vue`: ссылка на архив в пустом состоянии без инвентарей;
  - `packages/app/app/lib/dev/demo-source.ts`: опция `extras` и демо-архив;
  - `packages/app/test/views.test.ts`, `packages/app/test/demo-source.test.ts`: `extras: false`;
  - `packages/app/i18n/locales/en.json`.

**Interfaces:**
- Consumes: `state.archivedInventories`, `workspace.applyTo` (Task 1).
- Produces:

```ts
// format.ts — locale 'en'
export function formatMoney(minor: number, currency: string): string        // narrowSymbol, the currency's decimals
export function formatUnitPrice(minorPerUnit: number, currency: string): string // ≥ 1 major unit: currency decimals; below: 3 significant digits
export function formatDate(iso: string): string                              // dateStyle 'medium'
export function formatDateTime(iso: string): string                          // dateStyle 'medium', timeStyle 'short'

// dev/demo-source.ts
/** extras (default true): archived records (this task) and tags and attributes (Task 11) on top of the base data. */
export function createDemoDriver(options?: { memory?: boolean; extras?: boolean }): SourceDriver
export function seedDemo(storage: InventoryStorage, actor: Actor, options?: { extras?: boolean }): Promise<void>

// archive.ts
export interface ArchiveEntry {
  archiveId: Id
  target: 'folder' | 'item' | 'variant'
  id: Id
  name: string
  /** For a variant: its item's name; otherwise null. */
  itemName: string | null
  /** Folder names from the root to the containing folder, archived folders included; '' at the root. */
  path: string
  archivedAt: string
  /** Folder entries: folders and items archived together with it (same archiveId), the folder itself excluded. */
  folderCount: number
  itemCount: number
}
/** One entry per archive operation in the current inventory, newest first. */
export function archiveEntries(s: InventorySnapshot): ArchiveEntry[]
```

Запись — это корень операции архивации:
- папка с `archiveId`, у которой нет родителя или у родителя другой `archiveId`;
- предмет с `archiveId`, у папки которого другой `archiveId` (или нет папки);
- любой архивный вариант.

Записи с одним `archiveId` внутри корня входят в счётчики папки, отдельных строк у них нет.

- [ ] **Step 1: Write the failing tests.**

`test/format.test.ts`:

```ts
expect(formatMoney(230, 'USD')).toBe('$2.30')
expect(formatMoney(1500, 'JPY')).toBe('¥1,500')
expect(formatUnitPrice(230 / 37, 'USD')).toBe('$0.0622')
expect(formatUnitPrice(0.456, 'USD')).toBe('$0.00456')
expect(formatUnitPrice(1250, 'USD')).toBe('$12.50')
expect(formatDate('2026-11-10T12:00:00Z')).toBe('Nov 10, 2026')
```

`test/archive.test.ts` (базовые демо-данные плюс команды `archive`):

```ts
it('lists a folder archive once and counts what went with it', () => {
  // archive 'Passive components' (has subfolder 'Resistors' with the resistor item)
  expect(entries.map((e) => [e.target, e.name, e.folderCount, e.itemCount])).toEqual([['folder', 'Passive components', 1, 1]])
})
it('keeps an item archived earlier as its own entry inside a later folder archive', () => {
  // archive item 'TL072' alone, then folder 'ICs' (contains Op-amps/TL072)
  expect(entries.map((e) => [e.target, e.name])).toEqual([['folder', 'ICs'], ['item', 'TL072']])
  expect(entries[0]!.itemCount).toBe(2) // LM13700 and NE555; TL072 has its own archiveId
})
it('lists an archived variant with its item name', () => {
  expect(entries[0]).toMatchObject({ target: 'variant', name: '100k', itemName: 'Резистор 0,25 Вт' })
})
it('shows the path through archived folders', () => {
  // archive the resistor alone, then 'Passive components'
  expect(entries.find((e) => e.target === 'item')!.path).toBe('Passive components / Resistors')
})
it('puts the newest archive first and forgets restored ones', () => {
  // archive A then B → [B, A]; restore B → [A]
})
```

- [ ] **Step 2: Run, verify fail:** `pnpm test --project @graymatter/app` — FAIL, модулей нет.
- [ ] **Step 3: Implement `format.ts` (`Intl.NumberFormat('en', { style: 'currency', currencyDisplay: 'narrowSymbol' })`; ниже одной основной единицы — `maximumSignificantDigits: 3`) и `archiveEntries`.** Путь строится по всем папкам снимка, включая архивные. Сортировка по `archivedAt` по убыванию, при равенстве — по `id`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Экран `/archive`** (layout `default`, панели дерева нет):
  - **Заголовок и обзор.** `ScreenHeader` с заголовком «Archive», без пути и действий. Тело в `ScreenBody`. Секция «Inventories» — архивные инвентари всех источников. Имя источника в подписи показывается, только если источников больше одного. Секция с именем текущего инвентаря — `ArchiveList` по `archiveEntries(state.snapshot)`. Пока снимка нет, вместо неё скелет. Если пусто везде — `EmptyState` «Nothing in the archive».
  - **Строка записи.** Иконка по типу: `Folder`, `Package`, `Layers`, `Boxes` для инвентаря. Имя: для варианта «Item · Variant». Подпись: путь (корень — имя инвентаря) · «with N items» для папок · «Archived Nov 10, 2026» (`formatDate`).
  - **Действия.** Кнопка «Restore» (outline, h-11) и иконка-кнопка `Trash2` с `aria-label` «Delete permanently».
    - Restore: `workspace.applyTo(ref, { type: 'restore', archiveId })`, затем toast «“{name}” restored».
    - Delete: `ConfirmSheet` с `destructive`, текст по типу, затем `applyTo(ref, { type: 'deletePermanently', target, id })`.
  - **Тексты подтверждения:**
    - folder: «“{name}” and everything archived inside it will be deleted for good, with their history. This can't be undone.»
    - item: «“{name}”, its variants and history will be deleted for good. This can't be undone.»
    - variant: «Variant “{name}” and its history will be deleted for good. This can't be undone.»
    - inventory: «Inventory “{name}” and everything in it will be deleted for good. This can't be undone.»
  - **Когда кнопки выключены.** Для записей текущего инвентаря — при `state.readOnly`. Для архивных инвентарей — если статус их источника не `ready`. У строки, по которой идёт запись, — пока запись не закончится. Ошибки показываются через `toast.error(t(errorMessageKey(e)))`.
- [ ] **Step 6: Точки входа.**
  - Раздел «Archive» в левой панели и выдвижном меню: `NAV_SECTIONS` получает `{ key: 'archive', to: '/archive' }` после `items`, иконка `Archive`. Тест в `test/shell.test.ts`: `NAV_SECTIONS.map((s) => s.key)` — `['items', 'archive']`.
  - `FolderScreen`: в пустом состоянии без инвентарей, если `state.archivedInventories.length > 0`, под кнопкой создания ссылка «Open archive».
- [ ] **Step 7: Демо-архив** в `seedDemo` при `extras`, после базовых данных:
  - папка `Old projects` в корне с предметом `LM741`, архивируется целиком;
  - отдельно заархивированный предмет `CD4017` в `ICs`;
  - архивный вариант `100k` у резистора;
  - инвентарь `Archive test`, архивируется.

  Существующие тесты переходят на `extras: false` и не меняют ожиданий.
- [ ] **Step 8: Verify.**
  - `pnpm test`, `pnpm typecheck`, `pnpm lint` — зелёные.
  - На демо-данных восстановить и удалить запись каждого типа.
  - Снимки экрана `/archive` на 360 px (светлая тема) и 1280 px (тёмная).
- [ ] **Step 9: Commit:** `feat(app): archive screen with restore and permanent deletion`

---

### Task 4: Карточка предмета — просмотр и журнал

**Files:**
- Create:
  - `packages/app/app/lib/item-view.ts`, `packages/app/test/item-view.test.ts`;
  - `packages/app/app/pages/item/[id].vue`;
  - `packages/app/app/components/ItemScreen.vue`, `StockCard.vue`, `BucketList.vue`, `JournalList.vue`, `ItemAttributes.vue`.
- Modify:
  - `ItemList.vue`, `SearchResults.vue`: строки становятся ссылками;
  - `test/views.test.ts`: тест согласия с `itemStock` сравнивает количества;
  - `en.json`.

**Interfaces:**
- Consumes: `workspace.loadMovements` (Task 1), `format.ts` (Task 3), `Crumb` из `views.ts`.
- Produces:

```ts
export interface BucketRow {
  variantId: Id | null
  /** null for the stock kept without a variant. */
  name: string | null
  description: string | null
  quantity: Quantity
  number: string
  unit: string
  outOfStock: boolean
  avgUnitPrice: number | null
  lastUnitPrice: number | null
  /** Per-variant attribute values (only attributes marked per-variant), by attribute name. */
  values: { attributeId: Id; name: string; value: string | null }[]
}
export interface AttributeRow {
  attributeId: Id
  name: string
  kind: 'text' | 'enum'
  options: string[]
  value: string | null
  /** The item's value is empty and the item has active variants: values live on the variants. */
  perVariant: boolean
}
export interface ItemView {
  item: Item
  crumbs: Crumb[]
  unit: UnitDef
  currency: string
  tags: { id: Id; name: string }[]
  total: { quantity: Quantity; number: string; unit: string; outOfStock: boolean; avgUnitPrice: number | null; lastUnitPrice: number | null }
  /** The no-variant bucket first when shown, then active variants by position. */
  buckets: BucketRow[]
  hasVariants: boolean
  attributes: AttributeRow[]
}
/** null when the item is missing, archived, or its folder chain is archived or missing. */
export function itemView(s: InventorySnapshot, itemId: Id): ItemView | null

export interface JournalRow {
  /** Movement id; for a transfer, its transferId. */
  id: Id
  kind: MovementKind
  at: string
  by: string
  /** '+37', '−5' (U+2212); transfers show the moved amount without a sign. */
  number: string
  unit: string
  /** Variant name; null = no variant. Unused for transfers. */
  variantName: string | null
  transfer: { from: string | null; to: string | null } | null
  totalPrice: number | null
  sourceUrl: string | null
  note: string | null
}
/** `movements` newest first (as loadMovements returns them); the two halves of a transfer become one row. */
export function journalRows(s: InventorySnapshot, itemId: Id, movements: Movement[]): JournalRow[]
```

Правила `itemView`:
- `total` совпадает с `itemStock` из `core`: все корзины, кроме архивных вариантов.
- Корзина «без варианта» показывается всегда, если у предмета нет активных вариантов, а при вариантах — только если её количество не 0.
- `crumbs` — путь папки предмета, как в `folderView`.

- [ ] **Step 1: Write the failing tests** (`test/item-view.test.ts`):

```ts
it('returns null for a missing or archived item, or one under an archived folder', () => {
  expect(itemView(s, newId())).toBeNull()
  // archive TL072 → null; archive 'Passive components' → the resistor is null
})
it('totals match core itemStock for every item, archived variants excluded', () => {
  // snapshot: resistor 10k has 100 pcs; receive 7 into 100k, then archive variant 100k
  for (const item of s.items.filter((i) => i.archivedAt === null)) {
    const v = itemView(s, item.id)!
    const core = itemStock(s, item.id)
    expect([v.total.quantity, v.total.avgUnitPrice, v.total.lastUnitPrice]).toEqual([core.quantity, core.avgUnitPrice, core.lastUnitPrice])
  }
})
it('shows the no-variant stock only without variants or when it is not zero', () => {
  expect(itemView(s, tl072)!.buckets.map((b) => b.name)).toEqual([null])
  expect(itemView(s, resistor)!.buckets.map((b) => b.name)).toEqual(['1k', '10k', '100k'])
  // stock.receive 3 without a variant on the resistor → [null, '1k', '10k', '100k']; archive '100k' → [null, '1k', '10k']
})
it('marks an attribute per-variant when the item value is empty and the item has variants', () => {
  // attribute 'Resistance' (text): item.setAttribute value null + variant.setAttribute '10 kΩ' on 10k
  expect(itemView(s, resistor)!.attributes).toMatchObject([{ name: 'Resistance', perVariant: true, value: null }])
  expect(itemView(s, resistor)!.buckets.find((b) => b.name === '10k')!.values).toEqual([{ attributeId: expect.any(String), name: 'Resistance', value: '10 kΩ' }])
})
it('resolves tag names in name order', () => { /* tags 'smd', 'audio' on TL072 → ['audio', 'smd'] */ })
it('signs journal quantities and keeps newest first', () => {
  expect(journalRows(s, ne555, movements).map((r) => [r.kind, r.number])).toEqual([['usage', '−5'], ['receipt', '+5']])
})
it('joins the two halves of a transfer into one row', () => {
  // resistor: receive 3 without a variant, transfer 3 to '1k'
  expect(rows[0]).toMatchObject({ kind: 'transfer', number: '3', transfer: { from: null, to: '1k' } })
  expect(rows.filter((r) => r.kind === 'transfer')).toHaveLength(1)
})
it('formats journal amounts with the item unit and its prefixes', () => {
  // item in 'm' with a receipt of 0.5 → { number: '+50', unit: 'cm' }
})
```

`test/views.test.ts` — существующий тест согласия с `itemStock` дополняется. Он сравнивает `number`/`unit` строки с `formatAmountParts(itemStock(...).quantity, unit)` на снимке, где есть архивный вариант с остатком.

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `item-view.ts`.** Индексы снимка общие с `views.ts`: экспортировать оттуда `indexOf` как `snapshotIndex` и тип `Index` с пометкой `/** @internal */`, второй индекс не строить. Числа — через `formatAmountParts`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Экран `/item/[id]`** (layout `default` с панелью дерева, страница передаёт `id` в `ItemScreen`). Дерево уже выделяет папку предмета (`treeCurrent` из Task 2). Сверху вниз:
  1. **Шапка.** `ScreenHeader`:
     - `title` — имя предмета, длинное переносится;
     - `crumbs` — корень инвентаря и все папки предмета ссылками, `current` нет;
     - слот `actions` пуст до Task 8 (`ItemActions`).

     Остальное — в `ScreenBody`.
  2. **Описание и теги.** Описание — `text-muted-foreground`. Теги — чипы `bg-chip rounded-full text-[13px]`.
  3. **`StockCard`** (поверхность, рамка, `rounded-card`, `p-4`):
     - итог: число 32 px жирное `tabular-nums` и единица мелко;
     - при нуле — пометка «Out of stock» приглушённым;
     - строка цен: «avg $0.023 / pcs · last $0.025 / pcs» через `formatUnitPrice`; если цен нет, строки нет.
  4. **`BucketList`**, если `hasVariants`. Строки 62 px: имя («No variant» для `null`), под ним значения атрибутов через « · », справа количество. Строка варианта из `?variant=<id>` получает `bg-accent-soft`, и экран прокручивается к ней.
  5. **`ItemAttributes`.** Строки «Name — value». Для `perVariant` вместо значения «Differs by variant». Секции нет, если атрибутов нет (кнопки появятся в Task 11).
  6. **`JournalList`** — заголовок `h2` «History».
     - **Загрузка.** `workspace.loadMovements(id)` при открытии и при каждой смене объекта `state.snapshot`. Устаревшие ответы отбрасываются по счётчику.
     - **Состояния.** Скелет из трёх строк. Ошибка `unavailable` — «History needs a connection to the source» с кнопкой Retry. Другие ошибки — текст `errorMessageKey` и Retry. Пусто — «No movements yet».
     - **Строка журнала:**
       - заголовок по виду: Received, Used, Returned, Adjusted, Moved; перенос — «Moved from {from} to {to}», `null` → «No variant»;
       - справа количество с единицей;
       - вторая строка: вариант, сумма партии `formatMoney`, ссылка «Where bought» (новая вкладка), заметка;
       - третья строка мелко: `formatDateTime(at) · by`.
  7. **Предмета нет** (`itemView` вернул `null`): `EmptyState` «This item is no longer here» и ссылка «Back to {inventory}» на `/`.
- [ ] **Step 6: Ссылки на карточку.**
  - `ItemList`: вся строка — `NuxtLink` на `/item/{id}` с видимым фокусом (`focus-visible:ring-2 ring-ring`).
  - `SearchResults`: ссылка на `/item/{itemId}`, а при варианте — с `?variant={variantId}`. В Task 6 его заменит палитра с теми же ссылками.
- [ ] **Step 7: Verify.**
  - Тесты, типы, линтер — зелёные.
  - На демо-данных:
    - карточка `TL072` (цена за штуку $0.0622);
    - карточка резистора (варианты);
    - `NE555` (Out of stock, журнал из двух строк).
  - Режим без сети в DevTools: журнал показывает сообщение и Retry.
  - Снимки на 360 и 1280 px.
- [ ] **Step 8: Commit:** `feat(app): item card with stock, prices, variants, attributes and history`

---

### Task 5: Действия на виду, меню строк, долгое нажатие, hover и анимации

Дизайн: разделы 4, 6.3–6.7, 9 и 10 из `2026-11-10-graymatter-shell-design.md`.

**Files:**
- Create:
  - `app/composables/useDialogs.ts`, `app/composables/useLongPress.ts`, `app/composables/useCloseWatcher.ts`;
  - `test/long-press.test.ts`, `test/close-watcher.test.ts`;
  - `app/components/FolderDialogs.vue`, `FolderActions.vue`, `RowMenu.vue`;
  - `app/components/ui/tooltip/*` (shadcn-vue).
- Modify:
  - `app/layouts/default.vue` — `FolderDialogs` и `TooltipProvider`;
  - `FolderScreen.vue`, `FolderList.vue`, `FolderTreeNode.vue`, `TreePanel.vue`;
  - `AppSheet.vue`, `NavDrawer.vue`, `InventorySwitcher.vue` — жест «назад»;
  - `ItemList.vue`, `AppNav.vue`, `ScreenHeader.vue`, `settings/index.vue` — проход по hover и фокусу;
  - `app/assets/css/main.css`;
  - `en.json`.
- Delete: `app/components/FolderMenu.vue`.

**Interfaces:**

```ts
// useDialogs.ts — useState: one dialog of each kind for the whole app, rendered once in the layout
export type FolderDialog = { kind: 'create'; parentId: Id | null } | { kind: 'rename' | 'move' | 'archive'; folderId: Id }
export function useFolderDialog(): { dialog: Ref<FolderDialog | null>; open(d: FolderDialog): void; close(): void }
// Task 7 adds useQuickAdd, Task 8 adds useItemDialog in the same file

// useLongPress.ts — imports from 'vue' explicitly
export interface LongPressHandlers {
  onPointerdown(e: Pick<PointerEvent, 'pointerType' | 'clientX' | 'clientY'>): void
  onPointermove(e: Pick<PointerEvent, 'clientX' | 'clientY'>): void
  onPointerup(): void
  onPointercancel(): void
  /** Blocks the browser menu while a touch press is held or has just fired. */
  onContextmenu(e: Pick<Event, 'preventDefault'>): void
  /** Swallows the one click that follows a fired long press, so the row link does not open. */
  onClickCapture(e: Pick<Event, 'preventDefault' | 'stopPropagation'>): void
}
/** Touch only. Fires after `delay` (500 ms) unless the finger moves more than `tolerance` (10 px), lifts or the press is cancelled. */
export function useLongPress(onLongPress: () => void, options?: { delay?: number; tolerance?: number }): LongPressHandlers

// useCloseWatcher.ts — imports from 'vue' explicitly
/** While `open` is true, the Android back gesture and Esc set it to false through window.CloseWatcher where the browser has it.
 *  No history entries. Without CloseWatcher it does nothing. */
export function useCloseWatcher(open: Ref<boolean>): void
```

```vue
<!-- RowMenu.vue -->
props: { label: string; actions: { key: string; label: string; icon: Component; destructive?: boolean; disabled?: boolean }[] }
emits: select(key: string)
expose: openSheet()   <!-- for a long press: a sheet titled with `label` listing the same actions -->
<!-- FolderActions.vue -->
props: { folderId: Id | null; compact: boolean }
```

- [ ] **Step 1: Write the failing tests** (`vi.useFakeTimers()`, события — простые объекты):

`test/long-press.test.ts`:

```ts
it('fires after 500 ms of a touch press', () => {
  h.onPointerdown(touch(10, 10)); vi.advanceTimersByTime(499); expect(fired).toBe(0)
  vi.advanceTimersByTime(1); expect(fired).toBe(1)
})
it('ignores mouse and pen', () => { h.onPointerdown({ pointerType: 'mouse', clientX: 0, clientY: 0 }); vi.advanceTimersByTime(600); expect(fired).toBe(0) })
it('scrolling cancels the press, a small wobble does not', () => {
  h.onPointerdown(touch(10, 10)); h.onPointermove({ clientX: 10, clientY: 21 }); vi.advanceTimersByTime(600); expect(fired).toBe(0)
  h.onPointerdown(touch(10, 10)); h.onPointermove({ clientX: 14, clientY: 16 }); vi.advanceTimersByTime(600); expect(fired).toBe(1)
})
it('lifting or a cancel before 500 ms cancels', () => { /* onPointerup at 300 ms → 0; onPointercancel at 300 ms → 0 */ })
it('swallows only the click right after a fired press', () => {
  // fired → onClickCapture(e1): preventDefault and stopPropagation called; onClickCapture(e2): not called
  // a short tap: onClickCapture not swallowed
})
it('blocks the context menu during a touch press', () => { /* onContextmenu during the press → preventDefault called */ })
```

`test/close-watcher.test.ts` (глобальный класс-заглушка `CloseWatcher` с `onclose` и `destroy`, внутри `effectScope`):

```ts
it('creates a watcher when opened and closes on the back gesture', async () => {
  open.value = true; await nextTick(); expect(created).toBe(1)
  watchers[0]!.onclose!(); expect(open.value).toBe(false)
})
it('destroys the watcher when closed from the UI and on scope dispose', async () => { /* open → close via open.value = false → destroy called; scope.stop() while open → destroy called */ })
it('does nothing without CloseWatcher', async () => { /* delete globalThis.CloseWatcher; open → no throw */ })
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `useLongPress`, `useCloseWatcher`, `useDialogs`.**
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Общие диалоги папки.**
  - `FolderDialogs` смонтирован в layout и рисует по `useFolderDialog().dialog`: `FolderForm` (создание и переименование), `MoveFolderSheet`, `ConfirmSheet` архивации. Тексты — из старого `FolderMenu`.
  - После архивации, если открыт экран этой папки, её потомка или предмета внутри неё, переход к родителю: `/` или `/folder/{parentId}`. Переход — после блока `try`, не внутри него. Ошибки — `toast.error`.
  - `FolderMenu.vue` удаляется.
- [ ] **Step 6: `FolderActions`** в слоте `actions` шапки `FolderScreen`. Без снимка кнопок нет.
  - **Не `compact`:**
    - «New folder» — кнопка `outline` с `FolderPlus` и подписью;
    - «Rename», «Move», «Archive» — кнопки-значки `outline` 36 px (`Pencil`, `FolderInput`, `Archive`), у каждой `Tooltip` и `aria-label`.
  - **`compact`:** те же четыре — прозрачные кнопки-значки 44 px, у каждой `aria-label`.
  - **В корне** (`folderId === null`) только «New folder».
  - Кнопки открывают `useFolderDialog().open(...)` и выключены при `state.readOnly` или `state.saving`. Цвета нейтральные.
- [ ] **Step 7: `RowMenu` и строки.**
  - **`RowMenu`.** Кнопка `Ellipsis` с `aria-label` «More actions for {label}», `DropdownMenu`, в меню пункты с `gap-0.5`. `openSheet()` открывает `AppSheet` с заголовком `label` и теми же пунктами строками 44 px. Опасный пункт — `text-destructive`.
  - **Утилита `.row-action` в `main.css`** для «⋯» и «+» в строках:
    - при `(hover: hover)` — `opacity: 0`, видна при наведении на строку (`.group:hover`), фокусе внутри (`.group:focus-within`) и открытом меню (`[data-state=open]`), переход прозрачности 150 мс;
    - при `(hover: none)` и ширине до 1023.98 px — `display: none` (там долгое нажатие);
    - при `(hover: none)` от 1024 px — видна всегда.
  - **`FolderList`.**
    - Строка — `group`, ссылка с `useLongPress` (открывает `openSheet()` её `RowMenu`).
    - Справа от числа `RowMenu` с «Rename», «Move», «Archive». Место под «⋯» зарезервировано, число не прыгает.
    - Наведение — `hover:bg-hover` на строке, карточка списка не двигается.
  - **`FolderTreeNode`.**
    - Между именем и числом две `.row-action`: «+» (`Plus`, `aria-label` «New folder in {name}», открывает создание с `parentId`) и `RowMenu` с «New folder», «Rename», «Move», «Archive».
    - Число остаётся видно и не меняет цвет.
    - Долгое нажатие на строку в выдвижном меню открывает тот же `RowMenu`.
    - Строки с долгим нажатием получают `select-none` и `[-webkit-touch-callout:none]`.
  - **`TreePanel`.** Справа от подписи «Folders» кнопка-значок «New folder» (корень инвентаря) с `Tooltip`.
- [ ] **Step 8: Жест «назад» и Esc.** `useCloseWatcher` подключается к `AppSheet` (её `open`), `NavDrawer` (`drawerOpen`), выпадающим меню `RowMenu` и `InventorySwitcher` (их `v-model:open`). Палитра — в Task 6.
- [ ] **Step 9: Hover, переходы, фокус — проход по всем компонентам каркаса и списков.**
  - Строки дерева, папок и предметов, разделы `AppNav`, ссылки пути, кнопки-значки, строки источников в настройках: `hover:bg-hover transition-colors duration-150`.
  - Главная кнопка при наведении темнеет и получает мягкую тень `hover:shadow-[0_4px_12px_rgb(79_70_229/0.28)]`.
  - Фокус — `focus-visible:ring-2 focus-visible:ring-ring` на самих ссылках и кнопках строк, никогда на `ul` или карточке.
  - Выезды шторок и выдвижного меню и поворот стрелки — под `motion-safe:`, при `motion-reduce:` без движения (`motion-reduce:animate-none` у слоёв).
- [ ] **Step 10: Verify.**
  - Тесты, типы, линтер — зелёные.
  - На демо-данных, 1280 px:
    - создать, переименовать, перенести и заархивировать папку кнопками шапки, из «⋯» строки списка и из «⋯» и «+» в дереве;
    - архивация открытой папки уводит к родителю;
    - при наведении поднимается только строка, число видно.
  - DevTools, 360 px с эмуляцией касания:
    - долгое нажатие на папку открывает шторку действий;
    - прокрутка списка пальцем меню не открывает;
    - короткое нажатие открывает папку.
  - DevTools с `prefers-reduced-motion: reduce`: меню и шторки появляются без выезда.
  - Контроллер проверяет долгое нажатие и жест «назад» на телефоне владельца через `adb`, если телефон подключён.
- [ ] **Step 11: Commit:** `feat(app): folder actions in the header, row menus, long press, hover and motion`

---

### Task 6: Палитра поиска, нижняя панель и свайпы меню на телефоне

Дизайн: раздел 7 и 6.2 (нижняя панель, свайпы меню) из `2026-11-10-graymatter-shell-design.md`. Палитра заменяет поле поиска над списком и показ результатов через `?q=`.

**Files:**
- Create:
  - `app/lib/palette.ts`, `test/palette.test.ts`;
  - `app/lib/swipe.ts`, `test/swipe.test.ts`;
  - `app/components/SearchPalette.vue`, `MobileDock.vue`.
- Modify:
  - `app/composables/useShell.ts` — `paletteOpen`;
  - `app/layouts/default.vue` — палитра, нижняя панель, ⌘K / Ctrl+K, свайпы меню;
  - `TreePanel.vue` — кнопка «Search»;
  - `FolderScreen.vue` — без поля и результатов поиска;
  - `en.json`.
- Delete: `app/components/SearchField.vue`, `app/components/SearchResults.vue` и их ключи i18n, которые больше не нужны.

**Interfaces:**
- Consumes: `searchRows` и `createSearch` (как раньше в `FolderScreen`), `useFolderDialog` (Task 5), `NAV_SECTIONS` (Task 2), `useCloseWatcher` (Task 5).
- Produces:

```ts
// palette.ts
/** Core search's normalization: lowercase, letters and digits only. "TL-072" → "tl072". */
export function compactText(s: string): string
export interface TextPart { text: string; match: boolean }
/** Splits `text` around the first place where it contains `query`, both compared by compactText; characters dropped by
 *  compaction inside the match stay in the matched part ("TL-072" for "tl072"). One unmatched part when the query
 *  compacts to '' or does not occur. */
export function highlightParts(text: string, query: string): TextPart[]
export interface FolderHit { id: Id; name: string; path: string }   // path: parent folder names joined ' / ', '' at the root
/** Active folders (not under an archived one) whose compact name contains the compact query: exact first, then prefix,
 *  then the rest; ties by name. [] for a query that compacts to ''. */
export function matchFolders(s: InventorySnapshot, query: string, limit?: number): FolderHit[]   // limit 5
export type PaletteAction =
  | { kind: 'newFolder'; parentId: Id | null; parentName: string }
  | { kind: 'switchInventory'; ref: InventoryRef; name: string }
  | { kind: 'go'; section: 'archive' | 'dictionaries' | 'settings' }
  // Task 7 adds { kind: 'addItem'; name: string }
export interface PaletteContext {
  query: string
  /** The folder the screen shows (the item's folder on the item card); null outside the items section. */
  folder: { id: Id | null; name: string } | null
  inventories: InventoryEntry[]
  current: InventoryRef | null
  sections: ('archive' | 'dictionaries' | 'settings')[]
  canWrite: boolean
}
/** In this order: newFolder (with a folder and canWrite), switchInventory for each other inventory, go for each section.
 *  With a non-empty query only actions whose label (from `labelOf`) contains it compactly. */
export function paletteActions(ctx: PaletteContext, labelOf: (a: PaletteAction) => string): PaletteAction[]

// useShell.ts
export function useShell(): { drawerOpen: Ref<boolean>; paletteOpen: Ref<boolean> }

// swipe.ts
export const SWIPE = { minDistance: 60, dominance: 1.5, edgeGuard: 24 } as const
/** A finished touch swipe → what to do with the phone menu. 'open': rightward from x ≥ edgeGuard while closed;
 *  'close': leftward while open; null otherwise (short, diagonal or vertical moves; rightward from the edge zone). */
export function swipeAction(start: { x: number; y: number }, end: { x: number; y: number }, drawerOpen: boolean): 'open' | 'close' | null
```

- [ ] **Step 1: Write the failing tests** (`test/palette.test.ts`):

```ts
it('compacts like core search', () => { expect(compactText(' TL-072 ')).toBe('tl072') })
it('highlights the matched part of a name', () => {
  expect(highlightParts('Electrolytic capacitor', 'cap')).toEqual([
    { text: 'Electrolytic ', match: false }, { text: 'cap', match: true }, { text: 'acitor', match: false }])
  expect(highlightParts('TL-072 op-amp', 'tl072')).toEqual([{ text: 'TL-072', match: true }, { text: ' op-amp', match: false }])
  expect(highlightParts('NE555', 'tl072')).toEqual([{ text: 'NE555', match: false }])
  expect(highlightParts('NE555', ' - ')).toEqual([{ text: 'NE555', match: false }])
})
it('finds folders: exact, then prefix, then the rest', () => {
  // create folders 'Ceramic caps', 'Capacitors', 'Cap' under the root
  expect(matchFolders(s, 'cap').map((f) => f.name)).toEqual(['Cap', 'Capacitors', 'Ceramic caps'])
  expect(matchFolders(s, 'op-amp')).toEqual([{ id: opamps, name: 'Op-amps', path: 'ICs' }])
  expect(matchFolders(s, '')).toEqual([])
})
it('skips archived folders and folders under them', () => { /* archive 'ICs' → 'op' finds nothing */ })
it('offers actions for the query', () => {
  const label = (a: PaletteAction) => a.kind === 'newFolder' ? `New folder in ${a.parentName}` : a.kind === 'switchInventory' ? `Switch to ${a.name}` : a.section
  const ctx = { query: '', folder: { id: ics, name: 'ICs' }, inventories, current: electronics, sections: ['archive', 'settings'], canWrite: true }
  expect(paletteActions(ctx, label).map((a) => a.kind)).toEqual(['newFolder', 'switchInventory', 'go', 'go'])
  expect(paletteActions({ ...ctx, query: 'work' }, label)).toEqual([{ kind: 'switchInventory', ref: workshop, name: 'Workshop' }])
  expect(paletteActions({ ...ctx, canWrite: false }, label).map((a) => a.kind)).not.toContain('newFolder')
  expect(paletteActions({ ...ctx, folder: null }, label).map((a) => a.kind)).not.toContain('newFolder')
})
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `palette.ts`.**
  - **`highlightParts`** строит сжатую строку вместе с массивом исходных индексов её символов и ищет в ней сжатый запрос.
  - **Выделение** идёт от исходного индекса первого совпавшего символа до исходного индекса последнего включительно.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: `SearchPalette`** — свой компонент на Reka `DialogRoot`, без новых зависимостей. Открытие — `useShell().paletteOpen`, жест «назад» — `useCloseWatcher(paletteOpen)`. Палитра не трогает URL и историю.
  - **Поле.**
    - `aria-label` «Search {inventory}», фокус при открытии.
    - Запрос сбрасывается при закрытии.
    - Внутри справа × (`aria-label` «Clear»): очищает и возвращает фокус.
  - **Результаты** при каждом изменении запроса:
    - Items — `searchRows(s, createSearch(s).search(query, 20))`. Поиск строится один раз на объект снимка. В строке:
      - имя и вариант через `highlightParts` (`<mark class="bg-chip text-foreground rounded-sm">`, текст обычной интерполяцией, без `v-html`);
      - путь;
      - количество с единицей.
    - Folders — `matchFolders`.
    - Actions — `paletteActions` с `labelOf` из `t`:
      - `folder` — папка экрана (`treeCurrent` из Task 2, `root` → корень);
      - `sections` — ключи `NAV_SECTIONS` без `items`, затем `settings`;
      - `canWrite` — `!state.readOnly`.
  - **Список.**
    - Группы с подписью, строки с `gap-0.5`.
    - `role="listbox"`, у строк `role="option"` и `aria-selected`, у поля `aria-activedescendant` и `aria-controls`.
    - Выбрана первая строка в видимом порядке. ↑ и ↓ двигают выбор, Enter выполняет, наведение мышью выбирает.
    - Пусто — «Nothing found for “{q}”».
  - **Выполнение** закрывает палитру:
    - предмет → `/item/{id}` (с `?variant=`);
    - папка → `/folder/{id}`;
    - `newFolder` → `useFolderDialog().open({ kind: 'create', parentId })`;
    - `switchInventory` → как выбор в `InventorySwitcher` (`selectInventory`, затем `push({ path: '/', force: true })`);
    - `go` → маршрут раздела (`/settings` для `settings`).
  - **От 1024 px.**
    - Окно `bg-surface rounded-card border`, ширина 580 px, сверху 72 px, над затемнением, проявление с лёгким масштабом за 160 мс (`motion-safe:`).
    - В поле справа метка с именем инвентаря (`bg-accent-soft text-accent-soft-foreground rounded-full`).
    - Группы сверху вниз: Items, Folders, Actions.
    - Внизу подсказки «↑↓ move · ↵ open · esc close».
    - Esc и клик по затемнению закрывают.
  - **Ниже 1024 px.**
    - На весь экран, `bg-surface`. Поле внизу с рамкой `border-primary`, справа кнопка «Cancel».
    - Группы в обратном порядке (Actions, Folders, Items), строки внутри групп тоже обратные. Лучший предмет — сразу над полем, список прижат к низу и прокручивается вверх.
- [ ] **Step 6: Где открывается палитра.**
  - **Горячая клавиша.** ⌘K / Ctrl+K в layout (`useEventListener(window, 'keydown')`, `metaKey || ctrlKey` и `k`, `preventDefault`).
  - **`TreePanel`.** Сверху кнопка-поле «Search» с подсказкой: «⌘K» на Mac (`navigator.userAgent` содержит `Mac`), иначе «Ctrl K».
  - **`MobileDock`** (`lg:hidden`, `fixed inset-x-0 bottom-0 z-30`, отступ снизу `calc(1rem + env(safe-area-inset-bottom))`, фон переходит в прозрачный кверху):
    - кнопка-строка `h-[52px] rounded-[18px] bg-surface border shadow-sm` с `Search` и «Search {inventory}», открывает палитру;
    - видна, когда есть `state.current` и `sectionOf(route.name)` не `null`.

    Task 7 добавит справа «+».
  - **`FolderScreen`:** поле поиска, `SearchResults` и работа с `?q=` убираются.
- [ ] **Step 7: Свайпы меню** (дизайн 6.2).
  - **Тесты `test/swipe.test.ts`:**
    - `swipeAction({x:40,y:300},{x:120,y:310},false)` → `'open'`;
    - `({x:10,y:300},{x:200,y:300},false)` → `null` (зона жеста «назад»);
    - `({x:40,y:300},{x:90,y:300},false)` → `null` (короче 60 px);
    - `({x:40,y:300},{x:120,y:360},false)` → `null` (диагональ: 80 против 60);
    - `({x:300,y:300},{x:200,y:305},true)` → `'close'`;
    - свайп влево при закрытом меню и вправо при открытом → `null`.
  - **Подключение в layout ниже 1024 px.** `touchstart`/`touchend` на `window` (passive). Решение по `swipeAction` → `drawerOpen`.
  - **Игнорировать**, если открыты палитра, шторка или меню «⋯» (кроме самого выдвижного меню), или касание началось в `input`, `textarea`, `select` или `[contenteditable]`. Состояние «открыт ли слой» берётся из `useShell` и `useFolderDialog`, а меню и шторки Reka проверяются по `document.querySelector('[role=dialog][data-state=open], [role=menu][data-state=open]')`, исключая выдвижное меню.
- [ ] **Step 8: Verify.**
  - Тесты, типы, линтер — зелёные.
  - На демо-данных:
    - ⌘K → «tl072» → Enter открывает карточку `TL072`;
    - «op» показывает папку `Op-amps`;
    - «work» → переход в Workshop, «назад» возвращает в Electronics;
    - «new folder» создаёт папку в текущей.
  - DevTools, 360×640: палитра от нижней панели, поле над экранной клавиатурой, «Cancel» закрывает.
  - Контроллер проверяет на телефоне владельца через `adb` (Review Focus 3): поле над клавиатурой, жест «назад» закрывает палитру и не уводит со страницы.
- [ ] **Step 9: Commit:** `feat(app): search palette with items, folders and actions; bottom search bar and menu swipes on the phone`

---

### Task 7: Быстрое добавление и кнопка «+»

**Files:**
- Create:
  - `packages/app/app/lib/amounts.ts`, `test/amounts.test.ts`;
  - `packages/app/app/lib/quick-add.ts`, `test/quick-add.test.ts`;
  - `packages/app/app/components/QuickAddSheet.vue`, `QuickAddForm.vue`, `FolderPickerList.vue`, `AmountField.vue`.
- Modify:
  - `app/lib/views.ts`: `folderChoices`; тест в `test/views.test.ts`;
  - `app/components/AppSheet.vue`: прокрутка и начальный фокус;
  - `app/composables/useDialogs.ts`: `useQuickAdd`;
  - `app/layouts/default.vue`: `QuickAddSheet`;
  - `app/components/MobileDock.vue`: кнопка «+»; `FolderActions.vue`: кнопка «Add item»;
  - `app/lib/palette.ts`: действие `addItem`, тест в `test/palette.test.ts`; `SearchPalette.vue`: его выполнение;
  - `en.json`.

**Interfaces:**

```ts
// amounts.ts
/** Built-ins in BUILTIN_UNITS order, then custom units by name. */
export function unitChoices(s: InventorySnapshot): UnitDef[]
/** Text → Quantity in the base unit. Accepts ',' as the decimal mark and the unit's prefixes ('50cm', '2.5 mm').
 *  null: empty, not a number, negative, more than 6 decimals in the base unit, or a prefix the unit lacks. */
export function parseAmountText(text: string, unit: UnitDef): Quantity | null
/** Text → integer minor units; null: empty, invalid, negative, or more decimals than the currency has. */
export function parseMoneyText(text: string, currency: string): number | null

// quick-add.ts
export interface QuickAddInput { folderId: Id | null; name: string; unitKey: string; amount: string; price: string; url: string }
export type QuickAddResult = { command: Extract<Command, { type: 'item.create' }> } | { errorKey: string }
export function buildQuickAdd(input: QuickAddInput, s: InventorySnapshot): QuickAddResult

// views.ts
/** Root first (id null, inventory name), then every active folder depth-first by name; `current` marks `selected`. */
export function folderChoices(s: InventorySnapshot, selected: Id | null): MoveTarget[]

// useDialogs.ts
/** Opens the quick add sheet; the folder defaults to the screen's folder (treeCurrent; 'root' and null → the root). */
export function useQuickAdd(): { state: Ref<{ name: string; folderId: Id | null } | null>; open(prefill?: { name?: string; folderId?: Id | null }): void; close(): void }

// palette.ts — PaletteAction gains:
| { kind: 'addItem'; name: string }   // only with a non-empty query and canWrite; first among the actions
```

`AmountField.vue`: `v-model` — текст, `v-model:unitKey` — ключ единицы, проп `units: UnitDef[]`. Выбор единицы (`Select`) виден, только если единиц больше одной; иначе справа в поле суффикс-символ единицы. Task 9 передаёт одну единицу предмета.

Правила `buildQuickAdd`:
- **Имя.** Обрезается. Пустое → `errors.domain.name_required`.
- **Количество.** Пусто или `0` → без получения. Неверное → `quickAdd.invalidAmount`. Иначе `initialReceipt` с `movementId: newId()`.
- **Цена и ссылка.**
  - Цена или ссылка без количества → `quickAdd.needsAmount`.
  - Неверная цена → `quickAdd.invalidPrice`.
  - Ссылка обрезается, пустая → `null`. Схему проверяет ядро.
- **Остальное:** `id: newId()`, `inventoryId` из снимка, `description: null`, `tagIds: []`.

`AppSheet` получает:
- `max-h-[calc(100dvh-1rem)] overflow-y-auto` у содержимого;
- проп `initialFocus?: string` — CSS-селектор. Обработчик `@open-auto-focus` отменяет фокус по умолчанию и фокусирует найденный элемент.

- [ ] **Step 1: Write the failing tests.**

```ts
// amounts.test.ts
const pcs = BUILTIN_UNITS.pcs, m = BUILTIN_UNITS.m
expect(parseAmountText('1,5', pcs)).toBe('1.5')
expect(parseAmountText('  10 ', pcs)).toBe('10')
expect(parseAmountText('50cm', m)).toBe('0.5')
expect(parseAmountText('2.5 mm', m)).toBe('0.0025')
expect(parseAmountText('1km', m)).toBe('1000')
for (const bad of ['', 'abc', '-1', '0.0000001', '10k']) expect(parseAmountText(bad, pcs)).toBeNull()
expect(parseMoneyText('2.30', 'USD')).toBe(230)
expect(parseMoneyText('2,3', 'USD')).toBe(230)
expect(parseMoneyText('1500', 'JPY')).toBe(1500)
for (const [bad, cur] of [['1.5', 'JPY'], ['-1', 'USD'], ['1.234', 'USD'], ['', 'USD']]) expect(parseMoneyText(bad!, cur!)).toBeNull()

// quick-add.test.ts
it('creates an item without a receipt when no amount is given', () => {
  expect(r.command).toMatchObject({ type: 'item.create', name: 'TL074', folderId: ics, unitKey: 'pcs', tagIds: [], initialReceipt: null })
})
it('adds a first receipt with the batch price and link', () => {
  // amount '37', price '2.30', url ' https://shop.example/x '
  expect(r.command.initialReceipt).toMatchObject({ quantity: '37', totalPrice: 230, sourceUrl: 'https://shop.example/x' })
})
it('reads the amount in the chosen unit with a prefix', () => { /* unitKey 'm', amount '50cm' → quantity '0.5' */ })
it('treats 0 as no amount', () => { /* amount '0' → initialReceipt null */ })
it('refuses a price or link without an amount', () => { expect(r).toEqual({ errorKey: 'quickAdd.needsAmount' }) })
it('refuses an invalid amount or price', () => { /* 'abc' → quickAdd.invalidAmount; '1.234' → quickAdd.invalidPrice */ })
it('refuses an empty name', () => { expect(r).toEqual({ errorKey: 'errors.domain.name_required' }) })

// views.test.ts
it('folderChoices lists the root and every active folder depth-first, marking the selected one', () => {
  expect(folderChoices(s, opamps).map((t) => [t.name, t.depth, t.current])).toEqual([
    ['Electronics', 0, false], ['ICs', 1, false], ['Op-amps', 2, true], /* … */
  ])
})
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `amounts.ts` (поверх `parseAmount`/`parseMoney` из `core`), `quick-add.ts`, `folderChoices`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: UI.** Дизайн каркаса, 6.2 и 6.3: «+» на телефоне — рядом со строкой поиска, на компьютере — кнопка «Add item» в шапке.
  - **Кнопка «+» в `MobileDock`** справа от строки поиска:
    - 52×52, `rounded-fab bg-primary text-primary-foreground`, тень, `Plus`, `aria-label` «Add item»;
    - есть только на экранах папки и предмета (`sectionOf(route.name) === 'items'`) и только без `state.readOnly`;
    - открывает `useQuickAdd().open()`.
  - **«Add item» в `FolderActions`** (не `compact`): главная кнопка `bg-primary` с `Plus` и подписью, первой перед «New folder», в корне тоже. В `compact` её нет: там «+» внизу.
  - **Палитра.** `paletteActions` получает `addItem` («Add item “{q}”») первым среди действий, если запрос не пуст и `canWrite`. Выполнение — `useQuickAdd().open({ name: query })`. Тест в `test/palette.test.ts`: запрос `'tl074'` даёт первым `{ kind: 'addItem', name: 'tl074' }`, при пустом запросе и при `canWrite: false` его нет.
  - **`QuickAddSheet`** смонтирован в layout: `AppSheet` «Add item» с `QuickAddForm` и `initialFocus="#quick-add-name"`. Поля по порядку:
    1. Name — Enter отправляет. Начальное значение — `name` из `useQuickAdd`.
    2. Folder — кнопка с путём «Electronics / ICs». Нажатие раскрывает внутри формы `FolderPickerList` по `folderChoices`, высота до `40dvh` с прокруткой. Выбор сворачивает список. По умолчанию — папка из `useQuickAdd`.
    3. Amount — `AmountField`: поле `inputmode="decimal"` и `Select` единицы из `unitChoices`.
    4. Price for the batch — поле `inputmode="decimal"`, символ валюты инвентаря слева, подсказка «Total for the whole batch».
    5. Where bought — `type="url"`.

    Кнопка «Add». Ошибки — под формой в `role="alert"`, как в `FolderForm`.
  - **После успеха** шторка закрывается и показывается `toast.success(t('quickAdd.added', { name }), { action: { label: t('quickAdd.open'), onClick: () => router.push('/item/' + id) } })`.
- [ ] **Step 6: Verify.**
  - Тесты, типы, линтер — зелёные.
  - На демо-данных добавить предмет с количеством, ценой и ссылкой, открыть его из toast. Цена за штуку в карточке верная.
  - Добавить предмет из палитры: «TL074» → «Add item “TL074”» → имя подставлено, папка — текущая.
  - DevTools, 360×640: шторка не выше экрана и прокручивается внутри. Проверку с настоящей клавиатурой делает контроллер (см. Review Focus 3).
- [ ] **Step 7: Commit:** `feat(app): quick add from the + button, the header and the palette`

---

### Task 8: Правка, перенос и архивация предмета

**Files:**
- Create:
  - `packages/app/app/lib/tags.ts`, `test/tags.test.ts`;
  - `packages/app/app/components/ItemActions.vue`, `ItemDialogs.vue`, `ItemForm.vue`, `TagPicker.vue`;
  - `packages/app/app/components/ui/textarea/*`, `ui/checkbox/*` (shadcn-vue).
- Modify: `ItemScreen.vue`, `ItemList.vue`, `app/composables/useDialogs.ts`, `app/layouts/default.vue`, `en.json`.

**Interfaces:**
- Consumes: `unitChoices` (Task 7), `folderChoices` и `FolderPickerList` (Task 7), `RowMenu` и `useLongPress` (Task 5).
- Produces:

```ts
// useDialogs.ts
export type ItemDialog = { kind: 'edit' | 'move' | 'archive'; itemId: Id }
export function useItemDialog(): { dialog: Ref<ItemDialog | null>; open(d: ItemDialog): void; close(): void }

// tags.ts
export interface TagMatches { tags: Tag[]; canCreate: boolean }
/** Case-insensitive substring match by name, sorted by name; canCreate when the trimmed query is non-empty and no tag has exactly that name (case-insensitive). */
export function tagMatches(s: InventorySnapshot, query: string): TagMatches
```

- [ ] **Step 1: Failing tests** (`tags.test.ts`): `'ab'` находит `Audio`, `lab` по имени; `canCreate` ложно для `' AUDIO '` и для пустой строки; список отсортирован.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: UI.**
  - **`ItemActions`** (проп `itemId`, `compact`) в слоте `actions` шапки карточки — по образцу `FolderActions` из Task 5:
    - не `compact`: кнопка `outline` «Edit» (`Pencil`), кнопки-значки «Move» (`FolderInput`) и «Archive» (`Archive`) с `Tooltip`;
    - `compact`: три прозрачные кнопки-значки 44 px.

    Нейтральные цвета, выключены при `state.readOnly` или `state.saving`.
  - **Строки предметов в `ItemList`** получают `RowMenu` («Edit», «Move», «Archive») и долгое нажатие, как строки папок в Task 5.
  - **`ItemDialogs`** смонтирован в layout и рисует по `useItemDialog().dialog` три шторки ниже.
  - **`ItemForm`** (шторка «Edit item»):
    - Name; Description (`Textarea`); Unit (`Select` по `unitChoices`).
    - Tags (`TagPicker`): поле фильтра, список `Checkbox` по `tagMatches`. Кнопка «Create tag “{q}”» при `canCreate` сразу применяет `tag.create` и отмечает новый тег.
    - Save → `item.update { name, description, unitKey, tagIds }`.
  - **Move to folder:** шторка с `FolderPickerList` по `folderChoices(s, item.folderId)`. Текущая папка выключена. Выбор → `item.update { folderId }`.
  - **Archive:** `ConfirmSheet` «Archive item?» — «“{name}” moves to the archive with its variants and history. You can restore it from the archive.» Затем `archive` с `target: 'item'` и `archiveId: newId()`. Если открыта карточка этого предмета, переход к его папке — после блока `try`, не внутри него.
- [ ] **Step 6: Verify:** тесты, типы, линтер; на демо-данных правка с новым тегом, перенос, архивация, затем восстановление из `/archive`. То же из «⋯» строки предмета в списке и долгим нажатием в DevTools с эмуляцией касания.
- [ ] **Step 7: Commit:** `feat(app): edit, move and archive items, with tags`

---

### Task 9: Движения запаса

**Files:**
- Create: `packages/app/app/lib/stock-forms.ts`, `test/stock-forms.test.ts`, `packages/app/app/components/StockSheet.vue`
- Modify: `StockCard.vue`, `BucketList.vue`, `ItemScreen.vue`, `en.json`

**Interfaces:**

```ts
export type StockMode = 'receive' | 'use' | 'set' | 'transfer'
export interface StockFormInput { amount: string; price: string; url: string; note: string; toVariantId: Id | null }
export interface StockFormContext { itemId: Id; variantId: Id | null; unit: UnitDef; currency: string }
export function buildStockCommand(mode: StockMode, input: StockFormInput, ctx: StockFormContext): { command: Command } | { errorKey: string }
/** '+' is a receipt of 1 without a price; '−' is a use of 1. [решение Claude: спека не говорит, каким движением пишутся быстрые «+/−»] */
export function quickStep(step: 'plus' | 'minus', ctx: Pick<StockFormContext, 'itemId' | 'variantId'>): Command
```

Правила разбора полей:
- **Количество.** Через `parseAmountText`. Для `set` допустим `0`, для остальных режимов нужно больше нуля. Иначе `stockForm.invalidAmount`.
- **Цена.** Только у `receive`, по желанию. Неверная → `stockForm.invalidPrice`.
- **Ссылка и заметка.** Обрезаются, пустые → `null`.
- **Перенос.** `toVariantId === variantId` → `stockForm.sameBucket`.
- **Новые id.** `movementId`, `transferId`, `outMovementId`, `inMovementId` — `newId()`.

- [ ] **Step 1: Failing tests:**

```ts
it('receive: amount with a prefix, batch price, link and note', () => {
  // unit m, amount '50cm', price '19.99' USD, url ' https://shop.example ', note ''
  expect(r.command).toMatchObject({ type: 'stock.receive', quantity: '0.5', totalPrice: 1999, sourceUrl: 'https://shop.example', note: null })
})
it('use: needs a positive amount', () => { /* '0' → stockForm.invalidAmount; '3' → stock.use quantity '3' */ })
it('set: accepts zero', () => { /* '0' → stock.set target '0' */ })
it('transfer: refuses the same bucket', () => { /* → stockForm.sameBucket */ })
it('quick plus and minus are a receipt and a use of one', () => {
  expect(quickStep('plus', ctx)).toMatchObject({ type: 'stock.receive', quantity: '1', totalPrice: null, sourceUrl: null, note: null })
  expect(quickStep('minus', ctx)).toMatchObject({ type: 'stock.use', quantity: '1', note: null })
})
```

- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: UI.**
  - **Предмет без вариантов.** Внизу `StockCard` ряд кнопок: `−`, `+` (иконки, 44 px, `aria-label` «Use one» / «Add one»), «Receive», «Use» и `⋯` с пунктом «Set quantity».
  - **Предмет с вариантами.** У каждой строки `BucketList` справа от количества кнопки `−`, `+` и `⋯`: Receive…, Use…, Set quantity…, Move to… (если корзин больше одной).
  - **Когда кнопки выключены.** `−` — при количестве корзины ≤ 0. Все — при `state.readOnly`.
  - **`StockSheet`** — заголовок по режиму. Поля:
    - Amount: `AmountField` с единицей предмета, без выбора единицы, суффикс — символ единицы. Для `set` подпись «Actual quantity», для `transfer` поле заранее заполнено всем количеством корзины;
    - receive: Price for the batch, Where bought, Note;
    - use и set: Note;
    - transfer: радиосписок корзин назначения, «No variant» для `null`.

    Отправка → `workspace.apply(command)`. Ошибки показываются у формы.
- [ ] **Step 6: Verify.**
  - Тесты, типы, линтер — зелёные.
  - На демо-данных:
    - `TL072`: `+` и `−` меняют итог, журнал пополняется;
    - получение с ценой меняет среднюю и последнюю цену;
    - «Set quantity 40» пишет корректировку на разницу;
    - перенос между вариантами резистора.
  - DevTools, 360×640: шторка Receive (4 поля) прокручивается внутри. Настоящую клавиатуру проверяет контроллер (Review Focus 3).
- [ ] **Step 7: Commit:** `feat(app): receive, use, set and move stock from the item card`

---

### Task 10: Варианты

**Files:**
- Create: `packages/app/app/lib/lists.ts`, `test/lists.test.ts`, `packages/app/app/components/VariantsForm.vue`, `VariantForm.vue`, `LooseTransferSheet.vue`
- Modify: `app/lib/item-view.ts` (+ `looseTransferOffer`), `test/item-view.test.ts`, `BucketList.vue`, `ItemScreen.vue`, `en.json`

**Interfaces:**

```ts
// lists.ts
/** Splits on commas, semicolons and line breaks; trims; drops empty; removes case-insensitive duplicates, keeping the first. */
export function parseNameList(text: string): string[]
// item-view.ts
/** Stock without a variant to offer moving into a first variant: only when the item has no active variants and that stock is > 0. */
export function looseTransferOffer(s: InventorySnapshot, itemId: Id): { quantity: Quantity; number: string; unit: string } | null
```

- [ ] **Step 1: Failing tests:**
  - `parseNameList('1k, 10k\n100k;  ,1K')` → `['1k', '10k', '100k']`.
  - `looseTransferOffer`:
    - у резистора (есть варианты) → `null`;
    - у `NE555` (0 шт) → `null`;
    - у `TL072` → `{ quantity: '37', number: '37', unit: 'pcs' }`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: UI.**
  - **`VariantsForm`.** Кнопка «Add variants» на карточке открывает шторку. Поле `Textarea` с подсказкой «One per line or separated by commas: 1k, 10k, 100k».
    - Перед записью форма запоминает `looseTransferOffer` по текущему снимку.
    - Затем `variant.createMany` с `newId()` для каждого имени.
    - Если предложение было, открывается `LooseTransferSheet`: «Move {number} {unit} without a variant into a variant?», радиосписок новых вариантов (по умолчанию первый), кнопки «Move» и «Keep without variant». «Move» → `stock.transfer` из `null` в выбранный вариант.
    - Дубли имён показываются ошибкой ядра `errors.domain.duplicate_name`.
  - **Меню `⋯` строки варианта** (дополняет Task 9):
    - «Rename» → `VariantForm` (имя, описание) → `variant.update`;
    - «Archive variant» → `ConfirmSheet` «Variant “{name}” moves to the archive with its stock and history.» → `archive` с `target: 'variant'`.
- [ ] **Step 6: Verify:** тесты, типы, линтер; на демо-данных добавить варианты к `TL072` и перенести остаток; переименовать и заархивировать вариант резистора; итог по предмету меняется.
- [ ] **Step 7: Commit:** `feat(app): variants — add in bulk, move existing stock, rename and archive`

---

### Task 11: Атрибуты на предмете и вариантах

**Files:**
- Create:
  - `packages/app/app/components/AttributeForm.vue`, `AttributeValueSheet.vue`;
  - `packages/app/app/components/ui/switch/*` (shadcn-vue).
- Modify:
  - `app/lib/item-view.ts` (+ `attributeChoices`), `test/item-view.test.ts`;
  - `ItemAttributes.vue`, `BucketList.vue`;
  - `app/lib/dev/demo-source.ts`: теги и атрибуты;
  - `en.json`.

**Interfaces:**

```ts
/** Inventory attributes not yet attached to the item, by name. */
export function attributeChoices(s: InventorySnapshot, itemId: Id): Attribute[]
```
`AttributeForm` (проп `attribute: Attribute | null`, событие `done(attributeId)`) создаёт или правит атрибут: имя, тип (`RadioGroup` Text / List), варианты списка — `Textarea` через `parseNameList`. Task 12 переиспользует эту форму.

- [ ] **Step 1: Failing test:** `attributeChoices` не содержит атрибутов, уже подключённых к предмету, и отсортирован по имени.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: UI.**
  - **`ItemAttributes`.** Секция видна всегда. У каждой строки `⋯` с пунктами Edit value и Remove (`item.removeAttribute`). Внизу кнопка «Add attribute».
  - **`AttributeValueSheet`.**
    1. Выбор атрибута из `attributeChoices` или «New attribute…» (`AttributeForm` внутри шторки).
    2. Если у предмета есть варианты — `Switch` «Differs by variant».
    3. Значение. Для text — `Input`, для enum — `Select` с пустым вариантом «—».
  - **Запись.**
    - Одно значение → `item.setAttribute { value }`, пустая строка → `null`.
    - По вариантам → `item.setAttribute { value: null }`, затем `variant.setAttribute` для каждого варианта, у которого значение изменилось.
  - **`BucketList`.** Значения по вариантам показываются в строке варианта (из Task 4), их правка — пункт «Attribute values» в `⋯` варианта.
- [ ] **Step 6: Демо-данные** (при `extras`):
  - теги `audio`, `smd`; `TL072` получает `audio`;
  - атрибут `Package` (enum: `DIP-8`, `SOIC-8`), у `TL072` значение `DIP-8`;
  - атрибут `Resistance` (text) у резистора по вариантам: `1 kΩ`, `10 kΩ`.
- [ ] **Step 7: Verify:** тесты, типы, линтер; поиск находит резистор по `10 kΩ` и `TL072` по `DIP-8`; снимок карточки резистора на 360 px.
- [ ] **Step 8: Commit:** `feat(app): attributes on items and variants`

---

### Task 12: Справочники: теги, атрибуты, единицы

**Files:**
- Create:
  - `packages/app/app/lib/dictionaries.ts`, `test/dictionaries.test.ts`;
  - `packages/app/app/pages/dictionaries.vue`;
  - `packages/app/app/components/TagsSection.vue`, `AttributesSection.vue`, `UnitsSection.vue`, `UnitForm.vue`.
- Modify: `app/lib/shell.ts` и `test/shell.test.ts` (раздел `dictionaries`), `AppNav.vue` (иконка `Tags`), `en.json`.

**Interfaces:**

```ts
export interface DictionaryView {
  tags: { tag: Tag; itemCount: number }[]
  attributes: { attribute: Attribute; itemCount: number }[]
  /** Built-ins first (custom: null), then custom units by name. */
  units: { unit: UnitDef; custom: CustomUnit | null; itemCount: number }[]
}
/** Counts include archived items: deleting a tag, attribute or unit affects them too (core's unit_in_use counts them). */
export function dictionaryView(s: InventorySnapshot): DictionaryView
```

- [ ] **Step 1: Failing tests:**
  - счётчики учитывают архивные предметы;
  - встроенные единицы идут первыми в порядке `BUILTIN_UNITS`;
  - свои единицы сортируются по имени.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Раздел и экран.**
  - `NAV_SECTIONS` получает `{ key: 'dictionaries', to: '/dictionaries' }` между `items` и `archive`, подпись «Tags & fields». Тест: `NAV_SECTIONS.map((s) => s.key)` — `['items', 'dictionaries', 'archive']`. Палитра сама получает действие перехода (Task 6).
  - Экран `/dictionaries` (layout `default`, без панели дерева): `ScreenHeader` с заголовком «Tags & fields», три секции-карточки в `ScreenBody`.
  - **Tags.** Строка: имя и «N items». Меню `⋯`:
    - Rename → `tag.rename`;
    - Delete → `ConfirmSheet` «Tag “{name}” will be removed from {count} items.» → `tag.delete`.

    Кнопка «Add tag».
  - **Attributes.** Строка: имя, тип («Text» или «List: a, b, c») и число предметов. Меню `⋯`:
    - Edit → `AttributeForm`;
    - Delete → «Attribute “{name}” and its values on {count} items will be deleted.» → `attribute.delete`.

    Кнопка «Add attribute».
  - **Units.**
    - Встроенные — только чтение: имя, символ, приставки («mm, cm, km») и пометка «Built-in».
    - Свои: меню `⋯` с Edit и Delete. Ошибка `unit_in_use` показывается текстом `errors.domain.unit_in_use`.
    - «Add unit» открывает `UnitForm`: имя, символ, `Checkbox` приставок из `SI_PREFIXES` (по убыванию степени, «k · kilo»).
- [ ] **Step 6: Verify:**
  - тесты, типы, линтер — зелёные;
  - на демо-данных:
    - переименовать тег;
    - удалить атрибут — значения пропали из карточки;
    - создать единицу «Reel / reel» с приставкой k и выбрать её в правке предмета;
    - удалить единицу, которая используется, — ошибка.
- [ ] **Step 7: Commit:** `feat(app): tags, attributes and units of an inventory`

---

### Task 13: Workspace — обновления без лишних запросов и редкие гонки

Долги плана 2: Task 6 и финальное ревью. С частыми записями из быстрого добавления они становятся заметнее.

**Files:**
- Modify: `packages/app/app/lib/workspace.ts`, `packages/app/app/lib/device-db.ts`, `packages/app/app/lib/dev/demo-source.ts`
- Test: `test/workspace.test.ts`, `test/device-db.test.ts`, `test/demo-source.test.ts`

**Interfaces:**
- `DeviceDb`:
  - `putListing(sourceId: string, inventories: Inventory[]): Promise<void>`;
  - `getListings(): Promise<Record<string, Inventory[]>>`;
  - `deleteListing(sourceId: string): Promise<void>`.

  Реализации и для IndexedDB, и для памяти.
- `FAILED_RETRY_MS = 5 * 60_000` (экспорт из `workspace.ts`).

- [ ] **Step 1: Failing tests** — по одному на пункт:
  1. `'reuses the connection between refreshes'`:
     - два `refresh()` дают один `driver.connect`;
     - если `listInventories` на переиспользуемом подключении падает, подключение закрывается и открывается заново один раз за обновление.
  2. `'a failing non-current source does not force a refresh more than once per FAILED_RETRY_MS'`. `refreshIfStale` с неработающим текущим источником по-прежнему обновляет сразу.
  3. `'starts offline with the inventory list from the device'`:
     - после обновления списки сохранены;
     - новый workspace без сети показывает те же `inventories` и `archivedInventories`;
     - `removeSource` удаляет список источника.
  4. `'keeps a post-write reload when a later-started load fails'`. Загрузка пишет в состояние, если её номер больше номера последней записанной (`appliedSeq`), а не только если она последняя начатая.
  5. `'a write during selectInventory validates against the new inventory'`:
     - `setCurrent` с другим `ref` сразу сбрасывает снимок;
     - `applyTo` берёт `state.snapshot`, только если `snapshot.inventory.id === ref.inventoryId`.
  6. `'a failing fallback load in apply is redacted and marks the source'`. Запасная загрузка снимка внутри задания идёт в `try`: ошибка без пароля и без `cause`, `unavailable` помечает источник.
  7. `'errors are redacted with the config the write started with'`. Источник удалён во время записи — пароль всё равно вырезан.
  8. `'a refresh in the same tick as removeSource does not bring the source back'`. `generation` увеличивается ещё раз после сохранения изменения на устройстве.
  9. `'dropMissing keeps an inventory the user selected meanwhile'`.
  10. `'removing a source during updateSource keeps it removed'`. Плюс тест: из двух пересекающихся `updateSource` побеждает последний вызванный.
  11. `'no cached snapshot outlives its source removed mid-load'`.
  12. `demo-source.test.ts`: неудачное открытие PGlite не остаётся в кеше драйвера, следующий `connect` пробует снова.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Если `workspace.ts` переходит за 650 строк, вынести типы в `app/lib/workspace-types.ts` и реэкспортировать их из `workspace.ts`. Логику не делить.
- [ ] **Step 4: Run all tests, typecheck, lint.**
- [ ] **Step 5: Commit:** `fix(app): reuse connections, keep listings offline and close workspace races`

---

### Task 14: Долги плана 2 — доступность, формы, настройки

Пачка мелких правок, каждая со своей проверкой.

**Files:** компоненты из списка ниже, `test/currencies.test.ts`, `en.json`.

- [ ] **Step 1: Доступность.**
  - Видимый фокус у пункта Archive в меню инвентаря на компьютере (`focus:bg-accent-soft` и т.п., как у других пунктов).
  - Дерево папок: отступ ограничен 6 уровнями, глубже отступ и линии не растут, имя по-прежнему обрезается.
  - Кольцо фокуса в листе переноса папки не обрезается: у списка внутренний отступ.

  Пункты плана 2 про видимый `h1`, имя инвентаря до загрузки, крошки и уровни дерева закрыты в Task 2. Кнопка очистки поиска ушла вместе с полем: у палитры своя (Task 6).
- [ ] **Step 2: Формы.**
  - **`AppSheet`** получает проп `locked`. Пока идёт запись, шторку нельзя закрыть: `Escape`, клик по подложке, кнопка «Cancel» и жест «назад» (`useCloseWatcher` не закрывает при `locked`) выключены. Все формы плана 2 и 3 передают в него свой `busy`.
  - **Атрибуты `autofocus`** убраны из форм: фокус ставит `initialFocus` шторки.
  - **i18n.** Повторяющиеся ключи (`folderForm.optional`, `inventoryForm.optional`, …) сведены в `form.optional`, `form.name`, `form.description`.
  - **Создание инвентаря без готового источника.** Вместо молча выключенной кнопки `InventoryForm` показывает «Connect a source first» со ссылкой на `/settings`.
  - **`currencies.test.ts`:** у запроса `'us'` все коды до первого кода не на `US` начинаются с `US`, после него ни один не начинается с `US`, у всех оставшихся имя содержит `us`, и группа префикса не пуста.
  - **Ручная проверка:** набор в `ComboboxInput` валюты не дописывается к уже выбранному коду.
- [ ] **Step 3: Настройки.**
  - `check()` в `SourceForm` с `catch`.
  - Ошибка сохранения только в форме, без toast.
  - Страница `/settings/sources/[id]` удалённого источника показывает `EmptyState` со ссылкой «Back to settings».
  - Подпись «Demo Demo»: тип источника показывается, только если он не совпадает с именем.
  - Результат проверки с чужой базой — `role="alert"`.
- [ ] **Step 4: Verify:** тесты, типы, линтер; проход клавиатурой (Tab) по левой панели, дереву, шапке, экрану папки, карточке, меню и палитре на 1280 px; VoiceOver зачитывает дерево вложенными списками и состояние стрелок раскрытия.
- [ ] **Step 5: Commit:** `fix(app): accessibility, form and settings follow-ups from Plan 2`

---

## Приёмка владельцем

После финального ревью ветки контроллер просит владельца проверить на телефоне: `pnpm dev`, `adb reverse tcp:3000 tcp:3000`, `http://localhost:3000`, свой источник Neon.
1. Быстро добавить несколько настоящих предметов с ценой и ссылкой: кнопкой «+» внизу и из палитры («Add item “…”»).
2. Найти предмет строкой поиска внизу, открыть карточку, сделать `+`/`−`, «Set quantity», получение и использование, проверить журнал и цены.
3. Добавить варианты к предмету с остатком и перенести остаток в вариант.
4. Заархивировать предмет и папку, восстановить их из «Archive», удалить один тестовый предмет навсегда.
5. Завести тег, атрибут и свою единицу.
6. Каркас на телефоне: стрелки «назад» и «вперёд», в том числе после смены инвентаря; меню ☰ с деревом; долгое нажатие на папку и предмет; жест «назад» закрывает палитру и шторки.
7. Каркас на компьютере: левая панель, дерево с линиями, «+» и «⋯» при наведении, кнопки действий в шапке, ⌘K / Ctrl+K.
