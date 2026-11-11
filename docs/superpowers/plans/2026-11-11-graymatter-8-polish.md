# План 8 — неоморфизм, запас без лишних записей, страховка данных

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Всё из спеки Плана 8. Стиль «Hybrid v2» и выбор акцента; правки интерфейса из `proposals.md`; П2, П3, П6, П7, П8, П11, П12, П14.

**Architecture:**
- **Волна 1** закладывает основу: дизайн-систему (токены, утилиты, примитивы), схему 4 с мягкими миграциями и закреплённым атрибутом, мелкие изменения данных (штуки, пересчёт, повтор пачки вариантов).
- **Волна 2** строит функции поверх неё. Каждая задача — в своём worktree. Владение файлами указано, пересечения разрешает контроллер при слиянии.

**Tech Stack:** TypeScript, Vitest, Postgres (PGlite, Neon), drizzle-kit, Nuxt 4, Vue 3, shadcn-vue/Reka, Tailwind 4, vite-pwa.

**Spec:** `docs/superpowers/specs/2026-11-11-graymatter-polish-design.md`. Каждая задача ссылается на свои разделы спеки — они и есть требования. Спека Плана 6 (синхронизация) и спека Плана 7 (варианты) действуют по-прежнему.

## Global Constraints

- **Ветки.** Работа идёт в ветке `plan8-polish`. Каждая задача — в worktree `.worktrees/p8-tN` на ветке `p8-tN` от текущей вершины `plan8-polish`. Контроллер вливает задачи, в конце `plan8-polish` вливается в `revival`.
- **Git.**
  - Никаких push, PR и Pages. Никаких строк атрибуции (`Co-Authored-By`, `Claude-Session`). Голые `stash` и `pop` запрещены.
  - Файлы добавляются только явными путями. Не добавлять `packages/app/nuxt.config.ts`, `proposals.md`, `.claude/`, `.superpowers/`, `.env.local`.
- **Инструменты и окружение.**
  - Только pnpm. Легаси `api/` и `web/` не трогать.
  - Строки подключения и ключи не печатать и не коммитить.
  - Neon — только `_test` через `GM_NEON_TEST_URL`. Набор соответствия на Neon запускает только задача, где это сказано, и никогда две одновременно.
- **Dev-сервер** — из своего worktree, порт 3001, без `--host`. Серверы владельца на 3000 и 3002 не трогать.
- **Проверка в браузере** у задач с интерфейсом — два снимка главного экрана задачи, 1280 px и 360 px (без горизонтальной прокрутки), инструментами Claude in Chrome. Без прокликивания сценариев.
- **Интерфейс.**
  - Тексты на английском в `packages/app/i18n/locales/en.json`, каждая задача — в своём пространстве ключей.
  - Цвет только по правилам спеки §4.1 и анти-цели 4.
  - Контраст текста не ниже 4.5:1.
- **Синхронизация.** Каждая новая или изменённая команда соблюдает правила Плана 6: изменённые строки или `null`, одна транзакция.
- **Числа атрибутов и количества** — без float.
- **Команды:**
  - все тесты — `pnpm test`, один файл — `pnpm vitest run <path>`;
  - `pnpm typecheck`, `pnpm lint`;
  - коды выхода проверять напрямую, а не через `| tail`.
- **Решения строителя.** Мелкие неясности строитель решает сам по спеке и пишет решение в отчёт. Останавливается, только если решение меняет то, что видит владелец, а спека молчит.

## Review Focus

1. **Медленная сеть посреди отложенной записи степпера.** Ожидающая дельта не должна ни потеряться без следа, пока вкладка жива, ни уйти дважды. Тесты в задаче 7: повтор отправки со стабильным `movementId`.
2. **Старое приложение (схема 3) на базе схемы 4.** Должно читать и писать, если `min_app_schema = 3`, а новые колонки не должны ему мешать. Тест в задаче 2: старый набор `select` по базе схемы 4.
3. **Восстановление в режиме новых id, оборванное и запущенное снова.** Ни одного дубля, ни одной ссылки на старый id. Тест в задаче 3.
4. **Тёмная тема.** Каждая пара «текст/фон» из токенов даёт контраст ≥ 4.5:1. Тест контраста по токенам в задаче 1.
5. **Вставка в палитру обычного запроса, похожего на ссылку** («tl072.pdf»). Шторка «Поделиться» открывается только для настоящего адреса или длинного заголовка (≥ 40 символов и ≥ 4 слов). Тест в задаче 10.

