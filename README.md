# GrayMatter

GrayMatter is a personal inventory app for small things, mostly electronic components. It runs in the browser, works offline once loaded, and installs on your phone like an app.

The idea: you are at the workbench or in a shop and wonder "do I have a TL072?". Open GrayMatter, type "TL072" into search, and see how many you have and which drawer they are in.

Your data lives in your own free Neon (Postgres) project. There is no GrayMatter server and there are no accounts.

## Use it

1. Open the app at the address of your GitHub Pages site (see "Deploy your own" below).
2. Install it as an app. On Android Chrome: menu, then "Install app".
3. Add a source. Create a free project at [Neon](https://neon.tech/), copy its connection string, and paste it into GrayMatter's settings. The connection string stays on your device.
4. Optional: set up photos (see below).

### Backups

Open Settings, pick your source, and press "Export backup". It saves a JSON file. Neon's free plan keeps only about 6 hours of restore history, so export regularly. Photos are kept as links (URLs) only, not as files, so the backup does not contain the pictures themselves. Importing a backup is not available yet.

### Photos with Uploadcare (optional)

Photos are stored in [Uploadcare](https://uploadcare.com/). Setup for each source:

1. Create a project in the [Uploadcare dashboard](https://app.uploadcare.com/).
2. Copy the project's public key.
3. Turn signed uploads off in the project. The app has no secret key, so it cannot sign uploads.
4. Paste the key into the "Uploadcare public key" field of the source in GrayMatter's settings.
5. Fill the "Photo address" field. Projects created after September 2025 must paste their personal `*.ucarecd.net` address, shown in the dashboard under Delivery (for example `https://abc123.ucarecd.net`, without a path). Leave it empty to use `ucarecdn.com`, which is right only for projects created before September 2025.
6. Mind the free plan limits: 1,000 operations per month (each upload is one operation, and so is each first request for an image size), 1 GB of storage and 5 GB of traffic per month. When a limit is exceeded, photos stop loading until next month. The inventory keeps working. Pricing: <https://uploadcare.com/pricing/>.
7. The app never deletes files. To remove a photo from Uploadcare, delete it in the dashboard.

Custom CNAME CDN domains are not supported: only `ucarecdn.com` and `*.ucarecd.net` addresses are accepted, and photos on any other domain would not display.

## Develop

Use pnpm. Plain npm fails in the repo root because `devEngines` pins Node.

```sh
pnpm install
pnpm dev
```

- Demo data exists only in development. Run `pnpm dev` and open `/welcome`. Production builds have no demo.
- Checks: `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- Some tests need a real Neon database. Put its connection string in `GM_NEON_TEST_URL` in `.env.local`. The database name must end in `_test`, so the tests never touch real data. Without the variable, those tests skip themselves.
- Devices skip reloading an inventory when the revision in `gm_meta` is unchanged, and only writes through the app change it. After editing data with SQL (for example in the Neon console), run `insert into gm_meta (key, value) values ('rev', gen_random_uuid()::text) on conflict (key) do update set value = excluded.value`, or other devices will not notice the change.
- To try the dev server on a phone over USB, run `adb reverse tcp:3000 tcp:3000` and open `http://localhost:3000` on the phone.

## Deploy your own

1. Fork the repository.
2. In the fork, go to Settings, Pages, and set the source to "GitHub Actions".
3. Push to `master`. The workflow in `.github/workflows/deploy.yml` runs the checks, builds the app with the right base path, and publishes it.

## Privacy

- There is no server and there are no accounts. The app talks straight to your Neon database (and to Uploadcare if you use photos).
- The connection string is stored in IndexedDB on your device.
- Production builds set a Content Security Policy as a meta tag. It allows only Neon, Uploadcare and the fonts the app needs.

**Shared origin on GitHub Pages.** All Pages sites of one account share the origin `<user>.github.io`, and IndexedDB belongs to the origin. Any other Pages site on the same account could read your connection string. Before you enter real data, do one of these:

- connect your own domain to Pages (set it in Settings, Pages, Custom domain; with Actions-based deploys a `CNAME` file is ignored; free HTTPS), or
- host somewhere that gives each project its own origin, for example Cloudflare Pages (`*.pages.dev`).

If you change the origin later, the device data is lost: you add the source again. The data in Neon is not affected.

## Legacy

The old `api/` and `web/` apps (Fastify, PostgreSQL, Quasar) are kept in the repository for reference. They are not part of the new app. Their description follows.

### Inventory

I'm currently deeply involved in DIY synthesizers, including both analog and digital.
When my carts from AliExpress began to be large and amount of distinct electronic components became so large I sometimes reordered the same thing multiple times, I started thinking about some organization of that stuff.
Tried different options but the best one was Sortly as it is friendly for personal use and has a bunch of convenient features. Anyway, it is pricey, I quicly went over the limit of 100 distinct items.
Thus, because I love reinventing the wheel, I started this project.

#### Screenshots
<img src="https://github.com/hazer-hazer/graymatter/assets/29581311/bdeaca77-7b86-4717-b4d6-e5a40f75366c" width="500px">

#### Stack

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

#### Features

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

#### Planned

- Better search capabilities
- API for Personal Assistants (e.g. Yandex Station)
- Notifications 
