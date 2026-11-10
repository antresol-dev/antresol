# GrayMatter — План 4: фото

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Фото предметов и вариантов. Нужны:
- интерфейс файлов в `core` и пакет `files-uploadcare`;
- уменьшение до 2048 px на устройстве;
- галерея предмета с обложкой, фото варианта и фото в быстром добавлении;
- миниатюры в списках и палитре;
- хранилище фото на устройстве для демо-источника.

**Architecture:**
- **Что уже есть.** Ядро и хранилище умеют `photo.add`, `photo.remove` и `photo.reorder`, в снимке есть `photos`. `views.ts` уже даёт `ItemRow.coverUrl`. План добавляет загрузку файлов и интерфейс.
- **`core/src/files.ts`** — интерфейс `FileStore` и `FileError`, без зависимостей.
- **`packages/files-uploadcare`** — реализация для Uploadcare: загрузка из браузера по публичному ключу, ссылки CDN с преобразованиями для миниатюр.
- **`app/lib/device-files.ts`** — хранилище фото в IndexedDB для демо-источника. **[решение Claude]** Без него демо не может показать фото, а проверять фото можно только с ключом владельца. Это же хранилище — задел под будущий локальный режим.
- **Workspace** выбирает хранилище по источнику:
  - Neon с ключом Uploadcare → Uploadcare;
  - демо → устройство;
  - Neon без ключа → загрузки нет.
- **Компоненты** показывают фото через один `PhotoImg`. Он сам понимает, ссылка это Uploadcare (добавляет преобразования) или `device:` (достаёт файл из IndexedDB).