---

## Порядок

Порядок перестроен 2026-11-11 под полную загрузку машины.

| Фаза | Задачи (параллельно) | Зависят от |
|---|---|---|
| A | 1 (токены, утилиты, примитивы, акцент), 2 (схема 4), 4 (мелкие изменения данных), 5 (фото), 6 (сеть и стабильные id) | — |
| B | 3 (восстановление), 7 (запас), 8 (дерево и шторки), 9 (архив), 10 (списки, «уже есть», «Поделиться») | 1, 2, 4; задача 3 — от 2 |
| C | 11 (проход стиля по всем компонентам) | всё |

- Задачи 5 и 6 из фазы A не ждут основы стиля: свой интерфейс у них маленький, его выравнивает задача 11.
- Ревью по ходу — только у задач 2 и 3. Итоговое ревью идёт параллельно с задачей 11.
- **Ресурсы машины:**
  - у каждой задачи свой порт dev-сервера: `3010 + N`, например 3011 для задачи 1;
  - Vitest — `--maxWorkers=3`;
  - пока работа идёт, гонять отдельные файлы, а полный прогон делать один раз в конце.

| Приёмка спеки (§6) | Задачи |
|---|---|
| 1, 2 | 1, 11 |
| 3 | 11 |
| 4 | 8 |
| 5, 6, 7 | 8, 4 |
| 8 | 5 |
| 9, 10 | 6, 4 |
| 11 | 3 |
| 12, 13 | 2 |
| 14, 15, 16 | 10 |
| 17, 18, 20 | 7, 4 |
| 19 | 9 |
| 21 | все, итоговая проверка |

---

### Task 1: Дизайн-система «Hybrid v2» — токены, утилиты, примитивы, акцент (спека A: §4.1)

Эта задача трогает только `main.css`, `components/ui/**`, файлы акцента и раздел Appearance. Проход по компонентам приложения (курсор, радиусы, выбранные строки, палитра, кнопка инвентаря) — задача 11.

**Files:**
- Modify: `packages/app/app/assets/css/main.css`, `packages/app/app/components/ui/**`
- Create: `packages/app/app/lib/accent.ts`, `packages/app/app/components/AccentPicker.vue`
- Modify: `packages/app/app/lib/device-db.ts`, `workspace-types.ts` (`DeviceSettings.accent`), раздел Appearance в `pages/settings/index.vue`, ранний запуск акцента (плагин или `app.vue`)
- Test: `packages/app/test/accent.test.ts`, `packages/app/test/style.test.ts` (новые)

**Interfaces:**
- Produces:
  - Утилиты в `main.css`, которыми пользуются задачи второй волны:
    - `raised` — кнопка или иконочная кнопка, R(4,10) или R(3,7);
    - `raised-card` — R(6,14), радиус 20;
    - `pressable` — наведение, нажатие, переходы;
    - `row-selected` — градиент выбранной строки;
    - `pill` — степпер R(3,8);
    - токены `--surface`, `--ink`, `--muted-ink`, `--divider`, `--accent`, `--accent-ink`, `--shadow-dark`, `--shadow-light`.
  - Точные имена могут отличаться, но должны быть перечислены в отчёте и в комментарии в начале `main.css`.
  - `lib/accent.ts`:
    - `export const ACCENTS: Record<AccentName, { light: string; dark: string }>`;
    - `export type AccentName = 'indigo' | 'violet' | 'blue' | 'sky' | 'teal' | 'green' | 'orange' | 'rose' | 'pink' | 'slate'`;
    - `export function applyAccent(name: AccentName, root: HTMLElement): void`;
    - `export function isAccentName(v: unknown): v is AccentName`.
  - `DeviceSettings.accent?: AccentName`.

