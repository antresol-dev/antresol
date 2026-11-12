# План 10 — стили оформления

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 9 стилей оформления из макета владельца, каждый в светлой и тёмной теме, с выбором в настройках.

**Architecture:**
- **Стиль — модуль TypeScript.** Функция `build(mode, accent)` возвращает набор токенов — порт функции `build()` макета.
- **Применение.** Движок пишет токены обеих тем в один элемент `<style id="gm-style">` (`:root{…}` и `.dark{…}`) и ставит `data-style` на `<html>`. Замена элемента убирает переменные прошлого стиля.
- **Утилиты `main.css`** (`raised`, `pill`, `glass`, `row-selected`…) читают только переменные `--st-*`.
- **Рисунки и пометки, которые токенами не выразить,** лежат в `assets/css/styles/<name>.css` под `[data-style='<name>']`.
- **Волны:**
  - волна 1 — движок с Neumorphism (вид не меняется) и, параллельно, шрифты;
  - волна 2 — восемь стилей в четырёх задачах и, параллельно, настройки.
  - Затем итоговое ревью и исправления.

**Tech Stack:** TypeScript, Vitest, Nuxt 4, Vue 3, Tailwind 4, @nuxt/fonts, @nuxtjs/color-mode, vite-pwa (Workbox), Lucide.

**Spec:** `docs/superpowers/specs/2026-11-12-graymatter-styles-design.md`.

## Global Constraints

Те же, что в Плане 9, с уточнениями:
- **Ветки.** Интеграционная ветка `plan10`. Задачи — в `.worktrees/p10-tN` на ветках `p10-tN`.
- **Ресурсы.** Порты dev-серверов `3020 + N`. Порт 3001 — превью владельца, его не трогать. Vitest — `--maxWorkers=3`.
- **Источник чисел — только макет.** Файл `StyleScreen.dc.html` из артефакта лежит в рабочей папке плана как `styles-mockup.dc.html`. Значения переносятся из него дословно. Исключение — Neumorphism: там действуют текущие значения приложения.
- **Контракт стилей.** Стиль не задаёт отступы, промежутки, размеры, высоты.
  - Рамки — `inset` box-shadow.
  - Украшения — фоном или `position: absolute`.
  - Внешняя тень достаёт не дальше 4 px в сторону зазора 6 px.
- **Цвет.** В каждом стиле цвет используется так, как на его доске. В Neumorphism, как и раньше, цвет только у акцентной кнопки и выбранной строки.
- **Решения владельца по элементам действуют во всех стилях:**
  - плоское дерево;
  - плоские иконки шапки на телефоне;
  - плоские кнопки камеры и галереи;
  - крестик шторки;
  - шапка на 360 px без переполнения.
- **`nuxt.config.ts`.** Меняет только задача 2, отдельным коммитом, только свои строки.
- **Снимки экрана.** Не больше двух на стиль: 360 px в светлой и в тёмной теме. Только общий вид.

## Review Focus
1. **Смена стиля на ходу оставляет хвосты прошлого:** фон-рисунок Y2K остаётся после перехода на Base, переменная прошлого стиля не сброшена. Тест в задаче 1: после `applyStyle(a)` → `applyStyle(b)` на `<html>` нет ни одной переменной и ни одного атрибута от `a`.
2. **Вспышка при старте:** первый кадр рисуется в Neumorphism, потом переключается. Стиль ставится плагином до монтирования, как сейчас акцент. Тест в задаче 1: плагин применяет сохранённый стиль до первого рендера.
3. **Прыжки раскладки между стилями:** стиль с настоящей `border` вместо `inset`-тени сдвигает высоты. Тест в задаче 1: ни один токен не содержит `border-width`, `padding`, `margin`, `gap`, `height`, `width`. Проверка в браузере — в итоговом ревью: высоты строки списка, шапки и поля одинаковы во всех 9 стилях.
4. **Фиксированная палитра и сохранённый акцент.** Пользователь выбрал rose в Base и перешёл в Retro: Retro не меняется. Вернулся в Base — снова rose. Тест в задаче 1 (`Appearance`).
5. **Шрифт стиля без сети при первом выборе:** текст показывается запасным шрифтом сразу, без невидимого текста, раскладка не ломается. После загрузки шрифт работает без сети. Тест конфигурации в задаче 2.

