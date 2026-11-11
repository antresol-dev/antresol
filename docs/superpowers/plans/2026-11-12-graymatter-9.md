# План 9 — новые тени и стекло, варианты с количеством, выражения, фото, надёжность

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Всё из спеки Плана 9.

**Architecture:**
- **Волна 1** — семь независимых задач параллельно: дизайн, данные, ядро чисел, фото, синхронизация, быстрое добавление, CI.
- **Волна 2** — две задачи интерфейса поверх данных и ядра.
- Затем итоговое ревью в две половины и исправления.

**Tech Stack:** TypeScript, Vitest, Postgres (PGlite, Neon), Nuxt 4, Vue 3, Tailwind 4, vite-pwa (Workbox).

**Spec:** `docs/superpowers/specs/2026-11-12-graymatter-plan9-design.md`. Спеки Планов 6–8 действуют.

## Global Constraints

Те же, что в Плане 8 (`docs/superpowers/plans/2026-11-11-graymatter-8-polish.md`, Global Constraints), с уточнениями:
- **Ветки.** Интеграционная ветка `plan9`. Задачи — в `.worktrees/p9-tN` на ветках `p9-tN`.
- **Ресурсы.** Порты dev-серверов `3010 + N`; порт 3001 занят превью для телефона владельца, его не трогать. Vitest — `--maxWorkers=3`.
- **Neon.** Набор соответствия гоняет только задача 2, затем контроллер на финальной ветке.
- **`nuxt.config.ts`.** Меняет только задача 5 (Workbox), отдельным коммитом. При слиянии в `revival` правка владельца `devServer` сохраняется через stash с уникальной меткой, применение по хешу.
- **Снимки экрана.** Через chrome-devtools MCP, если Claude in Chrome не подключён.

## Review Focus
1. **Изменение пары значений в таблице, которое меняет их местами** (A = 4k7, B = 10k → A = 10k, B = 4k7). В конечном состоянии дублей нет — команда проходит. Тест в задаче 2.
2. **Выражение с делением и единицами** (`1/3 m`, `(2+3)x4k`), пустые скобки, `5x` без второго множителя. Точный результат или понятная ошибка поля, никогда `NaN`. Тест в задаче 3.
3. **Кэш фото не растёт бесконечно** и не кэширует ответы с ошибкой (4xx, 5xx) и «непрозрачные» ответы. Тест конфигурации в задаче 5.
4. **Повтор `variant.createMany` с приходами после неизвестного исхода** не задваивает приход: тот же `movementId`. Тест в задаче 2.
5. **Контраст текста на мягкой (soft) акцентной кнопке** в светлой теме для всех 10 акцентов ≥ 4.5:1. Тест в задаче 1.

---

## Порядок

| Волна | Задачи | Зависят от |
|---|---|---|
| 1 | 1 (дизайн), 2 (данные), 3 (ядро: выражения и ближайшие), 5 (фото), 6 (синхронизация и источники), 7 (быстрое добавление), 8 (CI) | — |
| 2 | 4 (интерфейс вариантов: количество, одна команда, замена фото), 9 (интерфейс выражений и подсказок) | 4 — от 2; 9 — от 3 |

Ревью по ходу — только у задачи 2 (данные). Остальное — итоговое ревью в две половины.

| Приёмка спеки (§4) | Задачи |
|---|---|
| 1 | 1 |
| 2 | 2, 4 |
| 3 | 2, 4 |
| 4 | 3, 9 |
| 5 | 3, 9 |
| 6 | 2 (`photo.replace`), 4, 5 |
| 7 | 2, 6 |
| 8 | 7 |
| 9 | 8 |
| 10 | все |

---

### Task 1: Дизайн — новые числа, стекло, мелочи (спека A)

**Files:**
- Modify: `packages/app/app/assets/css/main.css`
- Modify: `packages/app/app/components/ui/**` (меню, списки выбора, выпадающие списки → `glass`; подсказки)
- Modify: `SearchPalette.vue` (B3), `ScreenHeader.vue` (B7), `packages/app/test/style.test.ts`

**Interfaces:**
- Produces: утилита `glass` вместо `floating`. Токены `--glass-bg`, `--glass-img`, `--glass-blur`, `--glass-border`, `--glass-shadow`, `--glass-hover`, `--glass-divider`, `--glass-danger` в обеих темах. Акцентная кнопка в светлой теме мягкая.