- [ ] **Step 1: Write failing tests.**
  - `accent.test.ts`:
    - у каждого `ACCENTS[*].light` белый текст на закраске даёт контраст ≥ 4.5:1;
    - текст выбранной строки `mix(акцент, чёрный, 0.18)` на фоне `#EDEFF3` с подложкой выбранной строки даёт ≥ 4.5:1;
    - у `dark` — светлый вариант на `#24272E` даёт ≥ 4.5:1;
    - `isAccentName('teal') === true`, `isAccentName('neon') === false`.
  - `style.test.ts`:
    - пары токенов «текст/фон» из `main.css` для обеих тем дают ≥ 4.5:1 (Review Focus 4);
    - в базовых стилях есть правило `cursor: pointer` для `button:not(:disabled), [role=button], a[href], summary`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** по спеке §4.1–4.2.
  - Числа теней — из функции `hybrid2` макета: `/private/tmp/claude-501/-Users-as-dev-graymatter/f590e304-ca87-4aa9-90ed-dd7ab6a89334/scratchpad/artifact-files/bb7b3878-c996-431a-bc51-84273d6d5954/project/ItemScreen.dc.html`, при `depth 0.9`, `light 1.2`, `shade 0.7`, `surface flat`, `primary painted`.
  - Шкала радиусов 20/14/10/круг — токенами и в примитивах.
  - Выбор акцента — в Settings → Appearance.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Затем два снимка экрана предмета (демо-источник), светлая тема, 1280 и 360 px, и один снимок тёмной темы на 1280 px.
- [ ] **Step 5: Commit** `feat(app): Hybrid v2 design tokens, utilities and primitives; accent picker`.

---

### Task 2: Схема 4, мягкие миграции, закреплённый атрибут (спека H: §4.8 — миграция и мягкие миграции; K: §4.11 — `pinned`)

**Files:**
- Create: `packages/storage-postgres/migrations/0001_*.sql` (+ `meta`)
- Modify: `packages/storage-postgres/src/schema.ts`, `migrator.ts`, `inspect.ts`, `rows.ts`, `commands/dictionaries.ts`, `commands/reads.ts`
- Modify: `packages/core/src/storage.ts` (`SchemaStatus`), `model.ts` (`Attribute.pinned`), `commands.ts`, `validate.ts`
- Modify: `packages/app/app/lib/workspace.ts` (только правило «только чтение» и баннер обновления), новый `components/UpdateToEditBanner.vue`
- Test: `packages/storage-postgres/test/migrator.test.ts`, `dictionaries.test.ts`, `patch.property.test.ts` (генератор `pinned`), `packages/core/test/validate.test.ts`, `packages/app/test/workspace.test.ts`

**Interfaces:**
- Produces:
  - `APP_SCHEMA_VERSION = 4`; `SCHEMA_BASE` по-прежнему 2.
  - `SchemaStatus { state: 'ready' | 'newer'; dbVersion: number; appVersion: number; minAppSchema: number }`. Состояние `newer` (только чтение) — только когда `minAppSchema > appVersion`.
  - `Attribute.pinned: boolean`.
  - Команда `attribute.update { …; pinned?: boolean }`.
  - Код ошибки `too_many_pinned` (больше двух закреплённых на инвентарь).
  - `gm_meta.min_app_schema = '3'` после миграции `0001`.