---

## Порядок

| Волна | Задачи | Модель | Зависят от |
|---|---|---|---|
| 1 | 1 (движок, Neumorphism) | самая сильная | — |
| 1 | 2 (шрифты и их кэш) | средняя | — |
| 2 | 3 (Base, Linear), 4 (Acrylic, Liquid), 5 (Brutal, Retro), 6 (Y2K, Tinkerer) | самая сильная | 1 |
| 2 | 7 (настройки «Appearance») | средняя | 1 |

Ревью по ходу — только у задачи 1 (движок, на него опираются все). Остальное — итоговое ревью в две половины: движок и данные; стили и интерфейс.

| Приёмка спеки (§11) | Задачи |
|---|---|
| 1 | 1, 7 |
| 2 | 1 |
| 3 | 1, 7 |
| 4 | 3–6 |
| 5 | 1, итоговое ревью |
| 6 | 2 |
| 7 | 1, 3–6 |
| 8 | все |

---

### Task 1: Движок стилей и Neumorphism (спека §3, §4, §6, §8)

Вид приложения после задачи не меняется. Меняется только то, откуда берутся числа. Стиль по умолчанию — `base`, но до задачи 3 его заглушка отдаёт токены Neumorphism.

**Files:**
- Create:
  - `packages/app/app/lib/styles/types.ts`
  - `packages/app/app/lib/styles/color.ts`
  - `packages/app/app/lib/styles/registry.ts`
  - `packages/app/app/lib/styles/apply.ts`
  - `packages/app/app/lib/styles/neumorphism.ts`
  - заглушки `base.ts`, `acrylic.ts`, `liquid.ts`, `linear.ts`, `brutal.ts`, `y2k.ts`, `retro.ts`, `tinkerer.ts` в той же папке: каждая отдаёт токены Neumorphism, пока волна 2 её не заменит;
  - `packages/app/app/lib/appearance.ts`
  - `packages/app/app/plugins/appearance.client.ts` (заменяет `accent.client.ts`)
  - `packages/app/app/composables/useAppearance.ts` (заменяет `useAccent.ts`)
- Modify:
  - `packages/app/app/lib/accent.ts`: copper; тёмные «пастельные» значения из таблицы `ACC` макета, второй столбец;
  - `packages/app/app/lib/device-db.ts`: `style?: StyleName`;
  - `packages/app/app/assets/css/main.css`: токены тем и утилиты читают `--st-*`; `.lucide` берёт толщину и концы линий из токенов; `body` берёт шрифт из `--st-font`;
  - `AccentPicker.vue` — только перевод на `useAppearance`, без нового интерфейса.
- Test:
  - `packages/app/test/styles.test.ts` (новый);
  - `packages/app/test/style.test.ts`, `packages/app/test/accent.test.ts` — переделка под токены из TS.

