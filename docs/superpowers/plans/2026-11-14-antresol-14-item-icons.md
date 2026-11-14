# Иконка вместо фото (бэклог F5) — план реализации

**Goal:** у предмета и у папки можно выбрать иконку из набора владельца, а не загружать фото. Тогда провайдер фото не нужен.

Иконка папки — иконка по умолчанию для предметов в ней. Порядок показа миниатюры:

1. фото;
2. своя иконка предмета;
3. иконка его папки;
4. буквы папки;
5. общая иконка `Package`.

Цвет фона, как и сейчас, по id предмета.

**Где:** ветка `structural-ux`, worktree `.worktrees/preview`; задачи в своих worktree, вливаются по готовности. Без проверки в браузере: владелец смотрит сам. Ревью отдельной задачи — только у задачи 1 (данные). В конце одно ревью ветки.

## Решения (по умолчанию; владелец может поправить до запуска)

- **Хранение.** Поле `icon: string | null` у `Item` и `Folder`. В базе это колонка `icon text NULL` (миграция `0004`). Значение — имя иконки Lucide (`microchip`).
- **Проверка в ядре:** только форма имени (`^[a-z0-9-]{1,40}$`), без списка. Набор живёт в приложении и может расти без изменения ядра. Неизвестное имя рисуется как следующий шаг порядка показа, будто иконки нет.
- **Только предмет и папка.** Варианты остаются с фото, без иконок.
- **Где выбирать:**
  - в форме правки предмета (Edit item);
  - в форме папки (New folder, Rename);
  - в карточке предмета без фото — тап по квадрату 64 открывает лист: «Фото» (камера / галерея) и «Иконка».
  - в быстром добавлении (FAB) поля нет: предмет и так получает иконку папки.
- **Выбор иконки** — лист с поиском по имени и сеткой по группам владельца, сверху «Без иконки». Текущая иконка выделена.
- **Набор иконок грузится отдельным куском при первой нужде,** чтобы не утяжелять первую загрузку. Пока кусок не пришёл, миниатюра показывает буквы папки.
- **Плитка папки в списке** показывает её иконку вместо значка папки. Дерево не меняется.
- **Резервные копии.** Поле `icon` входит в копию. Старые копии без поля восстанавливаются с `icon = null`.

## Набор иконок (выбор владельца, 2026-11-14)

Группы для листа выбора (заголовки без пометок «сомнительно»):