- [ ] **Step 1: Write failing tests.**
  - **Миграция:**
    - база схемы 3 (начальная миграция) поднимается до 4;
    - `min_app_schema = '3'`;
    - `UPDATE movements …` отклоняется триггером, `DELETE` каскадом при `deletePermanently` предмета работает;
    - у `attributes` есть `pinned boolean not null default false`.
  - **Пролог миграции** берёт `LOCK_REV`: параллельная запись ждёт миграцию. Тест: две параллельные операции на PGlite, порядок ревизий корректен.
  - **Старая схема** (Review Focus 2): чтение снимка запросами схемы 3 по базе схемы 4 работает. Взять `snapshotSql` до изменения как фикстуру.
  - **Мягкая миграция:** `ensureSchema` для приложения версии 3 на базе 4 с `min_app_schema = 3` → `state: 'ready'`; с `min_app_schema = 4` → `'newer'`.
  - **Ядро:** закрепление третьего атрибута → `too_many_pinned`; снятие закрепления всегда проходит.
  - **Workspace:** при `newer` вызывается `registration.update()` (через зависимость) и показывается баннер «Update to keep editing».
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** по спеке §4.8 и §4.11.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`; затем набор соответствия на Neon один раз (`cp /Users/as/dev/graymatter/.env.local <worktree>/.env.local`, без печати).
- [ ] **Step 5: Commit** `feat: schema 4 — journal protection, soft migrations (min_app_schema), pinned attributes`.

---

### Task 3: Восстановление из копии, напоминание, экспорт через «Поделиться» (спека H: §4.8 — всё, кроме миграции)

**Files:**
- Create: `packages/storage-postgres/src/restore.ts`, `packages/app/app/components/RestoreSheet.vue`
- Modify: `packages/storage-postgres/src/storage.ts`, `packages/core/src/storage.ts` (интерфейс), `packages/app/app/lib/backup.ts`, `device-db.ts` (дата последней копии, счётчик записей, id запусков восстановления), страница настроек источника (секция Backup)
- Test: `packages/storage-postgres/test/restore.test.ts`, `packages/app/test/backup.test.ts`

**Interfaces:**
- Consumes: схема 4 (задача 2), `BackupFile` из `lib/backup.ts`.
- Produces:
  - `InventoryStorage.restore(backup: BackupFile, mode: 'same-ids' | 'new-ids', runId: string, onProgress?: (done: number, total: number) => void): Promise<{ inventoryIds: Id[] }>`;
  - `parseBackup(json: unknown): BackupFile | { error: 'format' | 'version' | 'newer_schema' }`;
  - `restoreRunId(fileSha256: string): Promise<string>` — на устройстве; тот же файл даёт тот же id.

- [ ] **Step 1: Write failing tests** (PGlite):
  - **`same-ids`:** экспорт демо-инвентаря → пустая база → восстановление → снимок равен исходному.
  - **`new-ids`:**
    - восстановление рядом с исходным даёт второй инвентарь;
    - ни одна uuid-ссылка новой копии не указывает на id исходного (проверка по всем uuid-колонкам схемы);
    - запас и журнал совпадают по числам.
  - **Обрыв** после первого пакета и повтор с тем же `runId` — без дублей (Review Focus 3).
  - **Копия** с более новой версией схемы → `newer_schema`.
  - **Напоминание:**
    - `shouldRemindBackup({ lastBackupAt, writesSince, now })` — правда после 14 дней или 200 записей;
    - один раз за сессию.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** по спеке §4.8. Восстановление — широкая операция: после неё устройство перезагружает данные (правила Плана 6).
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`; набор соответствия на Neon один раз (только эта задача в своём окне). Два снимка секции Backup.
- [ ] **Step 5: Commit** `feat: restore from backup (same or new ids), backup reminder, share export`.

---

### Task 4: Мелкие изменения данных — штуки, пересчёт, повтор пачки вариантов (спека E: §4.5; N: §4.14 — данные; G: §4.7 — правило повтора)

**Files:**
- Modify: `packages/core/src/units.ts`, `model.ts` (`StockLine.lastCountedAt`), `validate.ts` (`variant.createMany`)
- Modify: `packages/storage-postgres/src/commands/stock.ts`, `queries.ts` или `commands/reads.ts` (агрегат запаса), `rows.ts`
- Test: `packages/core/test/units.test.ts`, `validate.test.ts`, `packages/storage-postgres/test/stock.test.ts`, `snapshot.test.ts`

**Interfaces:**
- Produces:
  - `BUILTIN_UNITS.pcs.prefixPowers = [3, 6]`.
  - `StockLine.lastCountedAt: string | null` — последний `adjustment` корзины.
  - `stock.set` при совпадении пишет `adjustment` на 0.
  - `variant.createMany`: id, который уже принадлежит варианту этого предмета с теми же значениями осей, — повтор. Пачка проходит, а для повторённого варианта база ничего не пишет. Id чужого предмета или с другими значениями → `invalid_option`.