**Interfaces:**
- Produces (дословно; волна 2 на это опирается):
```ts
export type StyleName = 'base' | 'neumorphism' | 'acrylic' | 'liquid' | 'linear' | 'brutal' | 'y2k' | 'retro' | 'tinkerer'
export type Mode = 'light' | 'dark'
export type KindName = 'ib' | 'add' | 'btn' | 'primary' | 'step' | 'ghost'
export interface KindState { bg: string; img: string; sh: string; fg: string; tf: string }
export interface StyleTokens { /* ключи объекта `k` макета (page, fg, muted, …, tr, led…) + kinds: Record<KindName, { n: KindState; h: KindState; p: KindState }>; каждый ключ с комментарием */ }
export type StyleBuild = (mode: Mode, accent: AccentName) => StyleTokens
export interface StyleInfo { name: StyleName; label: string; fixedPalette: boolean; defaultAccent: AccentName; fonts: string[]; build: StyleBuild }
export const STYLES: Record<StyleName, StyleInfo>
export const STYLE_NAMES: StyleName[]            // порядок S1…S9: base, neumorphism, acrylic, liquid, linear, brutal, y2k, retro, tinkerer
export const DEFAULT_STYLE: StyleName            // 'base' (решение владельца)
export function styleCss(name: StyleName, accent: AccentName): string   // ':root{--st-…}.dark{--st-…}'
export function applyStyle(root: HTMLElement, name: StyleName, accent: AccentName): void
export interface Appearance {
  readonly style: Readonly<Ref<StyleName>>
  readonly accent: Readonly<Ref<AccentName | null>>      // null = «Style default»
  readonly effectiveAccent: Readonly<Ref<AccentName>>    // фиксированная палитра → её акцент; иначе accent ?? defaultAccent
  load(): Promise<void>
  setStyle(name: StyleName): Promise<void>
  setAccent(name: AccentName | null): Promise<void>
}
```
- Значения реестра:

| `name` | `label` | `fixedPalette` | `defaultAccent` | `fonts` |
|---|---|---|---|---|
| `base` | Base | `false` | indigo | `['Onest']` |
| `neumorphism` | Neumorphism | `false` | indigo | `['Manrope']` |
| `acrylic` | Acrylic | `false` | blue | `['Inter']` |
| `liquid` | Liquid glass | `false` | blue | `['Inter']` |
| `linear` | Linear | `false` | indigo | `['Inter']` |
| `brutal` | Neo-brutal | `true` | blue (номинально: палитра Memphis его не использует) | `['Rubik', 'Unbounded']` |
| `y2k` | Y2K | `false` | blue | `['Exo 2']` |
| `retro` | Retro atomic | `true` | teal | `['Jost']` |
| `tinkerer` | Tinkerer | `false` | copper | `['IBM Plex Sans', 'IBM Plex Mono']` |

- **Имена переменных:**
  - `--st-<ключ в kebab-case>`;
  - состояния ролей — `--st-<kind>-<n|h|p>-<bg|img|sh|fg|tf>`;
  - списки (`thumbs`, `chips`, `chipFgs`) — `--st-chip-0…`, по длине списка.
- **Соответствие утилит ролям макета** определяет задача и записывает в комментарии к `main.css`, например `raised` → `btn`, `accent-button` → `primary`, `pill-step` → `step`, `glass` → `pop`, `row-selected` → `cur`.
- **В отчёте задачи** — таблица соответствия и полный список ключей: волна 2 его читает.

- [ ] **Step 1: Тесты (RED)** в `styles.test.ts`:
  - `neumorphism` × light, dark × 10 текущих акцентов совпадает со значениями `main.css` до задачи. Снимок значений взять из `main.css` на базе плана. Copper считается по той же формуле.
  - `applyStyle(a)` → `applyStyle(b)` оставляет на `<html>` ровно один `#gm-style` и `data-style="b"`, переменных `a` нет (Review Focus 1).
  - Для каждого стиля реестра × mode × акцент (у `fixedPalette` — один прогон) контраст ≥ 4.5:1:
    - `fg`, `muted`, `icon` на `page`, `card`, `list`, `pop`;
    - `curFg` на `cur`;
    - `popHoverFg` на `popHover`;
    - `kinds.*.{n,h,p}.fg` на `bg` (у полупрозрачного `bg` — поверх `page`).
  - Ни один токен не содержит `padding`, `margin`, `gap`, `width:`, `height:`, `border-width` (Review Focus 3).
  - `Appearance`:
    - rose в `base` → `retro` даёт `effectiveAccent` teal → снова `base` даёт rose (Review Focus 4);
    - неизвестное или не сохранённое значение стиля → `base`, значение в хранилище не стирается.
