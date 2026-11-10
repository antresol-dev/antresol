# GrayMatter

GrayMatter is a collection of tools for personal use to help me dealing with everyday stuff.
For now, it only contains a single tool -- Inventory project which was primarily created to organize electronic components.

## GrayMatter (revival)

The Nuxt app in `packages/app` on the `revival` branch is the new version. The Inventory section below describes the legacy app.

## Photos with Uploadcare

Photos are stored in [Uploadcare](https://uploadcare.com/). Setup for each source:

1. Create a project in the [Uploadcare dashboard](https://app.uploadcare.com/).
2. Copy the project's public key.
3. Turn signed uploads off in the project. The app has no secret key, so it cannot sign uploads.
4. Paste the key into the "Uploadcare public key" field of the source in GrayMatter's settings.
5. Mind the free plan limits: 1,000 operations per month (each upload is one operation, and so is each first request for an image size), 1 GB of storage and 5 GB of traffic per month. When a limit is exceeded, photos stop loading until next month. The inventory keeps working. Pricing: <https://uploadcare.com/pricing/>.
6. The app never deletes files. To remove a photo from Uploadcare, delete it in the dashboard.

The "Photo address" field is the CDN domain used to show photos. Projects created after September 2025 get a personal `*.ucarecd.net` domain, shown in the dashboard under Delivery; paste it there. Leave the field empty to use `ucarecdn.com`, which is right for projects created before September 2025.

## Inventory

I'm currently deeply involved in DIY synthesizers, including both analog and digital.
When my carts from AliExpress began to be large and amount of distinct electronic components became so large I sometimes reordered the same thing multiple times, I started thinking about some organization of that stuff.
Tried different options but the best one was Sortly as it is friendly for personal use and has a bunch of convenient features. Anyway, it is pricey, I quicly went over the limit of 100 distinct items.
Thus, because I love reinventing the wheel, I started this project.

### Screenshots:
<img src="https://github.com/hazer-hazer/graymatter/assets/29581311/bdeaca77-7b86-4717-b4d6-e5a40f75366c" width="500px">

### Stack

Both front-end and back-end use Typescript, modern ESLint with stylistic

**Front-end**:
- Vue.js v3 with Nuxt.js
- Pinia
- Quasar.js
- Material UI (via Quasar)

**Back-end and storages**:
- Node.js 21
- Fastify
- PostgreSQL with Prisma.js
- AJV with self-written JSON schema from TypeScript type definitions

### Features

- Any count of inventories can be created
- File-system-like hierarchy of folders and items. Special "Trash folder" is a kind of archive of items. 
- Item variants. Example: Item Resistor contains variants 1Ω, 1KΩ, 100KΩ, etc.
- Images for all of the above and some of them support image galleries.
- Custom attributes with user-defined schemas. For example: Model, shoe size
- Supports any ISO 4217 currency and prices
- Smart amount units system. Not only count (pcs) supported, you can even use meters to set the amount of item.
- Buy-lists with auto-check feature which watches amounts of items in list.
- Real life items flow: arrivals, usages and returns
  - Arrivals denote that some list of items is on the way to you, when it arrives you just click a button to add them
  - Usages say what some amount of item is used for
  - Returns not just magically increases the amount of items but says that something used got back because of some reason

### Planned

- Better search capabilities
- API for Personal Assistants (e.g. Yandex Station)
- Notifications 