- [ ] **Step 1: Write failing tests:**
  - `parseAmount('1.5k', pcs) === '1500'`; `formatAmount('1500', pcs) === '1.5 kpcs'` — проверить, как показываются приставки у штук сейчас, и закрепить ожидаемый вид;
  - `stock.set` с текущим значением → одна строка `adjustment` с количеством `0`, итог не меняется, `lastCountedAt` равен её времени;
  - повтор той же команды с тем же `movementId` → строк по-прежнему одна;
  - `createMany` повтором (те же id и значения) → проходит проверку ядра и не меняет базу; с id чужого предмета → `invalid_option`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Показ штук с приставкой: если `kpcs` выглядит плохо, строитель выбирает показ `1.5k` без «pcs» и пишет решение в отчёт.
- [ ] **Step 4: Run** `pnpm vitest run packages/core/test packages/storage-postgres/test`, `pnpm typecheck` (ошибки в приложении из-за `lastCountedAt` поправить минимально).
- [ ] **Step 5: Commit** `feat: piece prefixes k/M, recounts always leave a trace, retried variant batches are no-ops`.

---

### Task 5: Хранилища фото Cloudinary и Imgur (спека F: §4.6)

**Files:**
- Create: `packages/files-cloudinary/**`, `packages/files-imgur/**` (по образцу `packages/files-uploadcare`)
- Modify: `packages/app/app/lib/csp.ts`, функция адреса миниатюры (`photoUrl`), место настройки хранилища фото (найти по коду Uploadcare), `pnpm-workspace.yaml`, если нужно
- Test: `packages/files-cloudinary/test/*.test.ts`, `packages/files-imgur/test/*.test.ts`, `packages/app/test/csp.test.ts`, `photo-url.test.ts`

**Interfaces:**
- Consumes: `FileStore`, `StoredFile`, `FileError` из `packages/core/src/files.ts`.
- Produces:
  - `createCloudinaryStore({ cloudName, uploadPreset }): FileStore` с `provider = 'cloudinary'`;
  - `createImgurStore({ clientId }): FileStore` с `provider = 'imgur'`;
  - `photoUrl(photo, size)` по провайдеру.

- [ ] **Step 1: Write failing tests** (запросы через подменённый `fetch`):
  - успешная загрузка → `StoredFile` с адресом;
  - 4xx → `rejected`, 413 → `too_large`, сеть → `unavailable`;
  - `photoUrl` для каждого провайдера даёт адрес миниатюры по правилам §4.6;
  - CSP содержит четыре новых хоста.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Снимки настроек хранилища фото.
- [ ] **Step 5: Commit** `feat: Cloudinary and Imgur photo stores`.

---

### Task 6: Сеть и стабильные id (спека G: §4.7, кроме правила повтора из задачи 4)

**Files:**
- Create: `packages/app/app/composables/useCommandIds.ts`, `packages/app/app/lib/diagnostics.ts`, `packages/app/app/lib/traffic.ts`
- Modify:
  - `packages/storage-postgres/src/executors/neon-http.ts` и `neon-ws.ts` (раздельные таймауты, признак лимита);
  - `packages/app/app/lib/workspace.ts` (состояние `quota`, прогрев, журнал ошибок);
  - `lib/quick-add.ts`, `lib/stock-forms.ts`;
  - формы `QuickAddForm`, `StockSheet`, `ItemForm`, `FolderForm`, `VariantsForm`, `LooseTransferSheet`, `AttributeForm`, `UnitForm`, `InventoryForm` — только id;
  - настройки: Diagnostics, счётчик трафика в карточке источника, баннер `quota`.
- Test: `packages/app/test/quick-add.test.ts`, `stock-forms.test.ts`, новые `diagnostics.test.ts`, `traffic.test.ts`, `command-ids.test.ts`; `packages/storage-postgres/test/timeout.test.ts`