**Tech Stack:** без новых зависимостей. Fetch, `createImageBitmap`, canvas — встроенные. Новый пакет `files-uploadcare` устроен как `core`: TypeScript и Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-graymatter-revival-design.md`, пункты 2 (цели 9), 3, 4 (интерфейс файлов), 4.6 (быстрое добавление, карточка); каркас — `docs/superpowers/specs/2026-11-10-graymatter-shell-design.md`.

**Предыдущие планы:** 1–3 выполнены.

## Global Constraints

- **Фото не хранятся в Neon.** В базе только строка `photos` (provider, fileId, url, position).
- **Перед загрузкой фото уменьшается на устройстве** до 2048 px по длинной стороне с учётом EXIF-поворота. Формат JPEG, качество 0.85. **[решение Claude: JPEG — самый совместимый; формат при выдаче выбирает CDN, `-/format/auto/`]**
- **Uploadcare:**
  - загрузка из браузера по публичному ключу;
  - файл должен храниться постоянно: флаг store при загрузке;
  - миниатюры строятся преобразованиями в URL;
  - из приложения файлы не удаляются, секретного ключа нет. После `photo.remove` и окончательного удаления предмета файлы остаются в Uploadcare — осознанный компромисс из спеки.
- **Порядок записи: сначала загрузка, потом `photo.add`.**
  - Если загрузка не удалась, строки в базе нет.
  - Если не удалась запись, в Uploadcare остаётся «сирота» — допустимо.
  - Без связи, при `state.readOnly` или без хранилища загрузка не начинается.
- **Одно фото на вариант** — правило ядра. Замена фото варианта — `photo.remove` старого, потом `photo.add` нового.
- **Остальное — как в плане 3:**
  - тексты через i18n `en`, без `v-html`;
  - только токены цветов, нейтральные действия;
  - зоны нажатия ≥ 44 px, на 360 px нет горизонтальной прокрутки;
  - hover через `hover:`, `motion-safe:`/`motion-reduce:`;
  - без оптимистичных обновлений: после записи снимок перезагружается;
  - шторки с `locked`, пока идёт запись.
- **Лимиты Uploadcare Free на 2026-11-11** (официальная страница цен и документация по биллингу, проверено ночным исследованием):
  - 1000 операций в месяц: загрузка — 1 операция, первый (не из кеша CDN) запрос картинки с любыми параметрами — 1 операция, запросы из кеша бесплатны;
  - 1 ГБ хранения без сброса, 5 ГБ трафика в месяц, только личное использование;
  - при превышении сервис приостанавливается до следующего месяца.

  Цифры в спеке (3 ГБ / 30 ГБ / 3000 загрузок) устарели. **[решение Claude]** Uploadcare остаётся первым адаптером, как в спеке. Для личного темпа хватает примерно 200–250 новых фото в месяц, а `FileStore` позволяет добавить S3-совместимое хранилище (R2/B2) следующим адаптером — предложение ночного обзора. Отсюда требования:
  - `PhotoImg` при ошибке загрузки показывает placeholder и не ломает экран: при приостановке фото пропадают, инвентарь работает;
  - миниатюры строятся преобразованиями — первое обращение к любому варианту стоит одинаково, а `-/format/auto/` экономит трафик;
  - README и подсказка в настройках называют настоящие лимиты.
- **Секреты.** Публичный ключ Uploadcare не секрет, но живёт в конфиге источника на устройстве, как и раньше. Строка подключения не попадает в запросы к Uploadcare и в тексты ошибок.
- **Проверки:**
  - `pnpm test`, `pnpm typecheck`, `pnpm lint` зелёные после каждой задачи;
  - проверка в браузере — только общая картина: 1–2 снимка экрана (указание владельца);
  - stage только своих файлов. Не трогать `packages/app/nuxt.config.ts`: там незакоммиченная правка владельца. Не трогать `.claude/` и `.superpowers/`;
  - коммиты без трейлеров;
  - `api/` и `web/` не трогать;
  - `.env.local` не читать.

## Review Focus

1. **Загрузка обрывается или нет сети.**
   - Ожидание: строки фото в базе нет, ошибка понятна, есть Retry.
   - В быстром добавлении предмет всё равно создан, а toast говорит, что фото можно добавить из карточки.
   - Тесты `addPhotos` в Task 4, `QuickAddForm` в Task 6.
2. **Огромное фото с камеры** (50 Мп, 12 МБ) **и неподдерживаемый формат** (HEIC на десктопе, PDF, видео).
   - Ожидание: уменьшено до ≤ 2048 px без зависания вкладки; неподдерживаемое — ошибка `unsupported` у поля.
   - Тесты `fitWithin` и проверки типа в Task 1. Реальная камера — приёмка владельцем.
3. **Неверный ключ Uploadcare или включены подписанные загрузки.**
   - Ожидание: ошибка «Uploadcare refused the upload — check the public key and that signed uploads are off» с ссылкой в настройки источника.
   - Тесты сопоставления ответов в Task 2.
4. **Источник только для чтения или без связи, пока открыта карточка.**
   - Ожидание: кнопки добавления фото выключены, загрузка не начинается.
   - Тест в Task 4.
5. **Демо-фото с устройства.**
   - Ожидание: object URL создаются один раз на файл и не текут при прокрутке длинного списка. Удалённое фото не ломает список (placeholder).
   - Тесты `device-files` в Task 3.

---

## Структура файлов

```
packages/core/src/files.ts                 FileStore, StoredFile, FileError, FILE_ERROR_CODES (Task 1)
packages/files-uploadcare/                 новый пакет (Task 2)
  package.json, tsconfig.json, vitest.config.ts, src/index.ts, test/uploadcare.test.ts
packages/app/app/lib/
  images.ts                                fitWithin, isImageType, prepareImage (Task 1)
  photo-url.ts                             photoUrl(url, size), isUploadcareUrl, isDeviceUrl (Task 1)
  device-files.ts                          createDeviceFileStore, resolveDeviceUrl (Task 3)
  workspace.ts / workspace-types.ts        fileStoreFor, addPhotos, removePhoto, makeCover, setVariantPhoto (Task 4)
