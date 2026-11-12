# Копии фото и хранилище ImgBB — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У фото появляется общий набор копий (`urls`), размеры и ключ удаления. ImgBB становится третьим хранилищем фото и использует этот набор.

**Architecture:** Новые поля проходят все слои: core (типы и проверка команд), storage-postgres (миграция 0002, чтение, запись, восстановление), резервная копия, загрузка (`prepareImage`, `uploadOne`), показ (`pickRendition` в `photo-url.ts`). Новый пакет `@antresol/files-imgbb` реализует `FileStore`, приложение подключает его в настройках, CSP и service worker.

**Tech Stack:** TypeScript, Vue 3 / Nuxt 4, drizzle-kit (миграции), PGlite и Neon (тесты), Vitest, Workbox (`@vite-pwa/nuxt`).

**Spec:** `docs/superpowers/specs/2026-11-12-antresol-photo-renditions-design.md`

## Global Constraints

- **Ветка и рабочая папка:**
  - ветка `photo-renditions`, рабочая папка `.worktrees/photo-renditions`;
  - не пушить; слияние в `master` и push — только по команде владельца;
  - в основной папке проекта (`/Users/as/dev/graymatter`) ничего не менять.
- **Коммиты:** без строк атрибуции (`Co-Authored-By`, `Claude-Session`).
- **Инструменты:** только pnpm (`pnpm test --maxWorkers=3`, `pnpm typecheck`, `pnpm lint`).
- **Секреты:**
  - никогда не печатать строки подключения, ключи и содержимое `.env.local`;
  - ключ ImgBB для живых проверок брать только из `ANTRESOL_IMGBB_TEST_KEY` в `.env.local`;
  - тестовые загрузки в ImgBB делать только с `expiration=600`.
- **Dev-серверы:**
  - свой dev-сервер — только из этой рабочей папки, на порту 3001 (если он занят превью, то на 3003);
  - порты 3000 и 3002 принадлежат владельцу, их не трогать.
- **Имена:** в новом коде «Antresol» и `@antresol/*`, без `gm-`/`GM`.
- **Размеры показа** (`photo-url.ts` `SIDE`): `thumb` 160, `card` 800, `full` 2048.
- **Пределы проверки:**
  - копий не больше 8;
  - `url` — `https://`, не длиннее 2048 символов;
  - `role` — 1–40 символов;
  - `type` — `null` или до 100 символов;
  - `width`/`height` — целые от 1 до 20000;
  - `deleteHandle` — 1–2048 символов.
- **ImgBB:**
  - API — `https://api.imgbb.com/1/upload`, картинки — `https://i.ibb.co`;
  - `medium` вписан в 640, `thumb` — квадрат 180;
  - метка кэша — `antresol=thumb`.

## Review Focus

1. **В базе лежит копия с чужого хоста** (её записало взломанное устройство). Такая копия не грузится никогда, показ откатывается на `url`. Тест — в задаче 5.
2. **В ImgBB загрузили маленькое фото,** и `medium` или `thumb` не пришёл. Хранилище не падает и сохраняет те копии, что пришли. Тест — в задаче 6.
3. **Восстанавливается резервная копия схемы 4** без новых полей. Фото восстанавливаются с `null` в новых полях. Тест — в задаче 3.
4. **Приходит команда `photo.add` без новых полей** (из старой очереди или от приложения схемы 4). Она пишет ровно тот же запрос, что и схема 4, и применяется. Тест — в задаче 2.
5. **`urls` читается через neon-http, neon-ws и PGlite.** Везде приходит список объектов, а не строка JSON. Тест — в задаче 2.

---

### Задача 1. Core: типы копий и проверка команд

**Files:**
- Modify: `packages/core/src/model.ts` (`Photo`, новый `Rendition`)
- Modify: `packages/core/src/files.ts` (`StoredFile`)
- Modify: `packages/core/src/commands.ts` (`photo.add`, `photo.replace`)
- Modify: `packages/core/src/validate.ts` (проверка новых полей)
- Modify: `packages/core/src/index.ts`, если типы экспортируются оттуда списком
- Test: `packages/core/test/validate.test.ts`