**Interfaces:**
- Consumes: правило повтора `variant.createMany` (задача 4).
- Produces:
  - `useCommandIds<K extends string>(keys: readonly K[]): { ids: Readonly<Record<K, Id>>; renew(): void }`;
  - `logError(where: string, error: unknown): void`, `readErrors(): Promise<DiagnosticEntry[]>` — секреты вычищены;
  - `SourceStatus` получает `'quota'`, если признак надёжен (спека §4.7).

- [ ] **Step 1: Write failing tests:**
  - сборщики команд с одинаковыми id дают одинаковые команды; повторная отправка быстрого добавления в хранилище (PGlite) не создаёт второй предмет (приёмка 9);
  - `logError` с текстом, содержащим `postgresql://user:pw@host/db` и ключ из настроек, — в записи их нет;
  - таймаут записи 15 с до первого байта; чтение, которое начало отвечать, не обрывается до 90 с (поддельный `fetch` с медленным телом);
  - прогрев: один запрос при открытии формы после 4 минут тишины, ни одного раньше и ни одного по таймеру;
  - счётчик трафика суммирует байты ответов за календарный месяц.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Признак лимита Neon — по документации Neon. Если надёжного нет, состояние `quota` не делается, и это пишется в отчёт.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Снимки Diagnostics.
- [ ] **Step 5: Commit** `feat: stable command ids, split timeouts, on-device error log, warm-up and traffic estimate`.

---

### Task 7: Запас — отложенный степпер, карточка, количество по касанию, пересчёт и история (спека L: §4.12; N: §4.14 — интерфейс)

**Files:**
- Create: `packages/app/app/lib/stepper.ts`, `packages/app/app/components/CountFolderSheet.vue` (или страница)
- Modify: `StockCard.vue`, `BucketList.vue`, `JournalList.vue`, `FolderActions.vue` (пункт «Count this folder»), `lib/item-view.ts` (журнал по дням, бегущий остаток), `lib/workspace.ts` (блокировка по корзине)
- Modify: `en.json` — ключи `stock.*`, `journal.*`, `countFolder.*`
- Test: `packages/app/test/stepper.test.ts`, `item-view.test.ts`, `workspace.test.ts`

**Interfaces:**
- Consumes: `StockLine.lastCountedAt`, `stock.set` с нулевым `adjustment` (задача 4); утилиты стиля (задача 1).
- Produces:
  - `createStepper(opts: { delayMs: number; send: (delta: Quantity, movementId: Id) => Promise<void>; now?: () => number })`, который возвращает `{ press(step: 1 | -1): void; undo(): void; flush(): Promise<void>; pending: Readonly<Ref<Quantity>>; state: Readonly<Ref<'idle' | 'waiting' | 'sending' | 'failed'>> }`;
  - `movementId` одной отложенной отправки стабилен при повторе (Review Focus 1);
  - блокировка корзины в workspace — `isBucketSaving(itemId, variantId): boolean` (имя на усмотрение, но одно для всех степперов).

- [ ] **Step 1: Write failing tests** `stepper.test.ts` (поддельные таймеры):
  - пять `press(1)` за 1 с → через 2 с одна отправка на 5;
  - `undo()` до отправки → ни одной;
  - `flush()` при `visibilitychange` → отправка сразу;
  - сбой → состояние `failed`, повтор отправляет тот же `movementId`;
  - «−» ниже нуля не уходит в отрицательное ожидание.
  
  Также:
  - `item-view`: журнал по дням (Today, Yesterday, дата) с бегущим остатком; строка `adjustment` на 0 → «Counted»;
  - `workspace`: во время записи в одну корзину другие корзины и формы не заблокированы.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** по спеке §4.12 и §4.14:
  - карточка запаса;
  - касание числа открывает Count;
  - «Counted … ago»;
  - строки вариантов с пилюлей;
  - вибрация;
  - «Count this folder».
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Снимки экрана предмета.
- [ ] **Step 5: Commit** `feat(app): deferred stepper, new stock card, count by tapping the number, counted trace and day-grouped history, count a folder`.

---

### Task 8: Дерево, шторки, единицы (спека C: §4.3, кроме строк предметов; D: §4.4; E: §4.5 — интерфейс)