- [ ] **Step 1: Write failing tests** в `style.test.ts`:
  - числа теней светлой темы — `hybrid2` при 0.7 / 1.1 / 0.7;
  - тёмной темы — `hybrid2(…, dark)` при 0.8 / 0.7 / 0.9, фон `#2A2E37`, кромка `RIM`;
  - мягкая кнопка в светлой теме: контраст ≥ 4.5:1 для 10 акцентов (Review Focus 5);
  - меню, списки выбора и выпадающие списки используют `glass`;
  - у тени и вдавливания одна длительность и кривая (как сейчас);
  - поле поиска палитры без `border-accent` / `border-primary`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** по спеке A.
  - Числа — из `/private/tmp/claude-501/-Users-as-dev-graymatter/f590e304-ca87-4aa9-90ed-dd7ab6a89334/scratchpad/artifact-files/bb7b3878-c996-431a-bc51-84273d6d5954/project/ItemScreen.dc.html` (`hybrid2`, `glass*`).
  - B6: подключить `tw-animate-css` или убрать мёртвые классы анимации; убрать двойное объявление подсказки и `aria-label`.
  - B7: шапка на 360 px не переполняется.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Снимки: экран предмета в светлой и тёмной теме на 1280 px, 360 px в светлой, открытое меню в обеих темах.
- [ ] **Step 5: Commit** `style(app): board 7/8 shadows (soft accent button light, own dark tuning), liquid glass menus, palette field, tooltips, 360 header`.

### Task 2: Данные — `variant.setValues`, приходы при создании вариантов, `photo.replace`, GM003 (спека B, C, F3, G3)

**Files:**
- Modify: `packages/core/src/commands.ts`, `validate.ts`, `variants.ts`
- Modify: `packages/storage-postgres/src/commands/variants.ts`, `photos.ts`, `index.ts`, `reads.ts`, `storage.ts`
- Test: `packages/core/test/validate.test.ts`, `variants.test.ts`; `packages/storage-postgres/test/variants.test.ts`, `photos.test.ts`, `idempotent.test.ts`, `patch.property.test.ts`, `migrator.test.ts`

**Interfaces:**
- Produces:

```ts
| { type: 'variant.createMany'; itemId: Id; variants: { id: Id; values: { attributeId: Id; value: string }[]; initialReceipt?: { movementId: Id; quantity: Quantity } }[] }
| { type: 'variant.setValues'; itemId: Id; rows: { variantId: Id; values: { attributeId: Id; value: string | null }[] }[] }
| { type: 'photo.replace'; variantId: Id; id: Id; itemId: Id; provider: string; fileId: string; url: string }
```

- **`variant.setValues`.** Ядро проверяет конечное состояние всех строк (уникальность, оси, значения, архив). Повтор с теми же значениями проходит. Изменённые строки — срез одного предмета.
- **`photo.replace`.** Одна транзакция: старое фото варианта удаляется, новое добавляется. Изменённые строки — срез предмета.
- **GM003.** После `LOCK_REV` в пакете записи — проверка `coalesce(min_app_schema, schema_version)::int > APP_SCHEMA_VERSION` → `StorageError('read_only')`.