**Interfaces:**
- Produces:
  - `interface Rendition { url: string; role: string; width: number; height: number; fit: 'inside' | 'cover'; type: string | null }`;
  - `RENDITION_FITS = ['inside', 'cover'] as const`, `MAX_RENDITIONS = 8`;
  - `Photo` получает `urls: Rendition[] | null; width: number | null; height: number | null; deleteHandle: string | null`;
  - `StoredFile` получает `urls?: Rendition[] | null; deleteHandle?: string | null`;
  - `interface PhotoFile { provider: string; fileId: string; url: string; urls?: Rendition[] | null; width?: number | null; height?: number | null; deleteHandle?: string | null }`;
  - `photo.add` = `{ type; id; itemId; variantId } & PhotoFile`, `photo.replace` = `{ type; variantId; id; itemId; replaces } & PhotoFile`.

- [ ] **Шаг 1: тесты проверки.** В `validate.test.ts`, рядом с остальными случаями `photo.add`, добавьте:
  - Принимаются:
    - команда без новых полей;
    - команда со всеми полями `null`;
    - команда с тремя копиями ImgBB: `original` 2048×1536 `inside` `image/webp`, `medium` 640×480 `inside`, `thumb` 180×180 `cover`, плюс `width: 2048, height: 1536, deleteHandle: 'https://ibb.co/x/y'`.
  - Отклоняются с `invalid_url`: копия `http://…`; копия длиной 2049 символов.
  - Отклоняются с `invalid_option`:
    - 9 копий;
    - пустой список `urls: []`;
    - `role: ''`;
    - `role` длиной 41;
    - `width: 0`;
    - `width: 1.5`;
    - `height: 20001`;
    - `fit: 'contain'`;
    - `type` длиной 101;
    - `width: 10, height: null`;
    - `deleteHandle: ''`;
    - `deleteHandle` длиной 2049.
  - Те же два набора (принимаемые и отклоняемые случаи) для `photo.replace`.
- [ ] **Шаг 2.** `pnpm --filter @antresol/core exec vitest run test/validate.test.ts` — новые случаи падают.
- [ ] **Шаг 3.** Типы из блока Interfaces. В `validateCommand` для обеих команд вызывается одна функция `checkPhotoFile(c: PhotoFile)`, до проверок корзины. `undefined` равнозначно `null`; `normalizeCommand` не меняется.
- [ ] **Шаг 4.** Тест зелёный. `pnpm --filter @antresol/core typecheck`.
- [ ] **Шаг 5.** Коммит `feat(core): photo renditions, size and delete handle on photos and photo commands`.

### Задача 2. storage-postgres: колонки, чтение, запись, восстановление

**Files:**
- Modify: `packages/storage-postgres/src/schema.ts` (photos: `urls jsonb`, `width integer`, `height integer`, `delete_handle text`)
- Create: `packages/storage-postgres/migrations/0002_photo_renditions.sql`, плюс `meta/0002_snapshot.json` и запись в `meta/_journal.json`
- Modify: `src/rows.ts` (`toPhoto`), `src/queries.ts` (выборка фото), `src/commands/photos.ts` (обе вставки), `src/restore.ts` (тип колонки `jsonb`)
- Test:
  - `test/photos.test.ts`;
  - `test/migrator.test.ts` (версии 4 → 5, число пакетов миграций);
  - `test/restore.test.ts` и `test/restore-fixtures.ts`;
  - `test/neon.conformance.test.ts` (`dbVersion`/`appVersion` 5; копии через оба транспорта).

**Interfaces:**
- Consumes: `Rendition`, `PhotoFile`, поля `Photo` из задачи 1.
- Produces:
  - `APP_SCHEMA_VERSION = 5`;
  - `RestoreColumn.type` получает `'jsonb'`;
  - фото из `loadInventory` и из чтения после команд несут `urls`, `width`, `height`, `deleteHandle`.

- [ ] **Шаг 1: схема и миграция.**
  - Колонки в `schema.ts`: `jsonb('urls').$type<Rendition[]>()`, `integer('width')`, `integer('height')`, `text('delete_handle')`, все могут быть пустыми.
  - Сгенерировать миграцию: из корня `pnpm --filter @antresol/storage-postgres exec drizzle-kit generate --name photo_renditions`.
  - Убедиться, что SQL — это четыре `ALTER TABLE "photos" ADD COLUMN …` без `NOT NULL` и без изменения `min_app_schema`.
  - В начало файла добавить одну строку комментария, как в `0001`.