**Files:**
- Modify: `FolderTree.vue`, `FolderTreeNode.vue`, `TreePanel.vue`, `NavDrawer.vue`, `FolderList.vue`, `lib/views.ts` (сумма штук по папке, без строк предметов), `lib/tree-state.ts`
- Modify: `AppSheet.vue` (Ctrl/⌘+Enter, строка описания), `lib/item-view.ts` (`bucketDescription`), шторки предмета (передают описание), `FolderForm.vue` и `FolderDialogs.vue` (выбор родителя), `UnitForm.vue`, `UnitsSection.vue`
- Modify: `en.json` — ключи `tree.*`, `sheet.*`, `unitForm.*`, `folderForm.*`
- Test: `views.test.ts`, `tree-state.test.ts`, новые `sheet-keys.test.ts`, `tree-width.test.ts`; `item-view.test.ts` (описание)

**Interfaces:**
- Consumes: утилиты стиля (задача 1), `pcs` с приставками (задача 4).
- Produces:
  - `TreeNode.pieces: Quantity | null` вместо `itemCount` (null — в поддереве нет штук). Так же для `FolderRow` и корня;
  - `bucketDescription(s: InventorySnapshot, itemId: Id, variantId: Id | null): string`;
  - проп `AppSheet` для основного действия (имя на усмотрение) и обработчик Ctrl/⌘+Enter.

- [ ] **Step 1: Write failing tests:**
  - сумма штук по поддереву без метров и граммов, без архивных; папка только с метрами → `null`;
  - клик по не-текущей папке выбирает, по текущей переключает раскрытие;
  - ширина: ограничение 200 px … 50 % окна, запись и чтение `gm.treeWidth` в `try/catch` (`localStorage`, который бросает);
  - `bucketDescription` → «10 kΩ · Резистор 0,25 Вт · 5 %» (не больше трёх общих атрибутов);
  - Ctrl+Enter и ⌘+Enter в шторке вызывают основное действие, Enter в `textarea` — нет.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** по спеке §4.3–4.5:
  - перетаскиваемый край с `role="separator"` и стрелками;
  - выбор родителя в «New folder»;
  - пояснения к приставкам в «New unit»;
  - приставки штук в Tags & fields.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Снимки дерева и шторки Use.
- [ ] **Step 5: Commit** `feat(app): tree select-then-toggle, piece sums, resizable sidebar, full sheet descriptions, Ctrl+Enter, parent folder for new folders, prefix notes`.

---

### Task 9: Архив сразу, с «Undo» (спека M: §4.13)

**Files:**
- Create: `packages/app/app/lib/undo.ts`
- Modify: `ItemDialogs.vue`, `FolderDialogs.vue`, `ItemScreen.vue` (архив варианта), `ItemActions.vue`, `FolderActions.vue`, полоса тостов
- Modify: `en.json` — ключи `undo.*`
- Test: новый `packages/app/test/undo.test.ts`

**Interfaces:**
- Produces: `undoToast(label: string, undo: Command, opts?: { minMs?: number }): void`. Минимум 6 с, пауза при наведении и касании, Ctrl/⌘+Z, пока виден, переживает переход.

- [ ] **Step 1: Write failing tests:**
  - архивация вызывает `archive` сразу, без шторки;
  - «Undo» шлёт `restore` с тем же `archiveId`;
  - Ctrl+Z после скрытия тоста ничего не делает;
  - `ConfirmSheet` остаётся для `deletePermanently` и архивации инвентаря.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Снимок тоста.
- [ ] **Step 5: Commit** `feat(app): archive at once with Undo`.

---

### Task 10: Списки, «уже есть», «Поделиться» (спека I: §4.9; J: §4.10; K: §4.11 — интерфейс; строки предметов из §4.3)