- [ ] **Step 1: Write failing tests:**
  - **обмен значениями** (Review Focus 1);
  - **ложная ошибка C2:** (100n, 50V) → (220n, 25V) при B = (220n, 50V) проходит; итог, дающий дубль, → `duplicate_variant`;
  - **создание с приходами:** `createMany` с приходом пишет вариант и движение одной транзакцией; повтор с тем же `movementId` не задваивает (Review Focus 4); строка без прихода — только вариант;
  - **`photo.replace`:** на месте старого фото оказывается новое, старого нет, запись одна;
  - **GM003:** база с `min_app_schema = 99` → запись отклоняется с `read_only`, ничего не записано;
  - **property-тест** получает `variant.setValues`, `photo.replace` и `createMany` с приходами.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run packages/core/test packages/storage-postgres/test --maxWorkers=3`, `pnpm typecheck`. Затем набор соответствия на Neon один раз.
- [ ] **Step 5: Commit** `feat: variant.setValues on the final state, variants created with stock, photo.replace, write batch refuses a newer min_app_schema`.

### Task 3: Ядро — выражения количества и ближайшие номиналы (спека D, E)

**Files:**
- Create: `packages/core/src/expressions.ts`
- Modify: `packages/core/src/search.ts` или `variants.ts` (ближайшие), `index.ts`
- Test: `packages/core/test/expressions.test.ts`, `search.test.ts`

**Interfaces:**
- Produces:
  - `evaluateAmount(input: string, unit: UnitDef, fractionDigits = 6): { value: Quantity } | { error: 'syntax' | 'unit' | 'divide_by_zero' | 'negative' }` — точная арифметика на BigInt, единицы и приставки по правилам `parseAmount`;
  - `evaluatePrice(input: string): { value: string } | { error: … }` — 4 знака;
  - `nearestValues(s: InventorySnapshot, attribute: Attribute, value: NumberValue): { below: Hit | null; above: Hit | null }`, где `Hit = { itemId: Id; variantId: Id | null; value: NumberValue; quantity: Quantity }`. Ближайшие значения ищутся среди осей вариантов и общих значений; архивные не участвуют.

- [ ] **Step 1: Write failing tests:**
  - `5x100` → 500; `5×100`, `5*100`; `2.5m + 120cm` (метры с приставками) → `3.7`; `10/3` → `3.333333`;
  - `(2+3)x4k` у штук → 20000; `1/3 m`;
  - ошибки: `5x` → `syntax`; `()` → `syntax`; `1/0` → `divide_by_zero`; `2-5` → `negative`; `3 kg` у метров → `unit` (Review Focus 2);
  - `nearestValues` для 4.7 kΩ при 4.3k (12) и 5.1k (40) → оба; без меньшего → `below: null`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — разбор с приоритетом операций (рекурсивный спуск), без `eval` и без float.
- [ ] **Step 4: Run** `pnpm vitest run packages/core/test --maxWorkers=3`, `pnpm --filter @graymatter/core typecheck`.
- [ ] **Step 5: Commit** `feat(core): exact amount and price expressions; nearest number values`.

### Task 4: Интерфейс вариантов — количество, одна команда, замена фото (спека B, C, F3) — волна 2, после задачи 2

**Files:**
- Modify: `packages/app/app/lib/variant-batch.ts`, `VariantsForm.vue`, `VariantForm.vue`, `VariantValuesSheet.vue`, место `setVariantPhoto` (`workspace.ts` или `lib/photos`)
- Test: `packages/app/test/variant-batch.test.ts`, тесты сборщиков команд

**Interfaces:**
- Consumes: команды задачи 2; `evaluateAmount` задачи 3 (если задача 3 уже влита; иначе `parseAmount`, а задача 9 переключит).

- [ ] **Step 1: Write failing tests:**
  - `100n; 50V; 10` и `100n; 16V` → две строки, у первой приход 10 шт; предпросмотр «100 nF · 50 V — 10 pcs»;
  - `1k; 100` при одной оси; `1k, 10k` (список) — без количества;
  - неверное количество → ошибка строки;
  - `VariantForm` и `VariantValuesSheet` строят одну команду `variant.setValues`;
  - замена фото варианта строит `photo.replace`.
- [ ] **Step 2–4: Implement**, run, снимки «Add variants» с количеством на 1280 и 360 px.
- [ ] **Step 5: Commit** `feat(app): add variants with stock, edit variants in one command, replace a variant photo atomically`.

### Task 5: Фото — оптимизации и кэш на устройстве (спека F, кроме F3)

**Files:**
- Modify: `ItemGallery.vue`, `lib/photo-url.ts` (F1a), `lib/images.ts` (F4, WebP), `lib/traffic.ts` или новый счётчик загрузок (F1b), компоненты фото (`loading="lazy"`), раздел настроек (размер кэша, очистка)
- Modify: `packages/app/nuxt.config.ts` — **только** `pwa.workbox.runtimeCaching`, отдельным коммитом
- Test: `photo-url.test.ts`, `images.test.ts`, новые `photo-cache.test.ts`, `uploads.test.ts`

**Interfaces:**
- Produces: `PHOTO_CACHE = { thumbs: 'gm-photos-thumb', full: 'gm-photos-full' }`, `photoCacheSize(): Promise<number>`, `clearPhotoCache(): Promise<void>`, `uploadsThisMonth(sourceId): Promise<number>`.

- [ ] **Step 1: Write failing tests:**
  - обложка — размер `full`;
  - счётчик загрузок растёт и сбрасывается в новом месяце;
  - нехватка памяти → новый код `too_large_to_decode`, а не `unsupported`;
  - выбор WebP при поддержке, иначе JPEG;
  - конфигурация `runtimeCaching`: хосты трёх провайдеров, CacheFirst, `cacheableResponse: { statuses: [200] }` (не 0 — значит не непрозрачные), `expiration.maxEntries` 600 и 150 (Review Focus 3);
  - CORS-режим для фото с этих хостов.
- [ ] **Step 2–4: Implement**, run. Проверить заголовки CORS у трёх CDN (`curl -I` с `Origin`). Для того, кто CORS не отдаёт, кэш не включать и записать это в отчёт.
- [ ] **Step 5: Commit** (два коммита: приложение и `nuxt.config.ts`) `feat(app): photo cover at full size, monthly upload count, honest decode errors, WebP uploads, on-device photo cache`.

### Task 6: Синхронизация и источники (спека G3 — сторона приложения, G6, G7)

**Files:**
- Modify: `packages/app/app/lib/workspace.ts`, `lib/sources.ts`, `device-db.ts` при необходимости
- Test: `packages/app/test/workspace.test.ts`, `sources.test.ts`; `packages/storage-postgres/test/neon.conformance.test.ts` (детерминированный тест параллельности — без запуска на Neon, его гоняет задача 2)

- [ ] **Step 1: Write failing tests** — по одному на каждый край из спеки G6 и G7. Плюс `read_only` из GM003: источник переходит в «только чтение», показывается баннер обновления.
- [ ] **Step 2–4: Implement**, run (`pnpm vitest run packages/app/test --maxWorkers=3`, `pnpm typecheck`).
- [ ] **Step 5: Commit** `fix(app): revision bookkeeping and source lifecycle races; newer min_app_schema turns a source read-only`.

### Task 7: Быстрое добавление (спека H)

**Files:**
- Modify: `QuickAddForm.vue`, `QuickAddSheet.vue`, `lib/quick-add.ts`
- Test: `quick-add.test.ts`

- [ ] **Step 1–4.**
  - Подсказка «Add the amount to keep the link» при ссылке без количества.
  - Черновик сохраняется при «Open» и возвращается при следующем открытии в той же сессии.
  - Тесты на логику черновика.
- [ ] **Step 5: Commit** `fix(app): quick add keeps its draft across Open; warns when a shared link has no amount`.

### Task 8: CI (спека I)

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy.yml` (версии actions), корневой `package.json` (`packageManager`)