- **Хранение и упаковка:** package package-2 package-open box boxes archive container carton barrel can amphora backpack briefcase briefcase-business luggage handbag shopping-bag shopping-basket paper-bag groceries gift wallet wallet-minimal mailbox vault shelving-unit toolbox tool-case plant-pot bottle-wine pill-bottle tube-lotion perfume-bottle soap-dispenser-droplet milk can-soda cup-soda glass-water coffee trash tag tags baggage-claim
- **Электроника и компоненты:** cpu microchip circuit-board memory-stick gpu hard-drive server server-nas pc-case computer laptop laptop-minimal monitor monitor-pc keyboard mouse smartphone tablet tablet-smartphone tv tv-minimal projector printer printer-3d webcam camera cctv drone router radio radio-receiver satellite-dish antenna speaker boom-box headphones headset earbuds mic mic-vocal turntable cassette-tape disc disc-3 videotape film gamepad gamepad-2 gamepad-directional joystick calculator watch alarm-clock flashlight lightbulb battery battery-full battery-charging car-battery plug plug-zap unplug cable usb usb-c-port hdmi-port ethernet-port midi-port card-sim nfc power zap magnet fan heater solar-panel ev-charger bell-electric alarm-smoke robot-arm robot-vacuum bot keyboard-music smartphone-charging spool thermometer gauge scale weight component atom binary bluetooth wifi laser utility-pole radio-tower satellite
- **Инструменты и крепёж:** wrench hammer drill axe pickaxe shovel anvil screw nut bolt scissors pocket-knife ruler ruler-dimension-line drafting-compass pencil-ruler paintbrush paintbrush-vertical paint-roller paint-bucket spray-can brush pipette funnel hard-hat fire-extinguisher broom mop brush-cleaning key key-round lock lock-keyhole fishing-rod fishing-hook hiking-stick construction traffic-cone gavel sword shield cog settings lasso flame-kindling
- **Мебель и дом:** armchair sofa bed bed-double bed-single rocking-chair lamp lamp-ceiling lamp-floor lamp-wall-down lamp-wall-up blinds bath shower-head toilet towel-rack faucet washing-machine refrigerator microwave blender cooking-pot utensils mirror-round mirror-rectangular umbrella toothbrush bell chef-hat concierge-bell air-vent parasol clock hourglass door-open door-closed fence house flower-2
- **Одежда и личное:** shirt sport-shoe glasses gem crown ribbon hat-glasses baby id-card credit-card medal venetian-mask feather award
- **Канцелярия и бумага:** book book-open notebook notebook-pen notepad-text clipboard sticky-note paperclip pin pen pencil highlighter eraser stamp sticker newspaper swatch-book palette scroll library origami presentation certificate receipt banknote coins piggy-bank mail file
- **Хобби, спорт, музыка, игры:** bike scooter dumbbell volleyball rugby-ball hockey-stick kayak tent bow-arrow guitar guitar-electric drum piano metronome dices playing-cards chess-knight toy-brick puzzle telescope binoculars microscope compass whistle chess-pawn chess-rook chess-queen chess-king chess-bishop sailboat swords trophy balloon clapperboard rocket
- **Лаборатория и медицина:** flask-conical flask-round beaker test-tube test-tubes syringe pill tablets bandage stethoscope briefcase-medical iv-bag dna radiation biohazard heart-pulse
- **Транспорт:** car motorbike plane
- **Еда и продукты:** apple banana carrot egg wheat bean cookie cake croissant pizza sandwich soup salad cherry grape citrus avocado mango broccoli leafy-green beef ham bacon drumstick fish shrimp candy lollipop ice-cream-cone popsicle donut cupcake popcorn wine beer martini
- **Сад и природа:** sprout flower leaf rose stone shell bone bird cat dog

## Задачи

| # | Что | Файлы | Готово, когда |
|---|---|---|---|
| 1 | **Данные.** `icon` у `Item` и `Folder`; `item.create` / `item.update` / `folder.create` / `folder.update` принимают `icon`; проверка формы имени; миграция `0004_icons.sql` (drizzle-kit только генерирует); строки, патчи, синхронизация; резервная копия: экспорт, импорт, восстановление старых копий без поля, режим «новые id» | `packages/core`, `packages/storage-postgres`, `app/lib/backup.ts` и восстановление | Тесты ядра и хранилища (PGlite; Neon `_test` — один прогон набора соответствия); старая копия восстанавливается с `icon = null`; ревью задачи (opus) |
| 2 | **Набор и показ.** `app/lib/item-icons.ts`: группы владельца (только имена) и ленивый загрузчик набора компонентов; тест, что каждое имя есть в `@lucide/vue`. `ItemThumb` по порядку показа (`ItemRow` и `SearchRow` получают `icon` и `folderIcon`). Плитка папки в `FolderList` | `lib/item-icons.ts`, `lib/views.ts`, `ItemThumb.vue`, `FolderList.vue`, тесты | Порядок показа покрыт тестом выборки; неизвестное имя → следующий шаг |
| 3 | **Выбор.** Лист `IconPicker` (поиск, группы, «Без иконки»); поле «Icon» в формах предмета и папки; квадрат 64 в карточке без фото → лист «Фото / Иконка»; в карточке с иконкой и без фото квадрат показывает иконку | `IconPicker.vue`, `ItemForm.vue`, `FolderForm.vue`, `ItemGallery.vue`, i18n | Выбор и сброс сохраняются командой; design-scale guard зелёный |

Задача 2 зависит от 1 только типами. Её можно начать параллельно на заглушке поля и влить после 1. Задача 3 идёт после 1 и 2.

## Перенос

- Иконки вариантов — если понадобятся.
- Поиск иконок по смыслу (теги Lucide, русские слова).