**Files:**
- Create: `packages/app/app/lib/share.ts`, `packages/app/app/pages/share.vue`, `packages/app/app/lib/monogram.ts`
- Modify: `QuickAddForm.vue` и `lib/quick-add.ts` (совпадения), `ItemList.vue` и `lib/views.ts` (`ItemRow`: корзины, монограмма, закреплённые чипы, единица суффиксом), `SearchPalette.vue` и `lib/palette.ts` (вставка ссылки, закреплённые чипы), `ItemScreen.vue` (закреплённые чипы в шапке, «Find in shops»), `AttributeForm.vue` (переключатель «Show in lists»), манифест PWA в `nuxt.config.ts` — **только если `share_target` нельзя добавить иначе; тогда — отдельным коммитом, без правки владельца `devServer`**
- Modify: `packages/storage-postgres/src/queries.ts` и `storage.ts`, `packages/core/src/storage.ts` — `findReceiptsBySource`
- Modify: `en.json` — ключи `share.*`, `quickAdd.*`, `list.*`, `shops.*`
- Test: новые `share.test.ts`, `monogram.test.ts`; `quick-add.test.ts`, `views.test.ts`, `palette.test.ts`; `packages/storage-postgres/test/` — `findReceiptsBySource`

**Interfaces:**
- Consumes: `Attribute.pinned` (задача 2), утилиты стиля (задача 1).
- Produces:
  - `existingMatches(name: string, s: InventorySnapshot, limit = 3): MatchRow[]`;
  - `parseShare(input: { title?: string; text?: string; url?: string }): { query: string; url: string | null; lotKey: string | null }`;
  - `isShareLike(text: string): boolean` (Review Focus 5);
  - `InventoryStorage.findReceiptsBySource(inventoryId: Id, key: string): Promise<{ at: string; itemId: Id; variantId: Id | null; quantity: Quantity }[]>`;
  - `monogram(name: string): string`;
  - `ItemRow.buckets: { label: string; number: string; empty: boolean }[]`, `ItemRow.moreBuckets: number`, `ItemRow.pinned: string[]`.

- [ ] **Step 1: Write failing tests:**
  - **«Уже есть»:** «ne5532» → `NE5532P`; «tl072» → `TL072CP` по префиксу номера детали; число по правилам атрибута;
  - **разбор ссылок:**
    - `parseShare({ text: '600PCS 1/4W Metal Film Resistor 1% 10K 4.7K https://www.aliexpress.com/item/1005001234567890.html' })` → очищенный запрос без `600PCS`, `lotKey === '1005001234567890'`;
    - `isShareLike('tl072.pdf') === false`;
  - **монограммы:** `monogram('TL072 op-amp') === 'TL'`, `monogram('Резистор') === 'Ре'` — по правилу §4.11;
  - **строка резистора:** корзины `1 kΩ 3 · 10 kΩ 100 · …`, «+N» после четырёх;
  - **`findReceiptsBySource`** находит получения с этим id лота в `source_url`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** по спеке §4.9–4.11. `share_target` — в манифесте PWA.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Снимки списка папки и шторки `/share?text=…`.
- [ ] **Step 5: Commit** `feat(app): lists show buckets, monograms and pinned values; "you already have it"; share target and pasted links`.

---

### Task 11: Проход стиля по всем компонентам (спека A, B: §4.1, §4.2)

**Files:**
- Modify: стилевые классы во всех `packages/app/app/components/*.vue` и `pages/**`
- Test: `packages/app/test/style.test.ts`

**Interfaces:**
- Consumes: утилиты и токены задачи 1; все компоненты после фаз A и B.

- [ ] **Step 1: Write failing tests** в `style.test.ts`. Все `.vue` в `components/` и `pages/`: элемент с `@click`, который не `button` и не `a`, без `role="button"` и `tabindex` — нарушение; список нарушений пуст.
- [ ] **Step 2: Run** — FAIL (если есть нарушения).
- [ ] **Step 3: Implement** по спеке §4.1–4.2:
  - выпуклые кнопки и карточки, плоские списки;
  - выбранные строки (дерево, палитра, текущий вариант) — `row-selected`;
  - шкала радиусов и правило «вложенный не круглее родителя»;
  - палитра в тёмной теме;
  - наведение на кнопку инвентаря;
  - новые компоненты фаз A и B приводятся к тем же утилитам.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Снимки: экран предмета (1280 и 360 px), тёмная тема на 1280 px, палитра.
- [ ] **Step 5: Commit** `style(app): Hybrid v2 across all screens; pointer cursors; radius scale; selected rows`.