- [ ] **Step 1–4.**
  - `ci.yml`: на push в любую ветку и на pull_request — pnpm (версия из `packageManager`), Node из `devEngines`, `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, `pnpm lint`. Без секретов.
  - Обновить `checkout`, `upload-pages-artifact`, `deploy-pages` и прочие actions до текущих мажорных версий, прочитав их changelog.
  - Проверить синтаксис workflow (`actionlint`, если есть, иначе разбор YAML).
- [ ] **Step 5: Commit** `ci: test, typecheck and lint on every push; current action versions; packageManager`.

### Task 9: Интерфейс выражений и подсказок (спека D, E) — волна 2, после задачи 3

**Files:**
- Modify: `AmountField.vue` (или общий компонент полей количества), поля цены в `StockSheet` и `QuickAddForm`, `lib/stock-forms.ts`, `lib/quick-add.ts`; `lib/palette.ts`, `SearchPalette.vue`, `lib/share.ts`, `pages/share.vue` (подсказки ближайших)
- Test: `stock-forms.test.ts`, `quick-add.test.ts`, `palette.test.ts`, `share.test.ts`, `amounts.test.ts`

- [ ] **Step 1: Write failing tests:**
  - поля количества и цены принимают выражения, предпросмотр «= …»;
  - палитра «4k7» без точного значения → строка-подсказка с ближайшими и остатками, касание открывает вариант;
  - чип в «Поделиться» без совпадения показывает ближайшие.
- [ ] **Step 2–4: Implement**, run, снимки поля с выражением и палитры с подсказкой.
- [ ] **Step 5: Commit** `feat(app): expressions in amount and price fields; nearest values in the palette and share sheet`.

### Task 10: Правки интерфейса по просмотру на телефоне (владелец, 2026-11-12) — после задачи 1

**Files:** `ScreenHeader.vue` и мобильная шапка (`MobileDock.vue` и др.), `AppSheet.vue`, `ui/input`, `ui/select` или комбобокс единицы, `QuickAddForm.vue` (только размеры полей и кнопки камеры и галереи), `PhotoPicker.vue`, `AttributeForm.vue` (пример приставок), `pages/tags` или `TagsSection.vue`, `AttributesSection.vue`, `UnitsSection.vue`, `TreePanel.vue`, `FolderTree.vue`, `main.css` (утилита вогнутости), `style.test.ts`.

1. **Верхние кнопки на телефоне** (меню и «добавить папку») стоят слишком близко к верхнему краю. Во flat-стиле это было нормально, в неоморфном выглядит плохо. Отступ не добавлять: он съест место. Решение [решение Claude]: иконочные кнопки мобильной шапки становятся плоскими (ghost, `pressable` без `raised`), выпуклость им там не нужна.
2. **«New attribute».** Под «SI prefixes» сейчас бессмысленный пример (`4700 → 4700`). Всегда показывать, что дают приставки, даже когда переключатель выключен: «With SI prefixes: 4k7 → 4.7 kΩ» (с единицей атрибута, если она задана).
3. **Шторки на телефоне дёргаются,** когда открывается клавиатура, и «колбасит» при закрытии. Изучить, как это правильно делают на мобильных (visual viewport, `interactive-widget`, `dvh`/`svh`, приёмы Vaul и Ionic), и сделать так:
   - появление клавиатуры не вызывает прыжков и анимаций высоты;
   - поле остаётся видимым;
   - закрытие сначала убирает фокус (клавиатура уходит), потом анимирует шторку один раз.
   
   Проверить в эмуляции телефона и описать в отчёте, что именно было причиной.
4. **Крестик закрытия** в правом верхнем углу каждой шторки и модалки: кнопка с `aria-label` «Close», 44 px зона нажатия. Заблокированная шторка (`locked`) крестик выключает.
5. **«Add item»:** поле числа и комбобокс единицы одной высоты.
6. **Tags & fields:** кнопки сейчас больше заголовков секций. Решение [решение Claude, комбинация]:
   - заголовки секций крупнее (17 px, полужирные, цвет текста);
   - между секциями разделитель и отступ;
   - кнопки «Add …» в этих секциях тоньше (`raised-sm`, 40 px).
7. **Кнопки «Camera» и «Gallery»** в быстром добавлении и выборе фото — без неоморфизма: плоские (outline или ghost).
8. **Иерархия в левой панели** — вогнутая (concave), а не выпуклая:
   - панель дерева как «колодец» со внутренними тенями, по формуле `I(x, b)` макета;
   - строки внутри плоские, выбранная строка — `row-selected`;
   - на телефоне в выдвижном меню — то же.

Тесты в `style.test.ts`: у иконочных кнопок мобильной шапки нет `raised`; у кнопок камеры и галереи нет `raised`; у `AppSheet` есть кнопка закрытия; у панели дерева класс вогнутости. Снимки на 360 px: шапка, открытая шторка с клавиатурой (эмуляция), Tags & fields, дерево.

Commit: `fix(app): phone pass — flat header icons, prefix example, steady sheets with the keyboard, close buttons, field heights, tags & fields headings, flat photo buttons, concave tree`.

## Итоги выполнения

**Как шло.**
- Волна 1 — семь задач сразу (1, 2, 3, 5, 6, 7, 8). Волна 2 — задача 4 после задачи 2, задача 9 после задачи 3.
- Задача 10 (правки владельца после просмотра на телефоне) добавлена по ходу и шла после задачи 1.
- Владелец смотрел промежуточные сборки на телефоне: dev-сервер в режиме хоста на порту 3001, из отдельного worktree.
- Задача 2 (данные) прошла отдельное ревью. Остальные задачи вошли в итоговое ревью из двух половин: данные и интерфейс.
- Исправления по ревью шли параллельно: A и B по первой половине, C и D по второй.

**Что сделано.**
- Дизайн:
  - светлая тема по доске 7 (мягкая акцентная кнопка, свет 1.1);
  - тёмная по доске 8;
  - меню, списки выбора и выпадающие списки — стекло;
  - поле поиска палитры без акцентной рамки;
  - подсказки без двойного объявления;
  - шапка на 360 px не переполняется.
- Варианты сразу с количеством: `100n; 50V; 10`. Варианты и приходы пишутся одной транзакцией `variant.createMany`.
- `variant.setValues`: правка одного варианта и таблица значений — одна команда. Уникальность проверяется на конечном состоянии.
- Устаревшая правка отклоняется базой (GM004). Приложение синхронизируется, форма сохраняет введённое и просит проверить значения.
- Подсказка ближайших номиналов в палитре и в шторке «Поделиться».
- Выражения в полях количества и цены:
  - точная рациональная арифметика, одно округление в конце;
  - 6 знаков у количества, знаки валюты у цены;
  - предпросмотр «= …» под полем.
- Фото:
  - обложка размером `full`;
  - счётчик загрузок за месяц;
  - `photo.replace` одной командой, с id заменяемого фото;
  - честные ошибки декодирования, без увеличения;
  - WebP, где браузер умеет;
  - кэш на устройстве (CacheFirst, только CORS, 600 миниатюр и 150 больших), размер и очистка в настройках.
- Надёжность:
  - GM003 в пакете записи — источник переходит в `read_only`;
  - листинг не откатывает известную ревизию;
  - ветка «kept» пишет свои строки;
  - края подключения источников;
  - детерминированный тест параллельности на Neon.
- Быстрое добавление: черновик переживает «Open», предупреждение о ссылке без количества.
- CI на каждый push, актуальные версии actions, поле `packageManager`.
- Правки владельца с телефона:
  - плоские иконки шапки;
  - пример у приставок;
  - шторки без дёрганья при клавиатуре;
  - крестик закрытия;
  - одинаковая высота полей;
  - заголовки «Tags & fields»;
  - плоские кнопки камеры и галереи;
  - вогнутое дерево.
- Итог: `pnpm test` — 2447 пройдено, 21 пропущен (107 файлов). `typecheck` и `lint` — 0. Neon — 23 пройдено, 1 пропущен.

**Что поймали ревью.**
- **Задача 2:**
  - поздний повтор замены фото мог удалить более новое фото;
  - устаревшая правка значений молча пропускалась.
- **Данные:**
  - `x` после единицы не считался умножением;
  - двойное округление;
  - цены округлялись не по знакам валюты;
  - Chrome выдавал ошибку декодирования за «unsupported»;
  - маленькие фото увеличивались;
  - подсчёт размера кэша читал все ответы;
  - автоисправление в полях ввода;
  - переход в `read_only` отменялся поздним переподключением;
  - время листинга шло назад;
  - пересекающиеся удаления источников.
- **Интерфейс:**
  - во время ожидания клавиатуры шторка оставалась кликабельной — второе касание создавало дубль предмета;
  - ожидание клавиатуры срабатывало и на компьютере;
  - предпросмотр «— 10k» без единицы;
  - непонятная ошибка для списка через `;` у одной оси;
  - фокус во время выезда шторки оставался за ней;
  - после повторного открытия фокус не возвращался к кнопке;
  - список шире экрана на 360 px (ещё из Плана 8) уводил крестик шторки за край.

**Решения контроллера.**
- Стекло поверх фото: числа доски владельца не меняются. Сплошной фон — только при `prefers-contrast: more`.
- Клавиатура полей количества и цены пока буквенная (ради выражений). Ждёт решения владельца.
- У одной оси `a; b` теперь значение и количество. Список значений — через запятую, ошибка подсказывает это.
- G8 не делался (по спеке).
- Совпадение после «Restore» в таблице значений осталось как раньше (спека: «как сейчас»).

**Перенос.**
- Защита от одинаковых вариантов в самой базе для `createMany` (вместе с C9).
- Шторки и клавиатура на iOS не проверены. Программный фокус после выезда может не поднять клавиатуру в Safari.
- Ожидание скрытия клавиатуры ограничено 600 мс. Проверено эмуляцией, не на устройстве.
- Кэш фото вживую не проверен: нужен https, то есть развёртывание.
- `x` после своей единицы, которая сама начинается с `x`, читается как умножение.
- Стекло поверх фото: контраст ниже 4.5:1 (меню у галереи на компьютере).
- CI ещё не запускался на GitHub.
- Совпадение с доской 7 и доской 8 проверяет владелец.
