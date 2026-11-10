# 01 — Competitive landscape and patterns worth stealing

*GrayMatter overnight review, track 1. Researched 2026-11-11.*

**How this was researched.** I used official pricing pages, docs, release pages and GitHub repos, plus first-hand threads on Hacker News (Algolia API), EEVblog, GitHub Discussions and Trustpilot.
- **Reddit:** reddit.com and its mirrors are blocked for my fetcher, so there are no Reddit quotes. HN and EEVblog threads on the same questions are used instead.
- **Mod Wiggler:** the forum returns 403, so its quotes come from search-engine snippets and are marked *(snippet)*.
- **Unverified claims** are marked *(unverified)*.

---

## 0. Landscape in brief

**Home-inventory SaaS** (Sortly, BoxHero, Itemtopia, Nest Egg):
- photo-first and pretty;
- meters items, history, alerts and labels;
- Sortly's 2025 repricing made users angry.

**Self-hosted open source** (Homebox, Grocy, InvenTree, Part-DB, Binner, Shelf):
- free and powerful, but needs a server and an account;
- the electronics tools assume parts have a manufacturer part number (MPN) and a DigiKey, Mouser or LCSC barcode.

**Spreadsheets, text files and "no system"** are what most hobbyists actually use. They say upkeep is the hard part.

No product fits this owner's case: AliExpress bags without MPNs or barcodes, a phone in hand while shopping, no server, no budget. None of the products checked offers a **duplicate check at capture** or a **"share from the shop app → do I have it?"** flow, and export is often weak or paywalled.

---

## 1. Feature matrix

Legend: **Y** = has it, **P** = partial / paid-only / awkward, **N** = no, **?** = unverified.

| Product | Hosting · cost for 1 hobbyist | Organisation | Variants | Units / fractional | Stock history | Fast "do I have it?" | Phone capture | Labels / scan | Low stock | BOM / projects | Import / export | No-account single user |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Sortly** | SaaS; Free = 100 unique items, 1 custom field; paid from $24/mo | Nested folders | P: ≤3 attributes, only at creation | P | P (paid) | Y | Y native | Y QR/barcode (QR unlimited from Advanced) | P paid | N | Y CSV | N |
| **BoxHero** | SaaS; Free = 100 items, 1 location, 30-day history | Locations + attributes | N | ? | P | Y | Y | P (custom labels paid) | P paid | N | Y Excel | N |
| **Itemtopia / Nest Egg** | Apps; ~€8.49/mo / $6.99 | Locations or categories | N | N | N | Y | Y | P UPC | N | N | ? | Y (Nest Egg Lite, local) |
| **Encircle** | Free home tier reportedly ended Dec 2025 *(unverified)* | Rooms | N | N | N | P | Y | N | N | N | Y | N |
| **Homebox** | Self-host Go/SQLite, free | Nested locations; items and locations merged into "entities" (v0.26) | N (templates) | Y (v0.25) | N | Y (v0.27 tokenised / Meilisearch) | P web | Y asset IDs, label sheets, QR, AR | N | N | Y CSV `import_ref`, ZIP | N |
| **Grocy** | Self-host PHP, free | Locations + groups | P parents | Y unit conversions | Y journal + undo | Y | P PWA, no offline | Y barcode | Y → shopping list | P recipes | P | Y `DISABLE_AUTH` |
| **Snipe-IT** | Self-host free; hosted $39.99/mo | Locations; assets, consumables, components | N | N | Y audit | Y | P | Y | Y | N | Y | N |
| **Shelf.nu** | AGPL + SaaS | Locations, kits | N | Y qty-tracked (2026) | Y log | Y | Y app | Y QR on every asset | Y email | N | Y CSV | N |
| **Memento DB** | Android app, local-first | DIY tables | — | — | P | Y | Y | P ZXing | P | N | Y | Y |
| **InvenTree** | Self-host Django, free; native app | Categories × nested stock locations | Y | Y pint units, pack qty | Y per stock item | Y | Y app | Y QR, LCSC/DigiKey plugins | Y | Y builds | Y | N |
| **Part-DB** | Self-host PHP, free | Categories × storage locations | N | P parameters | Y event log, revert | Y parametric | P web, webcam scan | Y label generator | Y | Y "can build N" | Y; info providers, MCP | P anonymous user *(unverified)* |
| **PartsBox** | SaaS; Maker free, 1 user | Parts × flat storage names (`b01-a4`) | P meta-parts | Y vendor/stock units | Y per lot | Y "instant", DB in browser | P web | Y ZPL; USB scan free, camera paid | ? | Y shortfalls | Y full JSON | N |
| **Binner** | Self-host .NET, free ≤3 users | Categories, bins | N | N | ? | Y | P | Y DigiKey 2D, Dymo | ? | P | Y order import | N |
| **BOMIST** | Desktop; free 100 parts; $15/mo | Parts + storage | P | ? | Y | Y | N | Y | ? | Y | Y | Y local |
| **PartKeepr** | Archived 2025-07-02 | Categories + locations | N | N | Y | Y | N | P | Y | Y | Y | N |
| **JLC / LCSC My Parts** | Free, JLC assembly only | Supplier warehouse | — | — | Y | P | P | N | P | Y BOM tool | P | N |
| **Sheets / Notion / text** | Free | Anything | P | P | N | P | P | N | P | Y (BOM tabs) | Y | Y |
| **GrayMatter today** | Static PWA + Neon free | Inventories → folder tree | Y (any time, bulk) | Y SI prefixes, custom units | Y append-only journal | Y offline MiniSearch | Y quick add | N | N | N | N | Y (connection string) |