- [ ] **Шаг 2: тесты.**
  - `photos.test.ts` (PGlite):
    - `photo.add` с тремя копиями, размерами и `deleteHandle` читается обратно через `loadInventory` с теми же значениями, где `urls` — список объектов;
    - то же для `photo.replace`.
  - Команда без новых полей:
    - читается с `null` во всех четырёх полях;
    - `toStatements` для неё даёт ровно прежний текст вставки (сравнить с записанной строкой схемы 4).
  - Строка, где в `urls` лежит не список (записать `'"x"'::jsonb` прямым SQL), читается с `urls: null`.
  - `migrator.test.ts`: ожидания версий и число пакетов поднять на один. Тесты совместимости со схемой 3 (`writeAsSchema3`) должны пройти без правок самого теста.
  - `restore.test.ts`: резервная копия с фото с копиями восстанавливается с теми же `urls`. Проверка «каждая колонка объявлена» проходит.
  - `neon.conformance.test.ts`: в блоке «photo add/replace» `photo.add` с копиями читается обратно списком через `neon-http` и `neon-ws`. Ожидания версий — 5.
- [ ] **Шаг 3.** `pnpm --filter @antresol/storage-postgres exec vitest run` — новые тесты падают.
- [ ] **Шаг 4: реализация.**
  - **Вставки.** Обе вставки в `commands/photos.ts` перечисляют новые колонки только для полей, не равных `null` и `undefined`.
    - `urls` уходит как `${JSON.stringify(urls)}::jsonb`: объект целиком `sql.ts` принял бы за вложенный запрос.
  - **Выборка.** `queries.ts` добавляет `p.urls, p.width, p.height, p.delete_handle`.
  - **`toPhoto`:**
    - `urls` — массив или `null`; не массив тоже даёт `null`;
    - `width`/`height` — число или `null`;
    - `deleteHandle` — строка или `null`.
  - **Восстановление.**
    - `restore.ts`: тип `'jsonb'` в `RestoreColumn`, `ARRAY_TYPE.jsonb = 'text[]'`, `selectExpression` для него даёт `r."<имя>"::jsonb`.
    - `Raw` допускает объект или массив объектов, а `finalRow` превращает его в `JSON.stringify`.
    - В фото `RESTORE_TABLES` после `url` добавляются `urls` (jsonb), `width`, `height` (int) и `delete_handle` (text). Позиционная строка на `restore.ts:288` идёт в том же порядке.
    - В `backupProblems` для фото ничего нового не нужно: структуру проверяет приложение (задача 3).
- [ ] **Шаг 5.** Весь пакет зелёный на PGlite. Если в `.env.local` есть `ANTRESOL_NEON_TEST_URL`, прогнать `neon.conformance` — зелёный. `pnpm --filter @antresol/storage-postgres typecheck`.
- [ ] **Шаг 6.** Коммит `feat(storage-postgres): migration 0002 adds photo renditions, size and delete handle`.

### Задача 3. Резервная копия

**Files:**
- Modify: `packages/app/app/lib/backup.ts` (`SHAPES.photo`, `PHOTO_DEFAULTS`, проверка копий)
- Test: `packages/app/test/backup.test.ts`

**Interfaces:**
- Consumes: `Rendition`, `RENDITION_FITS`, `MAX_RENDITIONS`, поля `Photo` (задача 1); `APP_SCHEMA_VERSION = 5` (задача 2).

- [ ] **Шаг 1: тесты.**
  - Экспорт с фото, у которого три копии, размеры и `deleteHandle`, разбирается `parseBackup` обратно без потерь.
  - Файл схемы 4 без новых полей разбирается, и у фото четыре `null`.
  - Отклоняются:
    - файл, где `urls` — строка;
    - файл, где у копии нет `width`;
    - файл, где `fit: 'contain'`.
- [ ] **Шаг 2.** Тесты падают.
- [ ] **Шаг 3.** `SHAPES.photo` получает:
  - `urls: nullable(renditions)` — `renditions` проверяет список из 1–8 объектов с полями и пределами из Global Constraints;
  - `width: nullable(int)`, `height: nullable(int)`, `deleteHandle: nullable(str)`.

  `PHOTO_DEFAULTS = { urls: null, width: null, height: null, deleteHandle: null }` передаётся в `records(s.photos, SHAPES.photo, PHOTO_DEFAULTS)`. Комментарий над defaults упоминает схему 5.