packages/app/app/components/
  PhotoImg.vue                             (Task 5)
  ItemGallery.vue, PhotoViewer.vue, PhotoPicker.vue  (Task 5)
  ItemList.vue, SearchPalette.vue, BucketList.vue, QuickAddForm.vue, SourceForm.vue  (Tasks 5–7)
packages/app/test/
  images.test.ts, photo-url.test.ts, device-files.test.ts, workspace.test.ts (+), quick-add.test.ts (+)
```

---

### Task 1: Интерфейс файлов и подготовка изображений

**Files:**
- Create: `packages/core/src/files.ts` (+ экспорт из `index.ts`), `packages/core/test/files.test.ts`
- Create: `packages/app/app/lib/images.ts`, `packages/app/app/lib/photo-url.ts`, `packages/app/test/images.test.ts`, `packages/app/test/photo-url.test.ts`

**Interfaces:**

```ts
// core/src/files.ts
export interface StoredFile { provider: string; fileId: string; url: string }
export interface FileStore {
  readonly provider: string
  upload(file: Blob, name: string, signal?: AbortSignal): Promise<StoredFile>
}
export const FILE_ERROR_CODES = ['no_store', 'unsupported', 'too_large', 'rejected', 'unavailable', 'failed'] as const
export type FileErrorCode = (typeof FILE_ERROR_CODES)[number]
export class FileError extends Error { readonly code: FileErrorCode }   // name 'FileError'

// app/lib/images.ts
export const MAX_SIDE = 2048
export const MAX_INPUT_BYTES = 40 * 1024 * 1024
/** Scales down to fit max on the longer side, never up; integers ≥ 1. */
export function fitWithin(width: number, height: number, max?: number): { width: number; height: number }
/** image/jpeg, image/png, image/webp, image/gif, image/avif, image/heic, image/heif → true for the first five; HEIC/HEIF only when the browser can decode it (decided in prepareImage). */
export function isImageType(type: string): boolean
/** Decodes with createImageBitmap(file, { imageOrientation: 'from-image' }), draws into a canvas sized by fitWithin, encodes JPEG 0.85.
 *  FileError('unsupported') for non-images or undecodable files; FileError('too_large') above MAX_INPUT_BYTES. */
export function prepareImage(file: File): Promise<Blob>

// app/lib/photo-url.ts
export type PhotoSize = 'thumb' | 'card' | 'full'      // 160, 800, 2048 px
export function isUploadcareUrl(url: string): boolean  // https host ucarecdn.com or *.ucarecd.net (verify current domains in Task 2)
export function isDeviceUrl(url: string): boolean      // 'device:<id>'
/** Uploadcare: `${base}-/preview/${n}x${n}/-/format/auto/-/quality/smart/` (base ends with '/'); other URLs unchanged. */
export function photoUrl(url: string, size: PhotoSize): string
```

- [ ] **Step 1: Failing tests.**
  - `fitWithin`: `(4000,3000)` → `(2048,1536)`; `(3000,4000)` → `(1536,2048)`; `(800,600)` → `(800,600)`; `(10000,1)` → `(2048,1)`.
  - `isImageType`: `image/jpeg` → true, `application/pdf` → false, `video/mp4` → false.
  - `photoUrl`: `photoUrl('https://ucarecdn.com/abc/','thumb')` → `'https://ucarecdn.com/abc/-/preview/160x160/-/format/auto/-/quality/smart/'`; `device:x` и чужой https — без изменений.
  - `FileError` хранит `code`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** `prepareImage` не тестируется в node, только его чистые части. Код DOM за guard `typeof createImageBitmap === 'function'`.
- [ ] **Step 4: Run, verify pass;** `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 5: Commit:** `feat(core,app): file store interface and on-device image preparation`

---

### Task 2: Пакет `files-uploadcare`

**Files:**
- Create: `packages/files-uploadcare/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,test/uploadcare.test.ts}`. Пакет `@graymatter/files-uploadcare`, зависимость `@graymatter/core` (`workspace:*`). Подключить в корневой конфиг Vitest projects так же, как `core`.
- Modify: `packages/app/package.json` (зависимость `workspace:*`)