GrayMatter's core model (folders, variants, journal, units) already beats every home-inventory SaaS. For a hobbyist it is close to Part-DB and InvenTree, without their server and accounts. Its gaps are at the edges: capture from the shop, labels, export and BOMs.

---

## 2. Per-product notes

### Home and personal inventory

**Sortly** ([pricing](https://www.sortly.com/pricing/)) is the owner's visual reference.
- **Free tier:** 100 unique items, 1 custom field. Quantities don't count toward the cap.
- **Variants:** at most 3 attributes, and only when the item is created; existing items "can't receive variants" ([help](https://help.sortly.com/how-to-create-item-variants)).
- **Add flow:** only Name and Quantity are required. There is no "add another" and no duplicate warning; batch entry means clones or Bulk Import ([help](https://help.sortly.com/how-to-add-items)).
- **Scan-to-add:** standard barcodes only, no QR.
- **Alerts:** paid.
- **Trustpilot (3.1/5):** dominated by the Aug–Sep 2025 repricing: "$468 to $1,467", "900% price increase in two years", "bait and switch". Praise goes to "lightning-fast" search and QR labels ([Trustpilot](https://www.trustpilot.com/review/sortly.com)).

**Homebox** ([releases](https://github.com/sysadminsmedia/homebox/releases)) is the leading self-hosted home inventory; v0.27.1 shipped 23 Oct 2026.
- **Recent milestones:**
  - v0.21: barcode product lookup ([notes](https://newreleases.io/project/github/sysadminsmedia/homebox/release/v0.21.0));
  - v0.22.1: item templates;
  - v0.25: fractional quantities and tag hierarchy;
  - v0.26: items and locations merged into one "entity" (containers are things), an AR overlay for its QR codes, and experimental ZIP export/import;
  - v0.27: tokenised search.
- **Labels and import:** auto asset IDs (`000-001`), `#ID` lookup and a label-sheet generator ([tips](https://hay-kot.github.io/homebox/tips-tricks)). CSV import takes location paths ("Home / Office / Desk") and an `HB.import_ref` that makes re-imports idempotent ([CSV docs](https://hay-kot.github.io/homebox/import-csv/)).
- **A real setup** ([#796](https://github.com/hay-kot/homebox/discussions/796)):
  - a "first entry box" for new purchases;
  - DataMatrix instead of QR because it reads better small, with the ID printed beside it;
  - codes that don't resolve off the LAN;
  - "re-buying cheap cables was sometimes easier than searching."
- **Forks and add-ons:** Homebox has no stock journal; the TubeTrack fork adds "an append-only log of every quantity change" ([TubeTrack](https://codeberg.org/JamesCodes/TubeTrack)). The third-party Homebox Companion adds several items from one photo with an LLM ([AlternativeTo](https://alternativeto.net/software/homebox-companion/about)).

**Grocy** ([site](https://grocy.info/), v4.7.1, Sep 2026) is the closest analogue to GrayMatter's journal.
- **Undo:** `/stock/bookings/{id}/undo` and `/stock/transactions/{id}/undo`.
- **Low stock → shopping:** minimum stock feeds shopping lists, and "Adds all missing products for the given recipe to the shopping list" (recipe as BOM).
- **Units:** purchase vs stock units ([OpenAPI](https://raw.githubusercontent.com/grocy/grocy/master/grocy.openapi.json)).
- **Single user:** `Setting('DISABLE_AUTH', false)` removes login ([config](https://raw.githubusercontent.com/grocy/grocy/master/config-dist.php)).
- **Limits:** camera scanning needs HTTPS, and there are "no offline capabilities" ([README](https://github.com/grocy/grocy)).

**BoxHero** ([pricing](https://www.boxhero.io/en/pricing)): the free plan has 100 items, 1 location and 30 days of history. Low-stock alerts and custom labels are on the $24/mo plan. History is what they meter.

**Itemtopia, Nest Egg, Encircle:**
- **Itemtopia** shows prices only in the app ([pricing](https://www.itemtopia.com/pricing)).
- **Nest Egg** costs $6.99 and has categories or locations, 10 photos per item and UPC lookup. Its Lite version has "no subscription or ads" and no account ([App Store](https://apps.apple.com/app/id431188993)).
- **Encircle:** search snippets of its help centre say the free home tier ended on 17 Dec 2025. I couldn't reach the page *(unverified)*.

**Snipe-IT** ([pricing](https://snipeitapp.com/pricing)) is an IT-asset tool: free self-hosted, $39.99/mo hosted. Its assets/consumables/components split is overkill here.

**Shelf.nu** ([repo](https://github.com/shelf-nu/shelf.nu)) puts a QR on every asset. In Jun 2026 it added quantity-tracked consumables ("used up" vs "returnable") with a min-quantity email and an audit log ([update](https://www.shelf.nu/updates/quantity-tracked-assets)).

**Memento Database** ([site](https://mementodatabase.com/)) is a local-first Android DIY database with ZXing scanning.

**Sheets, Notion and Airtable** are what synth DIYers report *(snippets)* ([thread](https://www.modwiggler.com/forum/viewtopic.php?t=170916), [thread](https://modwiggler.com/forum/viewtopic.php?t=128010)):
- "an excel workbook with a page for inventory, a page for each project's BOM and a final page with items that I need to purchase";
- Airtable for "pull-down menus and linked sheets";
- and the counterpoint: "I'd spend all my time maintaining it rather than making stuff".

### Maker and electronics parts

**InvenTree** ([docs](https://docs.inventree.org/en/stable/part/)) is active; 1.7.1 shipped 8 Nov 2026.
- **Model:**
  - a part is the archetype, and stock items are lots in nested locations; "structural" locations hold no stock ([stock](https://docs.inventree.org/en/stable/stock/));
  - template/variant parts;
  - pack quantities in compatible units ("100 ft = 30.48 m");
  - minimum stock → "low stock";
  - build orders.
- **Mobile:** a native app with context-sensitive barcode actions, "Scan Items Into Location" and "Assign Barcode" ([app](https://docs.inventree.org/en/stable/app/barcode/)). An LCSC barcode plugin exists ([plugin](https://docs.inventree.org/en/stable/plugins/builtin/barcode_lcsc/)).
- **Verdicts:**
  - "may be total overkill for basic/hobbyist needs" ([HN](https://news.ycombinator.com/item?id=36669004));
  - one reviewer's Docker install failed ([ambient_node](https://ambientnode.uk/self-hosted-inventory-and-asset-management-systems)).

**Part-DB** ([repo](https://github.com/Part-DB/Part-DB-server)) is the hobbyist favourite; 2.20.5 shipped 6 Nov 2026.
- **Model and labels:** categories, footprints and storage locations. Template-based labels for parts, lots and locations ([labels](https://docs.part-db.de/usage/labels.html)); since 2.7, a location label can list its contents ([v2.7](https://newreleases.io/project/github/Part-DB/Part-DB-server/release/v2.7.0)).
- **Projects:** BOMs with "how many you can build" and withdrawal.
- **Info providers** ([docs](https://docs.part-db.de/usage/information_provider_system.html)): LCSC, DigiKey, Mouser and more, plus:
  - a **generic Schema.org URL provider**;
  - an **AI web extractor** and "create part from URL" ([v2.11](https://newreleases.io/project/github/Part-DB/Part-DB-server/release/v2.11.0)).
- **AI connectors:** an **MCP server**, with OAuth for "AI applications like claude.ai" ([v2.15](https://newreleases.io/project/github/Part-DB/Part-DB-server/release/v2.15.0), [MCP](https://docs.part-db.de/api/mcp.html)). That is GrayMatter's post-MVP idea, already shipped.
- **Hosting:** needs PHP 8.2+ and a database server.
- **HN users** like the BOM import and scanner-driven entry ([HN](https://news.ycombinator.com/item?id=37146685)).

**PartsBox** ([pricing](https://partsbox.com/pricing.html), [FAQ](https://partsbox.com/faq.html)): the free Maker plan has one user and one currency.
- **Paywalled:** camera scanning, attachments and the API.
- **Architecture:** like GrayMatter's, "the database is held in the browser, so search is instant once loaded."
- **Storage:** a *flat* list where the hierarchy is in the name (`b01-a4`). The FAQ says to settle the scheme before printing labels, "since renaming is inconvenient once labels are affixed."
- **Export:** full JSON, because "the data model is not flat."
- **Labels:** ZPL / Zebra only.
- **EEVblog** ([2016](https://www.eevblog.com/forum/projects/partsbox-io-a-good-parts-inventory-management-solution/), [2022](https://www.eevblog.com/forum/chat/what-is-your-solution-for-keeping-and-tracking-parts/)):
  - founder: "I never, ever want to hold your data hostage";
  - users: "just the lack of data import is a no-fly";
  - CSV export "losing history".

**Binner** ([repo](https://github.com/replaysMike/Binner)) reads DigiKey 2D labels, prints to Dymo, and imports orders. The README lists AliExpress among them; how isn't documented *(unverified)*. Its pattern: the order, not the part, is the unit of capture.

**BOMIST** ([pricing](https://bomist.com/pricing)) is a local desktop app: free up to 100 parts, Maker $15/mo.

**PartKeepr** was "archived by the owner on Jul 2, 2025" ([repo](https://github.com/partkeepr/PartKeepr)).

**JLC "My Parts Lib"** tracks only stock held in JLC's warehouse for assembly ([help](https://jlcpcb.com/help/article/how-to-build-your-own-parts-library-in-jlcpcb)).

**Kitspace 1-click BOM** status in 2025–26 is unknown *(unverified)*.

**AliExpress order exporters** are third-party Chrome extensions that export order history (title, SKU, product URL, price) to CSV ([example](https://chromewebstore.google.com/detail/aliexpress-shopper-invent/dljccnpkpnakeejeingicaapdcjmbefk)). They make serverless import feasible, but they are unvetted.

### What hobbyists actually do

- **[Ask HN: organising components](https://news.ycombinator.com/item?id=41861158):**
  - drawers, bags and labels everywhere, little software;
  - the one phone lookup is a text file per drawer synced with Syncthing;
  - "prefer search over a maintained taxonomy."
- **EEVblog 2022:**
  - "it doesn't help me if I don't know I have them";
  - upkeep is "a whole job in itself";
  - "KISS applies."
- **[HN on HomeSheet](https://news.ycombinator.com/item?id=30919445):**
  - fear that "the pricing is obscene later";
  - "never trust a hosted web app";
  - "photograph everything" now, catalogue later;
  - barcode scanners "act as keyboard input";
  - users ask for hierarchies but "almost never" use them.

---

## 3. Steal list

Package names refer to the repo: **core** = `packages/core/src`, **storage** = `packages/storage-postgres/src`, **app lib** = `packages/app/app/lib`, **components** = `packages/app/app/components`.

**S1. "You already have this" while typing in quick add.**
- **What:** as the name is typed, show up to 3 existing items or variants with their quantity and path. A tap switches to "Receive into this", keeping the amount, price and link.
- **Why:** duplicates are the founding pain. Sortly has no duplicate warning, and users re-buy rather than search.
- **Fit:** client only; the index is already in memory.
- **Effort:** S.
- **Risks:** generic names are noisy. Use exact and prefix tiers only, and never block Save.
- **Sketch:**
  - app lib `quick-add.ts`: `existingMatches(name, search, snapshot)`.
  - `QuickAddForm.vue`: a debounced watch renders the rows and emits `receive-existing(itemId, variantId)`.
  - `QuickAddSheet.vue` opens `StockSheet` in `receive` mode with the typed fields (`buildStockCommand`).

**S2. Share from AliExpress or any app to GrayMatter.**
- **What:** a manifest `share_target` (GET) opens `/share`. GrayMatter extracts the link and a cleaned title, then opens the palette with that query and an "Add item '…'" action with the link pre-filled.
- **Why:** the in-the-moment lookup starts *inside the shop app*. Today it's copy, switch, open palette, paste. No competitor does this; their mobile capture is barcode-centric.
- **Fit:**
  - Chrome Android 76+, installed PWA only ([docs](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)).
  - "On Android the url field will be empty". The link arrives in `text`.
- **Effort:** M.
- **Risks:**
  - The AliExpress share-text format is *(unverified)*.
  - Short links (`a.aliexpress.com/_…`) can't be expanded without a server because of CORS.
  - Titles are SEO soup, so strip "100PCS", "lot" and brand noise.
- **Sketch:**
  - `nuxt.config.ts`: `pwa.manifest.share_target = { action: '/share', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } }`.
  - app lib `share.ts`: `parseShared() → { query, link }`, unit-tested on real strings captured on the owner's phone.
  - `pages/share.vue` replaces itself with the last inventory and opens `SearchPalette` with the query. The "Add item" action passes `link` into quick add.

**S3. Match by purchase link or shop ID.**
- **What:** normalise receipt links to keys (`/item/(\d+).html` → `ali:…`, LCSC `C\d+`, otherwise host+path). Pasting or sharing a link shows "Bought 2 Mar · 100 pcs · 42 left · Op-amps".
- **Why:** an exact "I bought this listing before" beats fuzzy titles, and it uses journal data only GrayMatter captures.
- **Fit:** the snapshot has `StockLine`s; movements load per item (`loadMovements`). Add a small `sourceKeys` projection.
- **Effort:** M.
- **Risks:** different sellers mean different IDs, so this complements fuzzy search. Short links (S2).
- **Sketch:**
  - core `source-key.ts`: `sourceKey(url)`.
  - storage snapshot query: distinct `(item_id, variant_id, source_url, max(created_at))` over receipts.
  - core `search.ts`: when the query parses as a URL or ID, key hits come first.
  - `SearchPalette.vue`: a "Bought before" row.

**S4. Haul mode: "Save & add another" plus an undo toast.**
- **What:** keep the quick-add sheet open with the folder, unit and link host retained. After any save or stock step, show "Saved · Undo".
- **Why:** a delivery is 10–30 bags. Sortly only offers clones or bulk import. Grocy shows that undo-on-journal works.
- **Fit:** client side, plus a decision on how to undo.
- **Effort:** S (S–M with an explicit reversal kind).
- **Risks:** undo must stay honest in an append-only journal. Use a compensating movement or archive the new item; never delete.
- **Sketch:**
  - app lib `stock-forms.ts`: `inverseOf(cmd)`.
  - `quick-add.ts`: `nextDraft(prev)`.
  - A toast component.
  - Optionally, core `MovementKind` gains `'reversal'` with a `reversesId`, so `JournalList.vue` can show "undone".

**S5. An Inbox for unsorted captures.**
- **What:** a default folder that quick add, share and import drop into, with a count badge.
- **Why:**
  - the Homebox user's "first entry box";
  - HN's "catalogue later";
  - choosing a folder is the slowest step on the phone.
- **Fit:** trivial; `folderId` can already be null.
- **Effort:** S.
- **Risks:** it becomes a junk drawer; the badge keeps it visible.
- **Sketch:** an optional `Inventory.inboxFolderId` (core model, `inventory.update`, a storage column), or the convention "root = Inbox". `QuickAddForm.vue` defaults to it; `FolderTreeNode.vue` shows the badge.

**S6. Pinned attributes ("where is it").**
- **What:** an attribute flag "Show in lists". The value appears as a muted chip in rows, palette results and the item header: Place `B4`, Package `DIP-8`.
- **Why:**
  - PartsBox proves a flat location *code* is enough for drawers, and shows custom fields as table columns.
  - HN: hierarchies are requested but rarely used.
  - It answers "where is it" without the planned second hierarchy.
- **Fit:** one schema flag.
- **Effort:** S–M.
- **Risks:** clutter; allow at most 2 pinned attributes.
- **Sketch:**
  - core `Attribute.showInLists` plus `attribute.update`; a storage migration.
  - app lib `item-view.ts`: `pinnedValues()`.
  - Render in `ItemList.vue`, `SearchPalette.vue` and `ItemScreen.vue`. Values are already indexed, so typing "B4" lists the drawer.

**S7. QR labels for drawers, folders and items, printed from the browser.**
- **What:** an A4 sticker grid or a 12–29 mm strip, with a QR/DataMatrix code, a short human-readable code and the name. The QR encodes `https://<app>/go/<code>`; an installed PWA captures in-scope links on Android ([WebAPKs](https://web.dev/articles/webapks)).
- **Why:** labels are central in PartsBox, Part-DB, Homebox, Sortly and Shelf, and the owner already has organisers.
- **Fit:** print CSS plus a tiny QR library.
- **Effort:** M.
- **Risks:** a domain change breaks every label. Homebox shipped a "QR Codes missing URL portion" fix in v0.23.1, and its LAN codes failed off-network. Use a short code (UUIDv7 makes dense QRs), print it human-readable, and accept `#B4` in search.
- **Sketch:**
  - core: `labelCode` on folder and item, unique per inventory and generated on the device.
  - storage: a column plus a unique index.
  - app lib `labels.ts`, `pages/labels.vue` with `@media print`, and a route `go/[code].vue`.

**S8. In-app scanner.**
- **What:** a "Scan" action opens a GrayMatter label, or searches an LCSC `C`-number or an EAN.
- **Why:** PartsBox paywalls camera scanning. Chrome Android ships `BarcodeDetector` ([caniuse](https://caniuse.com/mdn-api_barcodedetector)).
- **Fit:** no library needed on Android.
- **Effort:** M.
- **Risks:** low value before S7, since AliExpress bags have no codes.
- **Sketch:** `ScanSheet.vue` (getUserMedia + BarcodeDetector) and app lib `scan.ts` `parsePayload()`.

**S9. Home-screen shortcuts.**
- **What:** Search, Add and Scan on a long press of the icon. Chrome Android shows 3 ([web.dev](https://web.dev/articles/app-shortcuts)).
- **Effort:** S.
- **Risks:** `history-nav.ts` stamping must survive a start with `?do=`.
- **Sketch:** `nuxt.config.ts` `manifest.shortcuts`. `index.vue` reads `do` once, then calls `router.replace`.

**S10. Recent items in the empty palette.**
- **What:** show the last opened and last created items.
- **Why:** a Spotlight convention; during a build you keep touching the same items.
- **Effort:** S (a carry-over; it was out of scope for Plan 2).
- **Sketch:** app lib `palette.ts` keeps an MRU list in `device-db.ts`; `SearchPalette.vue` adds a "Recent" group.

**S11. Component-value smarts.**
- **What:** search treats `4k7` = `4.7k` = `4700` and `100n` = `0.1µ`. Bulk-variant presets such as "E12, 10 Ω – 1 MΩ".
- **Why:** synth BOMs use RKM notation, and AliExpress sells E12/E24 kits.
- **Fit:** core and app only.
- **Effort:** S–M.
- **Risks:** part numbers ("2N3904") must not be normalised; accept strict regex matches only.
- **Sketch:**
  - core `values.ts`: `normalizeValueToken()`, added to `compact` in `search.ts` for variant names and attribute values.
  - app lib `eseries.ts`.
  - `VariantsForm.vue` gets a "Presets" menu.

**S12. Pack arithmetic.**
- **What:** `5x100` and `5×100` mean 500 pcs, with a hint "= 500 pcs".
- **Why:** AliExpress sells in lots. PartsBox and InvenTree model pack units; this is the 5 % version.
- **Effort:** S.
- **Risks:** confusion with dimensions; allow an integer multiplier only.
- **Sketch:** a pre-parse in app lib `amounts.ts`; `AmountField.vue` shows the hint.

**S13. One-tap backup export.**
- **What:** a versioned JSON of the snapshot plus all movements and photo URLs, and a CSV of items/variants (path, quantity, unit, average price, link).
- **Why:**
  - HN's lock-in fears;
  - PartsBox's "data hostage" stance;
  - Sortly's repricing and PartKeepr's archival;
  - for GrayMatter: Neon disables the DB until month end if egress runs out.
- **Fit:** zero server.
- **Effort:** S.
- **Risks:** movements need one bulk query; egress is fine at hobby scale.
- **Sketch:** core `export.ts` (`ExportV1`), storage `loadAllMovements(inventoryId)`, app lib `export.ts` (Blob download), and a button in `pages/settings`.

**S14. CSV import with column mapping and an idempotent key.**
- **What:**
  - map columns, preview, and import into the Inbox;
  - an `importRef` skips rows already imported (like Homebox's `HB.import_ref`);
  - ship one AliExpress-exporter preset.
- **Why:** order history becomes inventory (Binner's idea, with no API). EEVblog users call the lack of import "a no-fly".
- **Effort:** M–L.
- **Risks:** third-party formats drift; the mapping UI gets complex.
- **Sketch:** core gets an optional `externalRef` on `stock.receive` with a unique index in storage; app lib `import-csv.ts`; `pages/import.vue`.

**S15. BOM check: "Can I build it?"**
- **What:**
  - paste a module BOM (`R1-R4 100k`, `IC1,IC2 TL072`) or a CSV;
  - match each line through search plus S11;
  - show have / short / missing;
  - "Copy missing list", and later "Use all".
- **Why:**
  - Part-DB "can build N", PartsBox shortfalls, Grocy recipe → shopping list;
  - synth DIYers keep "a page for each project's BOM";
  - every Eurorack module ships a BOM.
- **Fit:** client only; v1 is read-only.
- **Effort:** M (read-only), L (saved projects).
- **Risks:** BOM formats vary. Use a per-line match picker and remember choices on the device.
- **Sketch:** core `bom.ts` (`parseBomLines`, `matchBom`) and `pages/bom.vue`. Link to shopping lists when they land.

**S16. "Running low" as a smart list, without alerts.**
- **What:** an optional minimum on items and variants, plus a "Low" view.
- **Why:** every stock tool has it, and synth DIY has staples (TL072, 100 nF, jacks).
- **Fit:** a declared MVP non-goal, so this is post-MVP.
- **Effort:** S–M.
- **Risks:** upkeep; keep it opt-in.
- **Sketch:** core `minQuantity` on item/variant, storage columns, and `lowStock()` in app lib `views.ts`.

**S17. Photo-first capture (after Plan 4).**
- **What:** "+" starts from the camera; the name is optional ("Unnamed · 14:02") and the item goes to the Inbox.
- **Why:** HN's "photograph everything", and the 2026 AI photo-cataloguing apps (Elebox, Homebox Companion). The MCP plan can name items later.
- **Effort:** M.
- **Sketch:** a camera-first mode in `QuickAddForm.vue` and a placeholder name in `quick-add.ts`.

**S18 (optional). Thermal labels over Web Bluetooth.**
- **What:** print one label at a time to a cheap Niimbot printer through the open-source NiimBlue library ([NiimBlue](https://github.com/MultiMote/niimblue)).
- **Why:** PartsBox's ZPL-only pipeline is a known pain.
- **Effort:** L.
- **Risks:** a reverse-engineered protocol. Keep A4 printing as the baseline.

**S19. Local MCP, the Part-DB way.**
- **What:** a stdio MCP server in `packages/mcp` that reuses core and storage with the same connection string. Tools: `search`, `add_item`, `receive`.
- **Why:** it validates the top post-MVP item, without needing remote OAuth.
- **Effort:** L.

---

## 4. Avoid list

1. **Item caps, metered history, repricing.** Sortly's free tier is 100 items and 2025 renewals rose 3–10×; BoxHero's free history is 30 days. "Free, your own DB" is a differentiator; say so in onboarding.
2. **Paywalling basics.** Alerts, camera scanning, attachments and custom labels are all paid somewhere. Never gate capture, search or export.
3. **Structure frozen at creation.** Sortly's variants can't be added later. GrayMatter can do it; don't regress.
4. **ERP gravity.** Suppliers, POs, builds, lots and serials are "total overkill for hobbyist needs" (InvenTree). From the GOSH forum: "rather than grow into a behemoth" ([GOSH](https://forum.openhardware.science/t/inventree-and-other-open-source-inventory-management-systems/4041)). Ship BOM check read-only first.
5. **Assuming an MPN or supplier barcode.** PartsBox's free plan is MPN-only; Binner and InvenTree centre on DigiKey and Mouser labels. AliExpress identity is a title, a photo and a link.
6. **Labels encoding mutable things.** Names, paths, LAN or relative URLs (Homebox's QR bugs). PartsBox: settle the scheme before printing.
7. **Precision that needs upkeep.** "Unless you're super-religious about documenting every part … it's quickly out of date" *(snippet)*. Make "set count" quick and guilt-free; never require a count at capture.
8. **Exports that drop history** ("CSV export losing history"). Export the journal.
9. **Hosted-only with no exit; sunsets.** HomeSheet's HN reception, Encircle *(unverified)*, PartKeepr archived.
10. **Printer-specific pipelines** (PartsBox: ZPL plus JSPrintManager v8 only). Browser print first.
11. **Deep location trees nobody maintains.** Start with pinned place codes (S6) before room → cabinet → shelf → box.
12. **Sprawl for other audiences.** Warranty and maintenance (TubeTrack *removed* maintenance: "glass doesn't get serviced"), check-in/out, bookings.

---

## 5. Top 5 recommendations, ranked by value ÷ effort

| # | Recommendation | Value | Effort | Why now |
|---|---|---|---|---|
| 1 | **Duplicate guard in quick add (S1)** | Very high: the founding pain | S | UI over the existing search. No competitor does it. |
| 2 | **Haul mode: add another, undo toast, Inbox default (S4 + S5)** | High: unpacking a delivery is the main phone-capture moment | S | App-lib and component work. Undo can start as compensating movements with no schema change. |
| 3 | **One-tap JSON/CSV export (S13)** | High: insurance against Neon lockout and schema mistakes; the migration path for future adapters | S | Snapshot in memory plus one movements query. The first slice of the import/export non-goal. |
| 4 | **Share target plus link matching (S2 + S3)** | Very high: "Share → GrayMatter" is the in-the-moment lookup | M | First a spike to collect real AliExpress share strings on the owner's phone (S), then the manifest, parser, palette prefill and a `sourceKeys` projection. |
| 5 | **Pinned attributes as place codes (S6), then QR labels (S7)** | High: "where is it" in every row; scannable organisers | S–M, then M | Reuses attributes instead of building the second hierarchy. Labels follow once codes are stable. |

**Bundle-able extras:**
- manifest shortcuts (S9, S);
- `5x100` pack arithmetic (S12, S);
- recent items in the palette (S10, S).

**Biggest post-MVP bet:** BOM check (S15), with value normalisation (S11) as its prerequisite. Synth DIYers do this in spreadsheets today, and it is the feature that would make GrayMatter worth open-sourcing to that community.