- [ ] **Шаг 4.** Тесты зелёные.
- [ ] **Шаг 5.** Коммит `feat(app): backups carry photo renditions, size and delete handle`.

### Задача 4. Загрузка: размеры, нейтральное имя, поля в команде

**Files:**
- Modify: `packages/app/app/lib/images.ts` (`prepareImage`, новый `PreparedImage`, `uploadName`)
- Modify: `packages/app/app/lib/workspace.ts` (`uploadOne`, `addPhotos`, `setVariantPhoto`)
- Modify: `packages/app/app/lib/workspace-types.ts` (тип `deps.prepareImage`)
- Modify: `packages/app/app/lib/device-files.ts`, только если этого требуют типы
- Test: `packages/app/test/images.test.ts`, `test/images-encoding.test.ts`, `test/workspace.test.ts`

**Interfaces:**
- Consumes: `StoredFile` и `PhotoFile` (задача 1).
- Produces:
  - `interface PreparedImage { blob: Blob; width: number; height: number }`;
  - `prepareImage(file: File): Promise<PreparedImage>`;
  - `uploadName(type: string): string` — `'photo.webp'` для `image/webp`, иначе `'photo.jpg'`;
  - `deps.prepareImage?: (f: File) => Promise<PreparedImage>`.

- [ ] **Шаг 1: тесты.**
  - `prepareImage` для 4000×3000 возвращает `width: 2048, height: 1536`, для 800×600 — `800, 600`. Использовать уже имеющиеся заглушки `createImageBitmap` и canvas.
  - `uploadName('image/webp') === 'photo.webp'`, `uploadName('image/jpeg') === 'photo.jpg'`.
  - `workspace.test.ts`:
    - хранилище-заглушка возвращает `urls` и `deleteHandle`;
    - `addPhotos` записывает фото с этими `urls`, `deleteHandle` и размерами из `prepareImage`;
    - `store.upload` получает имя `photo.webp`, а не имя исходного файла;
    - то же для `setVariantPhoto`;
    - заглушка без `urls` даёт фото с `urls: null` и с размерами.
- [ ] **Шаг 2.** Тесты падают.
- [ ] **Шаг 3: реализация.**
  - `prepareImage` возвращает размеры из `fitWithin`.
  - `uploadOne` вызывает `store.upload(prepared.blob, uploadName(prepared.blob.type))` и возвращает `PhotoFile`:
    - `provider`, `fileId`, `url` из ответа хранилища;
    - `urls ?? null`, `deleteHandle ?? null`;
    - `width`, `height` из `prepared`.
  - Все места, которые вызывают `prepareImage` или подменяют его в тестах, поправить под новый тип.
- [ ] **Шаг 4.** Тесты зелёные. `pnpm --filter @antresol/app typecheck`.
- [ ] **Шаг 5.** Коммит `feat(app): uploads record the photo size, send a neutral file name and keep the store's renditions`.

### Задача 5. Показ: выбор копии

**Files:**
- Modify: `packages/app/app/lib/photo-url.ts` (`PhotoRef`, `isPhotoHostUrl`, `pickRendition`, `displayablePhotoUrl`)
- Modify: `packages/app/app/components/PhotoImg.vue` (prop `photo` вместо `url`)
- Modify: `packages/app/app/components/ItemThumb.vue` (prop `cover: PhotoRef | null` вместо `coverUrl`)
- Modify: `packages/app/app/lib/views.ts` (`covers`, `variantCovers`: `Map<Id, PhotoRef>`)
- Modify: все места, где используются эти компоненты и карты. Найти через `grep -rn "PhotoImg\|ItemThumb\|coverUrl\|covers\.get\|variantCovers" packages/app/app`; сейчас это ItemGallery, PhotoViewer, BucketList, ItemList, SearchPalette, ShareSheet, QuickAddForm.
- Test: `packages/app/test/photo-url.test.ts`, `test/views.test.ts`, `test/item-view.test.ts`