**Interfaces:**

```ts
export interface UploadcareOptions {
  publicKey: string
  /** CDN base for the returned URL when the upload response doesn't carry one. Default 'https://ucarecdn.com'. */
  cdnBase?: string
  fetch?: typeof fetch
  timeoutMs?: number   // default 60_000
}
export function createUploadcareStore(options: UploadcareOptions): FileStore   // provider 'uploadcare'
```

- **Перед реализацией** прочитать актуальные доки Uploadcare Upload API (WebFetch https://uploadcare.com/api-refs/upload-api/ и страницу про CDN/доставку):
  - поле `UPLOADCARE_STORE` (`'1'` или `'auto'`);
  - формат ответа `POST /base/` (`{ "file": "<uuid>" }`);
  - домен CDN для новых проектов: персональный поддомен `*.ucarecd.net` или общий `ucarecdn.com`.
  - Если у новых проектов персональный домен и загрузка его не возвращает, добавить в `SourceConfig` необязательное `uploadcareCdnBase: string | null` и поле в `SourceForm` с подсказкой. Иначе обойтись `cdnBase` по умолчанию. Решение и ссылку записать в отчёт.
- **`upload`:** `POST https://upload.uploadcare.com/base/`, `FormData` с полями `UPLOADCARE_PUB_KEY`, `UPLOADCARE_STORE='1'` и `file` (с именем). Время ожидания — через `AbortController` (не `AbortSignal.timeout`: долг из плана 2 про старые браузеры).
- **Сопоставление ошибок:**
  - 400 или 403 → `rejected` (неверный ключ, подписанные загрузки, запрещённый тип);
  - 413 → `too_large`;
  - 429, 5xx, сетевая ошибка, таймаут → `unavailable`;
  - прочее → `failed`.
  - Текст ошибки без ключа и без строки подключения.

- [ ] **Step 1: Failing tests** с подменённым `fetch`:
  - отправляет нужные поля и URL;
  - возвращает `{ provider: 'uploadcare', fileId: uuid, url: \`${cdnBase}/${uuid}/\` }`;
  - каждое сопоставление ошибок;
  - таймаут → `unavailable`;
  - `publicKey` пустой → `FileError('no_store')` при создании.
- [ ] **Step 2–4:** fail → implement → pass; `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 5: Commit:** `feat(files-uploadcare): upload photos to Uploadcare from the browser`

---

### Task 3: Фото на устройстве для демо-источника

**Files:**
- Create: `packages/app/app/lib/device-files.ts`, `packages/app/test/device-files.test.ts`

**Interfaces:**

```ts
/** Blobs in IndexedDB (idb-keyval store 'gm-files'/'files'); provider 'device', fileId = newId(), url = 'device:<fileId>'. */
export function createDeviceFileStore(): FileStore
/** Object URL for a device photo, created once per id and cached; null when missing. */
export function resolveDeviceUrl(url: string): Promise<string | null>
/** Revokes all cached object URLs (on source removal / tests). */
export function releaseDeviceUrls(): void
```

- [ ] **Step 1: Failing tests** (fake-indexeddb, `URL.createObjectURL` подменён):
  - upload → `resolveDeviceUrl` даёт одну и ту же ссылку при повторных вызовах, `createObjectURL` вызван один раз;
  - неизвестный id → `null`;
  - `releaseDeviceUrls` отзывает все.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit:** `feat(app): device photo store for the demo source`

---

### Task 4: Фото в workspace

**Files:**
- Modify: `packages/app/app/lib/workspace.ts`, `workspace-types.ts`, `packages/app/app/lib/errors.ts` (сообщения `FileError`), `en.json`
- Test: `packages/app/test/workspace.test.ts`

**Interfaces:**

```ts
// Workspace
/** Uploadcare for a Neon source with a public key, the device store for the demo source, otherwise null. */
fileStoreFor(sourceId: string): FileStore | null
/** Prepares, uploads and records each file in order (photo.add with newId, provider, fileId, url). Stops at the first failure
 *  and rejects with it; photos already added stay. onProgress(doneCount) after each file. */
addPhotos(itemId: Id, files: File[], onProgress?: (done: number) => void): Promise<void>
/** One photo per variant: removes the old one first. */
setVariantPhoto(itemId: Id, variantId: Id, file: File): Promise<void>
removePhoto(photoId: Id): Promise<void>
/** photo.reorder with the chosen photo first. */
makeCover(itemId: Id, photoId: Id): Promise<void>
```

- Зависимость от `prepareImage` и хранилища передаётся через `WorkspaceDeps`. Добавить `prepareImage?: (f: File) => Promise<Blob>` и `fileStores?: (config: SourceConfig) => FileStore | null`. Значения по умолчанию — настоящие, в тестах — подмены.
- Проверка до загрузки:
  - `state.readOnly` → `StorageError('read_only')`;
  - нет текущего снимка → `StorageError('not_found')`;
  - нет хранилища → `FileError('no_store')`.
- Ошибки хранилища фото не помечают источник `unreachable`: это не Neon.
- [ ] **Step 1: Failing tests:**
  - успешная загрузка двух файлов → две команды `photo.add` с позициями по порядку и `onProgress(1)`, `onProgress(2)`;
  - сбой загрузки второго файла → в снимке одно фото, отказ с `FileError('unavailable')`;
  - `readOnly` → ни одного вызова `upload`;
  - `setVariantPhoto` при существующем фото варианта → `photo.remove`, затем `photo.add`;
  - `makeCover` → `photo.reorder` с этим фото первым;
  - `fileStoreFor`: Neon без ключа → `null`, демо → `provider: 'device'`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit:** `feat(app): add, remove and reorder photos through the workspace`

---

### Task 5: Галерея в карточке, просмотр и фото варианта

**Files:**
- Create: `PhotoImg.vue`, `PhotoPicker.vue`, `ItemGallery.vue`, `PhotoViewer.vue`
- Modify: `ItemScreen.vue`, `BucketList.vue`, `lib/item-view.ts` (+ `photos` в `ItemView` и `photo` в `BucketRow`), `test/item-view.test.ts`, `en.json`

**Interfaces:**

```ts
// item-view.ts
ItemView.photos: Photo[]         // item photos (variantId null) by position
BucketRow.photo: Photo | null    // the variant's photo
```

```vue
<!-- PhotoImg.vue -->  props { url: string; size: PhotoSize; alt: string }
<!--   device: → resolveDeviceUrl; Uploadcare → photoUrl; loading="lazy", decoding="async"; on error → a bg-thumb placeholder with the Image icon -->
<!-- PhotoPicker.vue -->  props { multiple?: boolean; disabled?: boolean }, emits pick(files: File[])
<!--   phone: two buttons — "Camera" (input accept="image/*" capture="environment") and "Gallery" (accept="image/*", multiple) -->
<!--   desktop: one "Add photos" button + drag-and-drop onto the gallery + paste (Ctrl/⌘+V) of an image -->
```

- **`ItemGallery`.**
  - **С фото.** Обложка `aspect-[4/3] rounded-card object-cover`, под ней лента миниатюр 64 px с `gap-0.5` и плиткой «+».
  - **Без фото.** Пустая плитка с `PhotoPicker`.
  - **Во время загрузки** плитки-скелеты с номером «2 / 3».
  - **Ошибка** — toast с Retry: повторяет оставшиеся файлы.
  - **Нет хранилища** (Neon без ключа) — подсказка «Add an Uploadcare public key in this source's settings to attach photos» со ссылкой на `/settings/sources/<id>`.
  - **`state.readOnly`** — всё выключено.
- **`PhotoViewer`.**
  - Полноэкранный `Dialog` с фото `full`, листание стрелками, клавишами ←/→ и свайпом.
  - Действия: «Make cover» (`makeCover`) и «Delete» (`ConfirmSheet`: «The photo is removed from this item. The file stays in your photo storage.»).
  - Закрывается через `useCloseWatcher`.
- **Фото варианта.** В строке `BucketList` миниатюра 40 px, если есть. В «⋯» варианта пункт «Photo…»: `PhotoPicker` без `multiple` → `setVariantPhoto`.
- [ ] **Step 1: Failing tests** `item-view`: `photos` упорядочены по позиции, фото варианта не попадает в `photos`, `BucketRow.photo` заполнено.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Проверка:** снимок карточки на демо-данных с двумя фото — 360 px и 1280 px.
- [ ] **Step 6: Commit:** `feat(app): item gallery, photo viewer and variant photos`

---

### Task 6: Миниатюры в списках, палитре и фото в быстром добавлении

**Files:**
- Modify: `ItemList.vue`, `SearchPalette.vue` (+ `SearchRow.coverUrl` в `views.ts` и тест), `QuickAddForm.vue`, `QuickAddSheet.vue`, `en.json`
- Test: `test/views.test.ts`, `test/quick-add.test.ts` (если затронута логика)

- **Миниатюры.** `ItemList` и строки предметов в палитре показывают `PhotoImg size="thumb"` в квадрате 42 px вместо иконки, если `coverUrl` есть. Для предмета без обложки — прежняя иконка.
- **`searchRows`** отдаёт `coverUrl`: обложку предмета, а при совпавшем варианте — фото варианта, если есть.
- **`QuickAddForm`.**
  - Необязательное поле «Photo»: `PhotoPicker` без `multiple`, превью выбранного.
  - После успешного `item.create` вызывается `workspace.addPhotos(id, [file])`.
  - Если фото не загрузилось, предмет остаётся, toast: «Item added. The photo didn't upload — add it from the item card.» с действием «Open».
  - Поле скрыто, если `fileStoreFor` = `null`.
- [ ] **Step 1: Failing tests:** `searchRows` даёт `coverUrl` (фото варианта важнее обложки при совпадении варианта).
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Проверка:** снимок папки с миниатюрами на 360 px.
- [ ] **Step 6: Commit:** `feat(app): photo thumbnails in lists and the palette; photo in quick add`

---

### Task 7: Настройки Uploadcare и подсказки

**Files:**
- Modify: `SourceForm.vue`, `en.json`, `README.md` (раздел «Photos with Uploadcare»)

- **Поле публичного ключа** получает подсказку: «Public key from your Uploadcare project. Turn signed uploads off; files are stored permanently.» и ссылку на панель Uploadcare (`target=_blank rel=noopener noreferrer`).
  - Если Task 2 добавил `uploadcareCdnBase`, здесь же его поле с подсказкой про персональный домен CDN.
- **`README.md`** — короткий раздел:
  1. Создать проект в Uploadcare.
  2. Скопировать публичный ключ.
  3. Выключить signed uploads.
  4. Вставить ключ в настройках источника.
  5. Учесть лимиты бесплатного тарифа: 1000 операций в месяц (загрузка и первый показ каждого размера), 1 ГБ хранения, 5 ГБ трафика, при превышении фото не грузятся до следующего месяца. Ссылка на официальную страницу цен.
  6. Файлы из приложения не удаляются.
- [ ] **Step 1:** Изменения и `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 2: Commit:** `docs(app): Uploadcare setup in source settings and the README`

---

## Приёмка владельцем

1. В настройках своего Neon-источника вставить публичный ключ Uploadcare.
2. С телефона: снять пакетик камерой в быстром добавлении. Добавить к предмету ещё два фото из галереи, сделать второе обложкой, удалить одно.
3. Поставить фото варианту резистора.
4. Проверить миниатюры в списке и в палитре.
5. Проверить, что фото на месте после перезагрузки и на компьютере.

## Итоги выполнения

Выполнено в ночь на 2026-11-11 через субагентов. Сделано 7 задач, затем одно общее финальное ревью планов 4 и 5 на Opus и одна волна исправлений. Коммиты лежат в диапазоне `26d41ed..349a258` вперемешку с планом 5. В конце `pnpm test` дал 602 зелёных теста (1 пропущен). Конформанс-тесты Neon прошли на настоящей тестовой базе по HTTP и WebSocket. `typecheck` и `lint` чистые.

Задачи 2 ∥ 3 и 5 ∥ 6 шли в отдельных worktree и вмержены. Проверка в браузере — 1–2 снимка на задачу.

### Решения, принятые без владельца

- **Uploadcare Free теперь — 1000 операций в месяц.** Загрузка — одна операция, первый показ каждого размера — ещё одна. Хранение — 1 ГБ, трафик — 5 ГБ. При превышении сервис приостанавливается.
  - Uploadcare остаётся первым адаптером, как в спеке. Хватает примерно на 200–250 новых фото в месяц.
  - `PhotoImg` при ошибке показывает заглушку, и инвентарь работает дальше.
  - S3-совместимый адаптер (R2/B2) — предложение ночного обзора.
- **Адрес CDN.** Проекты, созданные после сентября 2025 года, отдают фото с личного домена `*.ucarecd.net`, а API его не возвращает. Поэтому у источника появилось поле «Photo address» (`uploadcareCdnBase`).
  - Хранилище, форма и показ фото принимают одно правило: только `https://ucarecdn.com` или `https://<sub>.ucarecd.net`, без пути.
  - Свой CNAME не поддерживается: такие фото не показались бы из-за списка допустимых адресов и CSP.
- **`UPLOADCARE_STORE='1'`** — файл хранится постоянно, независимо от настройки проекта.
- **Безопасность.** `PhotoImg` показывает только адреса Uploadcare и `device:`, иначе заглушку. Без этого чужая ссылка в базе работала бы как трекинг-пиксель. Нашла автоматическая проверка безопасности. Это совпадает с `img-src` в CSP.
- **Фото варианта** — две записи: `photo.remove`, потом `photo.add`.
  - Так сделано, потому что ядро разрешает одно фото на вариант, а хранилище применяет одну команду за раз.
  - Если связь оборвётся между записями, вариант останется без фото. Файл при этом останется в хранилище.
  - Пакетная запись войдёт в предложение об очереди записей.
- **Цель записи фиксируется до загрузки.** Если во время загрузки переключить инвентарь, фото не уедет в чужой инвентарь.
- **Загрузки идут вне очереди записей**, поэтому прогресс у галереи свой («2 / 3»). Retry повторяет только оставшиеся файлы и пропускает те, что не загрузятся никогда.
- **Миниатюры в палитре — 32 px вместо 42 px.** При 42 px выросла бы высота строки.
- **Быстрое добавление** держит шторку закрытой для взаимодействия, пока грузится фото. Если фото не загрузилось, предмет всё равно создаётся, а в toast есть кнопка «Open».
- **Галерея на компьютере** занимает всю ширину колонки карточек. Высота обложки ограничена.

### Отложено

Полный список — в ночном обзоре, раздел «Перенесённые долги». Главное:
- тестов на сценарий фото в быстром добавлении нет: логика внутри компонента, а DOM-окружения для тестов нет;
- изображение декодируется в полном размере до уменьшения (память на 50-мегапиксельных фото);
- «одно фото на вариант» проверяется только на устройстве: со старым снимком на другом устройстве можно получить два фото;
- Retry после потерянного ответа создаёт дубль — нужна очередь записей с постоянными id.

### Проверить при приёмке на телефоне

- Камера в быстром добавлении (`capture="environment"`) и выбор нескольких фото из галереи.
- Свайп в просмотрщике, «Make cover», удаление с подтверждением, жест «назад» закрывает только просмотрщик.
- Фото варианта через «⋯ → Photo…».
- Источник без ключа: подсказка со ссылкой в настройки.
