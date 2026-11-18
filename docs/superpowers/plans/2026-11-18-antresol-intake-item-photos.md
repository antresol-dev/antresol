# Несколько фото у нового предмета в поступлении — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Новый предмет в черновике поступления несёт несколько фото (его галерея); при проведении они попадают в галерею предмета в том же порядке, первое — обложка.

**Architecture:** Поле `photo` + `photoId` у `DraftNewItem` заменяется списком `photos` (у каждого фото свой id, выданный при добавлении, — повтор проведения ничего не создаёт дважды). Ядро проверяет и проводит список; `kit`, MCP и приложение работают со списком. Варианты не меняются: у варианта по-прежнему одно фото (правило приложения).

**Tech Stack:** TypeScript, Vitest, PGlite, Nuxt 4 / Vue 3, `@modelcontextprotocol/sdk`.

**Spec:** короткий дизайн — в этом файле (раздел «Дизайн»), согласован с владельцем в чате 2026-11-18. Действуют спеки `2026-11-17-…-intake-full-entities`, `2026-11-16-…-intake-entities`, `2026-11-14-…-mcp`, `2026-11-13-…-intakes`.

## Дизайн

- **Только новые предметы** (владелец, 2026-11-18). Существующие предметы через поступление фото в галерею не получают (кроме уже существующего поведения строки без осей); это — на потом.
- **Черновик:** `DraftNewItem.photos?: DraftItemPhoto[]`, где `DraftItemPhoto = PhotoFile & { id: Id }`. Порядок = порядок в галерее, первое — обложка. Старые `photo`/`photoId` удаляются; совместимость со старыми черновиками и копиями не нужна (владелец: реальных данных нет, миграции MVP будут слиты).
- **Предел:** не больше `MAX_DRAFT_ITEM_PHOTOS = 20` фото у одного нового предмета **[Claude's call]**: у галереи приложения предела нет, но черновик — одна запись jsonb, а MCP загружает каждое фото по очереди.
- **Строка нового предмета без осей:** её фото **добавляется** в `photos` предмета (если такого файла там ещё нет), а не заменяет фото предмета. Убрать или сменить фото в строке не трогает галерею — галерея правится на карточке предмета / `update_new_item`. При проведении фото строки, совпавшее с любым фото предмета (provider + fileId), второй раз не добавляется.
- **MCP:** у нового предмета в `add_intake_lines` и `update_new_item` поле `photos: string[]` (пути из `list_photos`). В `update_new_item` переданный список **заменяет** весь прежний (пустой — убирает все), отсутствие поля — оставляет как есть. Пробный прогон до загрузки сохраняется. Старое поле `photo` у нового предмета убирается. Отказ «give the photo once…» (строка и предмет с фото одновременно) снимается: фото строки дописывается в галерею. Ответы и `get_intake` показывают `photos` (urls по порядку).
- **Приложение:** на карточке нового предмета — ряд миниатюр (по порядку) с кнопкой «Add photo» и × на каждой; первая подписана как обложка. Перетаскивания нет. Строка и шторка строки показывают первое фото предмета там, где сейчас показывают `item.photo`.

## Global Constraints

- **Место:** worktree `/Users/as/dev/graymatter/.worktrees/mcp`, ветка `mcp`. Не пушить, не вливать в `master`, без тегов. Сервер владельца на 3021 работает из этого worktree — не останавливать, второй `nuxt dev` здесь не запускать.
- **Git:** без строк атрибуции; без голых `git stash`; явные пути; не добавлять `packages/app/nuxt.config.ts`, `proposals.md`, `.claude/`, `.superpowers/`, `.env.local`, `Claude outputs/`, `dist/`, `*.mcpb`.
- **Черновик:** `rev` не меняется; всё настоящее — только в атомарном `intake.commit`; повтор проведения ничего не создаёт дважды (id фото выдаются при добавлении в черновик и не меняются).
- **Варианты:** не больше одного фото — правило не меняется.
- **Интерфейс:** английские тексты в `en.json`; дизайн-система `docs/superpowers/plans/2026-11-13-antresol-12-design-system.md`; цели ≥ 44 px; подписи по `--field-inset`.
- **Команды:** `pnpm vitest run <path>`, тяжёлые с `--maxWorkers=3`; `pnpm typecheck`; `pnpm lint`.

## Review Focus

1. **Повтор проведения:** провести черновик с тремя фото дважды (после неизвестного исхода) — в галерее три фото, не шесть. Тест в задаче 1.
2. **Фото строки, совпавшее с фото предмета:** строка без осей с тем же файлом, что второе фото предмета, — в галерее одно такое фото. Тест в задаче 1.
3. **Порядок:** фото проводятся в порядке списка; первое — обложка (наименьшая позиция). Тест в задаче 1.
4. **Восстановление копии с новыми id:** id всех фото нового предмета переименованы, ссылки не потеряны. Тест в задаче 1.
5. **MCP: отказ после загрузки** — неправильный путь во втором фото отказывает в пробном прогоне, ничего не загружено. Тест в задаче 2.

---

### Task 1: Ядро, хранилище, резервные копии

**Files:**
- Modify: `packages/core/src/intakes.ts` (`DraftNewItem`, проверка нового предмета ~:369, `buildIntakeCommit` ~:549-590), `packages/core/src/limits.ts` (или рядом с `MAX_PINNED_ATTRIBUTES`) — `MAX_DRAFT_ITEM_PHOTOS`
- Modify: `packages/storage-postgres/src/restore.ts:~302` (переименование id фото)
- Modify: `packages/app/app/lib/backup.ts:~224, ~372` (форма нового предмета в копии)
- Test: тесты ядра по поступлениям, `packages/storage-postgres/test/restore.test.ts`, тест разбора копии в приложении

**Interfaces:**
- Produces: `export interface DraftItemPhoto extends PhotoFile { id: Id }`; `DraftNewItem.photos?: DraftItemPhoto[]` (без `photo`/`photoId`); `export const MAX_DRAFT_ITEM_PHOTOS = 20` из `@antresol/core`.

- [ ] **Step 1: Тесты (падают):** `buildIntakeCommit` у нового предмета с тремя фото даёт три `photos` с `variantId: null` в порядке списка и их id; строка без осей с файлом, равным второму фото предмета, не добавляет четвёртое; строка без осей с другим файлом добавляет его; проверка нового предмета: 21 фото → `invalid_value`, два фото с одинаковым id → `invalid_value`; повторное применение проведения (копия уже содержит фото) — валидно и ничего не добавляет; восстановление копии с новыми id переименовывает id каждого фото; разбор копии принимает `photos` и отбрасывает запись с фото без id.
- [ ] **Step 2: Реализация** по разделу «Дизайн». В `buildIntakeCommit` проверка «это фото предмета» — по любому элементу `photos` (provider + fileId).
- [ ] **Step 3:** `pnpm vitest run packages/core packages/storage-postgres/test/restore.test.ts packages/app/test/<backup test>` — PASS; `pnpm typecheck` — чисто: места `kit`/MCP/приложения, читающие старые поля, в этой задаче получают только минимальную правку (`photo` → `photos?.[0]`, запись — одноэлементный список с новым id), полноценно их переделывают задачи 2 и 3.
- [ ] **Step 4: Commit** `feat(core): new intake items carry several photos (their gallery)`.

### Task 2: `kit` и MCP

**Files:**
- Modify: `packages/kit/src/intake-draft.ts:~162` (выдача id фото), `packages/kit/src/intake-line.ts:~417-426` (фото строки без осей дописывается в `photos`)
- Modify: `packages/mcp/src/tools/drafts.ts` (схемы `add_intake_lines`/`update_new_item`: `photos: string[]` вместо `photo`; пробный прогон; загрузка по очереди; `markPhotosUsed` по каждому; снять отказ «give the photo once»), `packages/mcp/src/shape.ts:~224` (`photos: string[]` urls), описания инструментов и промпт `intake_from_photos` (несколько фото одного предмета — в `photos`, первое — обложка)
- Test: тесты `kit` по черновику/строке, тесты MCP (`declare.test.ts` или соседний файл по фото)

**Interfaces:**
- Consumes: `DraftItemPhoto`, `MAX_DRAFT_ITEM_PHOTOS` (Task 1).
- Produces: `withNewItem` сохраняет `photos` и выдаёт id фото без id; `buildDraftLine` для нового предмета без осей дописывает фото строки в `photos` (без дубля по provider + fileId).

- [ ] **Step 1: Тесты (падают):** `kit` — фото строки без осей дописывается и не дублируется; MCP — новый предмет с `photos: [a, b, c]` → в черновике три фото по порядку; `update_new_item` с `photos: [b]` оставляет одно, с `[]` — ни одного, без поля — не трогает; 21 путь → отказ до загрузки; неверный второй путь → отказ в пробном прогоне, ни одной загрузки; строка без осей с фото у предмета с фото — принята, фото дописано.
- [ ] **Step 2: Реализация** по разделу «Дизайн».
- [ ] **Step 3:** `pnpm vitest run packages/kit packages/mcp` — PASS; `pnpm --filter @antresol/mcp run pack:mcpb` собирается.
- [ ] **Step 4: Commit** `feat(mcp): new items in intakes take several photos`.

### Task 3: Приложение

**Files:**
- Modify: `packages/app/app/components/IntakeNewItemCard.vue:~226-250` (ряд миниатюр, Add photo, × на каждой, подпись обложки), `IntakeLineRow.vue:~55`, `IntakeLineSheet.vue:~597` (первое фото предмета), `IntakeRecord.vue` при необходимости, `i18n/locales/en.json`
- Test: тесты компонентов поступлений, где они есть для карточки нового предмета

**Interfaces:**
- Consumes: `DraftNewItem.photos` (Task 1), helpers `kit` (Task 2).

- [ ] **Step 1: Тест (падает):** карточка с двумя фото показывает две миниатюры, × на второй оставляет одно; Add photo дописывает в конец.
- [ ] **Step 2: Реализация** по разделу «Дизайн»; × — цель 44 px с `aria-label` «Remove photo N».
- [ ] **Step 3:** `pnpm vitest run packages/app` (`--maxWorkers=3`), `pnpm typecheck`, `pnpm lint` — 0 ошибок. Один снимок экрана карточки на 360 px в demo на отдельном порту из отдельного worktree (или пропустить, если demo не даёт фото — тогда так и записать).
- [ ] **Step 4: Commit** `feat(app): new intake item card shows and edits several photos`.

## Порядок

1 → 2 → 3, одна ветка `mcp`, без параллельных worktree (изменения маленькие и связаны типами). Ревью: после задачи 1 (данные), задачи 2–3 — одним итоговым ревью. Затем пересобрать `.mcpb` в `Claude outputs/antresol-mcp/`.

## Перенос на потом (carry-over)

- Дописывать фото в галерею **существующего** предмета через поступление.
- Перестановка фото и выбор обложки в карточке нового предмета (сейчас — порядок добавления).
- Инструмент MCP `usage_summary` (оценка токенов и цены) — ждёт решения владельца.