**Interfaces:**
- Consumes: `Rendition` и `Photo` (задача 1).
- Produces:
  - `type PhotoRef = { url: string; urls?: Rendition[] | null }`;
  - `isPhotoHostUrl(url: string): boolean` — Uploadcare, Cloudinary, Imgur; ImgBB добавит задача 7;
  - `pickRendition(urls: readonly Rendition[] | null | undefined, size: PhotoSize): Rendition | null`;
  - `displayablePhotoUrl(photo: PhotoRef, size: PhotoSize): string | null`;
  - `photoUrl(url, size)` не меняется.

- [ ] **Шаг 1: тесты `pickRendition`.** Набор копий ImgBB:
  - original — `https://i.ibb.co/a/p.webp` 2048×1536 `inside`;
  - medium — `…/b/p.webp` 640×480 `inside`;
  - thumb — `…/c/p.webp` 180×180 `cover`.

  Пока ImgBB не добавлен в `isPhotoHostUrl` (это задача 7), разрешённость хоста в тестах подставляется через хост Uploadcare, например `https://ucarecdn.com/<uuid>/`. ImgBB-адреса вернутся в задаче 7.

  Ожидания:
  - `thumb` → thumb, `card` → original, `full` → original;
  - без original: `full` → medium (самая большая `inside`), `thumb` → thumb;
  - только `cover`-копия: для `full` → `null`;
  - копия с чужим хостом (`https://evil.example/x.webp`) не выбирается никогда, даже когда она единственная подходящая;
  - `null` и `[]` → `null`.
- [ ] **Шаг 2: тесты `displayablePhotoUrl`.**
  - Если копия выбрана, возвращается её адрес.
  - Иначе — прежний результат `photoUrl(url, size)` для Uploadcare, Cloudinary и Imgur.
  - `device:` проходит без изменений.
  - Чужой `url` без копий → `null`.
  - Существующие тесты переписать на `{ url }`. Литерал `<PhotoImg :url="cover.url" size="full"` в `photo-url.test.ts:61-67` заменить на новую форму вызова.
- [ ] **Шаг 3.** Тесты падают.
- [ ] **Шаг 4: реализация.** `pickRendition` по алгоритму спецификации §6 (по площади, `width*height`):

  ```
  allowed = urls.filter(r => isPhotoHostUrl(r.url) && (size === 'thumb' || r.fit === 'inside'))
  side = r => size === 'thumb' ? min(r.width, r.height) : max(r.width, r.height)
  big = allowed.filter(r => side(r) >= SIDE[size])
  return big.length ? smallest by area of big : (allowed.length ? largest by area of allowed : null)
  ```

  Компоненты передают фото целиком: `PhotoImg :photo="p"`, `ItemThumb :cover="…"`. Карты обложек хранят `PhotoRef` (`{ url, urls }`).
- [ ] **Шаг 5.** Тесты приложения зелёные, `pnpm --filter @antresol/app typecheck`, `pnpm lint`.
- [ ] **Шаг 6.** Коммит `feat(app): pick a stored rendition by size and fit, falling back to the url`.

### Задача 6. Пакет `@antresol/files-imgbb`

**Files:**
- Create: `packages/files-imgbb/package.json`, `tsconfig.json`, `vitest.config.ts` (по образцу `packages/files-imgur`)
- Create: `packages/files-imgbb/src/index.ts`
- Create: `packages/files-imgbb/test/imgbb.test.ts`
- Create: `packages/files-imgbb/test/imgbb.live.test.ts`. Пропускается без `ANTRESOL_IMGBB_TEST_KEY`. `vitest.config.ts` пакета загружает ключ через `loadEnv(mode, repoRoot, 'ANTRESOL_')`, как `packages/storage-postgres/vitest.config.ts`.
- Modify: `pnpm-lock.yaml` (через `pnpm install`)

**Interfaces:**
- Consumes: `FileStore`, `StoredFile`, `FileError`, `Rendition` (задача 1).
- Produces:
  - `isImgbbUrl(url: string): boolean`;
  - `createImgbbStore(options: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number; expirationSeconds?: number }): FileStore` с `provider: 'imgbb'`. `expirationSeconds` нужен только живому тесту, приложение его не задаёт;
  - `IMGBB_MEDIUM_SIDE = 640`, `IMGBB_THUMB_SIDE = 180`.