- [ ] **Step 2: Порт** `color.ts` (функции `hex`, `mix`, `rgba`, `rot` макета) и `neumorphism.ts` из ветки `style === 'neumorphism'` макета. Где значение приложения отличается от макета, побеждает приложение, тест из шага 1 это фиксирует. Например, тень и вдавливание 160 ms `cubic-bezier(0.4,0,0.2,1)`, а не 200 ms `ease-out` макета.
- [ ] **Step 3:** `registry.ts`, `apply.ts`, `appearance.ts`, плагин (стиль и акцент применяются до монтирования, Review Focus 2), `useAppearance`. Тест плагина: сохранённый стиль стоит на `<html>` до первого рендера.
- [ ] **Step 4:** `main.css` переводится на `--st-*`. Заглушки восьми стилей. Запасной вариант стекла при `prefers-contrast: more` распространяется на все панели с размытием (`popBlur`, `surfBlur`, `hdrBlur`, `ctrlBlur`).
- [ ] **Step 5:** `pnpm test --maxWorkers=3`, `pnpm typecheck`, `pnpm lint`. Два снимка (360 px светлая, 1280 px тёмная, демо-данные): вид как до задачи.
- [ ] **Step 6: Commit** `feat(app): style engine — tokens from TypeScript, Neumorphism unchanged, appearance setting`.

### Task 2: Шрифты стилей и их кэш (спека §7) — волна 1, параллельно с задачей 1

**Files:**
- Modify: `packages/app/nuxt.config.ts` — только `fonts` и `pwa.workbox`, отдельным коммитом.
- Test: `packages/app/test/fonts.test.ts`.

- [ ] **Step 1: Тест (RED):**
  - в `fonts.families` есть все семейства спеки §2: Manrope, Onest, Inter, Rubik, Unbounded, Exo 2, Jost, IBM Plex Sans, IBM Plex Mono;
  - у каждого семейства подмножества `latin`, `latin-ext`, `cyrillic` и насыщенности из ссылки Google Fonts макета;
  - `font-display: swap`;
  - предзагружается только Onest (шрифт Base — стиля по умолчанию);
  - в `globPatterns` попадают `woff2` только Onest;
  - `runtimeCaching` для путей шрифтов `@nuxt/fonts` — `CacheFirst`, только статус 200 (Review Focus 5).
- [ ] **Step 2:** настройка `@nuxt/fonts`. Шрифты скачиваются при сборке и лежат в приложении, в рантайме запросов к Google нет. Проверка: в собранном `.output/public` нет ссылок на `fonts.googleapis.com` и `fonts.gstatic.com`.
- [ ] **Step 3:** Workbox: Onest в precache, остальные `woff2` — `CacheFirst` в своём кэше (`gm-fonts`, до 60 файлов).
- [ ] **Step 4:** `pnpm test --maxWorkers=3`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @graymatter/app generate`. Размер precache до и после — в отчёт.
- [ ] **Step 5: Commit** `build(app): style fonts self-hosted; only the default style's fonts precached, the rest cached on first use`.

### Tasks 3–6: стили (спека §2, §3, §5) — волна 2, после задачи 1

| Задача | Стили | Ветки макета |
|---|---|---|
| 3 | Base, Linear | `base`, `linear` |
| 4 | Acrylic, Liquid glass | `acrylic`, `liquid` |
| 5 | Neo-brutal, Retro atomic | `brutal`, `retro` |
| 6 | Y2K, Tinkerer | `y2k`, `tinkerer` |

**Files** (на каждый стиль `<name>`):
- Modify: `packages/app/app/lib/styles/<name>.ts` — заглушка заменяется портом.
- Create:
  - `packages/app/app/assets/css/styles/<name>.css` — только под `[data-style='<name>']`;
  - строка `@import` в `main.css`, одна на стиль. Конфликт при слиянии разрешает контроллер.
- Test: `packages/app/test/styles-<name>.test.ts`.

**Interfaces:**
- Consumes: всё из задачи 1, список ключей и таблица соответствия — в её отчёте.