- [ ] **Шаг 1: тесты** с подменой `fetch`, как в `imgur.test.ts`.
  - **Запрос:**
    - `POST` на `https://api.imgbb.com/1/upload?key=K`;
    - в FormData поле `image` с именем `photo.webp`;
    - без `expirationSeconds` в адресе нет `expiration`, а с `expirationSeconds: 600` в адресе есть `&expiration=600`.
  - **Ответ из спецификации §1** (оригинал 2048×1536, `medium`, `thumb`, `delete_url`) даёт:
    - `provider: 'imgbb'`, `fileId: data.id`, `url: data.image.url`;
    - `urls`: original 2048×1536 `inside` `image/webp`, medium 640×480 `inside`, thumb 180×180 `cover`;
    - `deleteHandle: data.delete_url`.
  - **Ширина и высота строкой** (`"2048"`) читаются как числа.
  - **Без `medium` и `thumb`:** `urls` содержит только original.
  - **Оригинал 500×300:** `medium` 500×300, не увеличивается.
  - **`thumb` с адресом не на `i.ibb.co`** выбрасывается, остальное сохраняется.
  - **Неверный адрес оригинала** → `failed`.
  - **Таблица `it.each`** статус → код: 400, 401, 403 → `rejected`; 413 → `too_large`; 429, 500, 503 → `unavailable`; 418 → `failed`.
  - **Сбой сети** → `unavailable`, тайм-аут → `unavailable`, отмена → `failed`, не-JSON → `failed`.
  - **Ни в одном сообщении ошибки нет ключа `K`.**
  - **Пустой ключ** → `no_store` при создании.
  - **`isImgbbUrl`** принимает `https://i.ibb.co/rR77PCpR/antresol-probe.webp` и отклоняет:
    - `http://…`;
    - другой хост;
    - путь без id;
    - адрес с портом;
    - адрес с логином и паролем.
  - **Живой тест** (`imgbb.live.test.ts`):
    - загружает WebP 400×300 с `expirationSeconds: 600`;
    - `urls` содержит original 400×300 `inside`, medium 400×300 и thumb 180×180 `cover`;
    - оригинал по своему адресу отдаётся с `Access-Control-Allow-Origin: *`;
    - `deleteHandle` не пустой;
    - ключ в вывод теста не попадает.
- [ ] **Шаг 2.** `pnpm install`, затем `pnpm --filter @antresol/files-imgbb exec vitest run` — тесты падают.
- [ ] **Шаг 3: реализация** по образцу `files-imgur/src/index.ts`.
  - Адрес: `^https://i\.ibb\.co/[A-Za-z0-9]+/[^/?#]+\.(webp|jpe?g|png|gif)$`, без порта и учётных данных.
  - Размер `medium` — `fitWithin` оригинала в 640. Функцию не импортировать из приложения: написать маленькую свою в пакете.
- [ ] **Шаг 4.** Тесты и `pnpm --filter @antresol/files-imgbb typecheck` зелёные.
- [ ] **Шаг 5.** Коммит `feat(files-imgbb): ImgBB photo store that keeps every rendition and the delete link`.

### Задача 7. ImgBB в приложении

**Files:**
- Modify: `packages/app/package.json` (зависимость `@antresol/files-imgbb: workspace:*`)
- Modify: `packages/app/app/lib/types.ts` (`PhotoStore` + `'imgbb'`, `SourceConfig.imgbbApiKey?: string | null`)
- Modify: `packages/app/app/lib/sources.ts` (`photoStoreChoices`)
- Modify: `packages/app/app/components/SourceForm.vue` (поле ключа, ссылка, подсказка, `draft()`)
- Modify: `packages/app/app/lib/workspace.ts` (`defaultFileStore`, ключ кэша в `fileStoreFor`)
- Modify: `packages/app/app/lib/workspace-types.ts` (тип патча `updateSource`)
- Modify: `packages/app/app/lib/diagnostics.ts` (`PHOTO_FIELDS`)
- Modify: `packages/app/i18n/locales/en.json` (`sourceForm.store.imgbb`, `imgbbApiKey`, `imgbbHint`, `imgbbLink`)
- Modify: `packages/app/app/lib/photo-url.ts` (`isPhotoHostUrl` + ImgBB; метка `antresol=thumb`)
- Modify: `packages/app/app/lib/photo-cache.ts` (`photoCrossorigin` + `i.ibb.co`)
- Modify: `packages/app/app/lib/csp.ts`
- Modify: `packages/app/nuxt.config.ts` (оба правила Workbox для фото)
- Test:
  - `test/sources.test.ts`, `test/workspace.test.ts` (`defaultFileStore`), `test/diagnostics.test.ts`;
  - `test/photo-url.test.ts`, `test/photo-cache.test.ts`, `test/csp.test.ts`.

**Interfaces:**
- Consumes: `createImgbbStore`, `isImgbbUrl` (задача 6); `pickRendition`, `displayablePhotoUrl` (задача 5).

- [ ] **Шаг 1: тесты.**
  - `photoStoreChoices()` → `['uploadcare', 'cloudinary', 'imgbb']`, `photoStoreChoices('imgur')` → те же три и `'imgur'`. Существующий тест поправить.
  - `defaultFileStore({ …neon, photoStore: 'imgbb', imgbbApiKey: 'k' })?.provider === 'imgbb'`. Без ключа → `null`.
  - Диагностика скрывает `imgbbApiKey`. Добавить его в фикстуру `diagnostics.test.ts`.
  - `displayablePhotoUrl` для фото ImgBB с тремя копиями:
    - `thumb` → `https://i.ibb.co/c/p.webp?antresol=thumb`;
    - `full` → адрес оригинала без метки.
  - Фото ImgBB без `urls` для `thumb` → его `url` без метки.
  - `photo-cache.test.ts`:
    - адрес с меткой попадает в кэш миниатюр, без метки — в кэш полных фото;
    - `photoCrossorigin('https://i.ibb.co/…')` → `'anonymous'`;
    - ожидаемый список правил обновлён.
  - `csp.test.ts`: в `connect-src` есть `https://api.imgbb.com`, в `img-src` — `https://i.ibb.co`.
- [ ] **Шаг 2.** Тесты падают.
- [ ] **Шаг 3: реализация.**
  - **Форма источника:**
    - подписи: `store.imgbb: "ImgBB"`, `imgbbApiKey: "ImgBB API key"`, `imgbbLink: "Get an ImgBB API key"`, а `imgbbHint` — текст из спецификации §7;
    - ссылка ведёт на `https://api.imgbb.com/`;
    - поле ключа устроено как поле Client-ID у Imgur.
  - **`fileStoreFor`:** `imgbbApiKey` входит в ключ кэша, чтобы смена ключа пересобирала хранилище.
  - **Правило миниатюр в Workbox** получает альтернативу `i\.ibb\.co\/[A-Za-z0-9]+\/[^/?#]+\?antresol=thumb$`. Правило полных фото получает хост `i\.ibb\.co`. Комментарии в `nuxt.config.ts` и `csp.ts` обновить: «четыре хранилища».
- [ ] **Шаг 4.** Весь `pnpm test --maxWorkers=3`, `pnpm typecheck`, `pnpm lint` зелёные.
- [ ] **Шаг 5.** Коммит `feat(app): ImgBB as a photo store`.

### Задача 8. Проверка вживую и итоги

- [ ] **Шаг 1: живой тест хранилища.** `pnpm --filter @antresol/files-imgbb exec vitest run test/imgbb.live.test.ts` зелёный. Картинки удаляются сами через 10 минут. Ключ не печатается.
- [ ] **Шаг 2: показ не сломан.**
  - Запустить dev-сервер из этой рабочей папки на свободном порту (Global Constraints).
  - На демо-источнике (хранилище устройства) сделать два снимка: список с миниатюрами и просмотрщик.
- [ ] **Шаг 3: проверка ImgBB в интерфейсе — у владельца.** Ключ в форму источника вставляет он сам, ключ не проходит через инструменты Claude. Передать ему, что проверить:
  - у фото в базе три копии;
  - миниатюра грузится с `?antresol=thumb`;
  - просмотрщик грузит оригинал.
- [ ] **Шаг 4: итоги.** В конце плана записать, что сделано, что не проверено и какие решения приняты по ходу. Коммит `docs: plan 11 outcome`.