- [ ] **Step 1: Тест (RED).** Для light и dark при акценте по умолчанию значения равны макету:
  - `page`, `card`, `cardR`, `cardSh`;
  - `kinds.primary.n.bg`;
  - `pop`, `popR`;
  - `font`, `headFont`, `stroke`, `cap`, `tr`.
  - Для `brutal` и `retro` вывод не зависит от переданного акцента.
- [ ] **Step 2: Порт ветки макета дословно.**
  - `brutal`: порядок Memphis всегда с жёлтого, без поворота по акценту.
  - `retro`: акцент всегда teal.
- [ ] **Step 3: `<name>.css`** — то, что токенами не выразить:
  - фон-рисунок страницы;
  - пометка перед заголовком секции (`mark`);
  - регистр и разрядка подписей;
  - светодиод и уголки Tinkerer;
  - зерно Acrylic;
  - размытие панелей (`backdrop-filter`) — только у панелей, не у каждой строки.
- [ ] **Step 4: Экраны вне досок** — по правилам спеки §5:
  - шторки и диалоги;
  - поля;
  - выпадающие списки;
  - дерево;
  - список предметов;
  - палитра;
  - настройки;
  - «Tags & fields»;
  - уведомления;
  - подсказки;
  - баннеры.

  Правки компонентов — только через токены и `<name>.css`, без изменений разметки, общей для всех стилей. Если без правки разметки не обойтись — остановиться и описать в отчёте.
- [ ] **Step 5: Общий тест контраста задачи 1 зелёный для своих стилей.** Подобранные оттенки — списком в отчёт (что, было, стало, почему).
- [ ] **Step 6: Проверка.** `pnpm test --maxWorkers=3`, `pnpm typecheck`, `pnpm lint`. По два снимка на стиль: 360 px светлая и тёмная, экран предмета с открытым меню `⋯` против доски S1–S9.
- [ ] **Step 7: Commit** `feat(app): <Name> and <Name> styles`.

### Task 7: Настройки «Appearance» (спека §4, §6) — волна 2, после задачи 1

**Files:**
- Create:
  - `packages/app/app/components/StylePicker.vue`;
  - `packages/app/app/lib/theme-color.ts` — если `themeColorMeta` в `shell.ts` удобнее вынести.
- Modify:
  - `AccentPicker.vue`;
  - экран настроек с разделом Appearance;
  - `packages/app/i18n/locales/en.json`;
  - `packages/app/app/lib/shell.ts` (`themeColorMeta`).
- Test: `packages/app/test/appearance-ui.test.ts`.

- [ ] **Step 1: Тест (RED):**
  - порядок карточек — `STYLE_NAMES`;
  - у `fixedPalette` выбор акцента скрыт, а не просто выключен;
  - первый вариант акцента — «Style default» (`null`);
  - `theme-color` берётся из токена `hdr` текущего стиля и темы.
- [ ] **Step 2: `StylePicker`.** Девять карточек-превью в текущей теме.
  - Карточка — маленькая сцена из токенов стиля: фон `page`, карточка `card`, кнопка `primary`, чип, подпись шрифтом стиля.
  - Переменные карточки ставятся на сам элемент карточки, не на `<html>`.
  - Выбор — радиогруппа с клавиатурой.
- [ ] **Step 3: `AccentPicker`.** Добавляется «Style default» и copper. Для Brutal и Retro — вместо выбора строка «This style has its own colours».
- [ ] **Step 4: Проверка.** `pnpm test --maxWorkers=3`, `pnpm typecheck`, `pnpm lint`, один снимок настроек на 360 px.
- [ ] **Step 5: Commit** `feat(app): style picker in Appearance; accent "Style default", hidden for fixed palettes`.

## Итоги выполнения

**Как шло.**
- Волна 1: движок (задача 1) и шрифты (задача 2) параллельно. Ревью движка, исправление по нему шло параллельно со второй волной.
- Волна 2: пять задач сразу — Base + Linear, Acrylic + Liquid, Brutal + Retro, Y2K + Tinkerer, настройки.
- Итоговое ревью в две половины (движок и тесты; вид в браузере), исправления A и B.
- Владелец решил по ходу: стиль по умолчанию — Base.

**Что сделано.**
- 9 стилей × 2 темы из макета владельца, токены считаются в TypeScript (`app/lib/styles/`), рисунки и украшения — `assets/css/styles/<name>.css`.
- Neumorphism совпадает с прежним видом (тест против снимка старого `main.css`, обе темы, все акценты).
- Base — стиль по умолчанию: стартовый цвет страницы, шрифт, заставка PWA.
- «Settings → Appearance»: девять карточек-превью, акцент с «Style default» и copper, у Neo-brutal и Retro atomic выбора акцента нет. `theme-color` — шапка стиля.
- Шрифты всех стилей лежат в приложении с кириллицей; при установке ставится только Onest, остальные кэшируются при первом использовании; у каждого семейства есть метрически подобранный запасной шрифт.
- Тесты: контраст ≥ 4.5:1 для всех стилей × тем × акцентов (включая текст в шторках поверх затемнения и счёт в степпере выбранной строки), рамки полей ≥ 3:1 у Acrylic, Liquid, Y2K; стили не задают отступы и размеры.
- Итог: `pnpm test` — 3281 пройдено, 21 пропущен (119 файлов). `typecheck` и `lint` — 0.

**Что поймали ревью.**
- **Критическое:** своя `manifestTransforms` для шрифтов отключала преобразование модуля PWA — собранный service worker не устанавливался (ни обновлений, ни работы без сети). Исправлено хуком `pwa:beforeBuildServiceWorker`; в `deploy.yml` добавлена проверка собранного `sw.js`.
- Насыщенность чисел и кнопок не применялась; исключение в тесте контраста было шире нужного; тесты переключения стиля были слишком слабыми.
- Новые пары контраста («⋯» в выбранной строке) не проходили у Liquid и Acrylic в тёмной теме.
- Высота карточки остатка зависела от шрифта стиля; строка кнопок в настройках переносилась по-разному; фокус в выборе стиля не отличался от выбора; края шторок терялись на затемнении; уведомление не следовало стилю.

**Решения контроллера.**
- Длинный текст может переноситься по-разному: у стилей разные шрифты (спека §3 дополнена).
- Исправление движка шло параллельно со второй волной; стартовые значения переключила задача Base.
- Отдельного повторного ревью исправления B не было (темп владельца); измерения в браузере и тесты — в отчёте.

**Отличия от макета ради контраста** (полные списки — в отчётах задач):
- Liquid тёмный: «⋯» на выбранной строке при наведении темнеет, а не светлеет; число в степпере выбранной строки — цветом текста; у главной кнопки нет диагонального блика.
- Y2K: блик «геля» короче, сама кнопка на 12 % глубже; шторки в светлой теме плотнее; текст тихих кнопок при наведении глубже.
- Tinkerer: медная кнопка в светлой теме глубже.
- Neo-brutal: приглушённый текст `#282828`, красный опасных действий `#B80F2A`, в тёмной теме подсветка меню тёмно-жёлтая.
- Retro: несколько оттенков миниатюр, наведения и выбранной строки.
- Acrylic: шапка — полупрозрачная полоса (под ней прокручивается содержимое); шторки Acrylic и Liquid непрозрачные.

**Перенос.**
- Решение владельца: рамки полей 1.3–1.5:1 у Base, Neumorphism, Linear, Retro, Tinkerer (Brutal — чёрная линия); WCAG 1.4.11 хочет 3:1.
- Решение владельца: «⋯» на выбранной строке у Neumorphism при наведении 3.9–4.5:1 (было и до стилей).
- Решение владельца: «Add variants» — кнопка с рамкой в приложении, главная кнопка в макете.
- До чтения настроек страница у всех цвета Base (доли секунды при старте).
- Цена размытия на весь экран у Acrylic на слабом телефоне не измерена.
- Сравнение с досками S1–S9 и экраны вне досок — проход владельца на телефоне.
