# GrayMatter — Track 04: architecture, data, reliability, PWA and shipping

Overnight review, 2026-11-11. Scope: `packages/core/src`, `packages/storage-postgres/src`, `packages/app/app/lib` (`workspace.ts`, `device-db.ts`, `sources.ts`), `nuxt.config.ts`, the package manifests, vitest configs, the specs, and the Plan 4/5 drafts.

**Method.**
- Code was read on branch `revival` (HEAD moved from `72af0d4` to `bbcd50b` during the night; none of the cited production files changed).
- The production build was measured in an APFS clone of the working tree in the scratchpad (`scratchpad/overnight/buildcopy`, `nuxt generate`), so the repo was not touched.
- Snapshot sizes and CPU timings come from a synthetic benchmark run with Vitest in that copy (`scratchpad/overnight/zz-bench.test.ts`).
- Neon's HTTP compression was checked with one read-only query (`select repeat(...)`) against the `graymatter_test` database. The connection string was never printed.

**Labels.**
- **[measured]** — run tonight.
- **[verified]** — checked against current docs.
- **[estimate]** — reasoned from measurements.
- **[unverified]** — needs a check before you rely on it.
- **Effort:** S ≤ ½ day of agent work, M = 1–3 days, L = a plan of its own.

---

## 0. Executive summary

1. **The biggest risk is the Neon egress cap, and it comes from one line.**
   - Every successful write reloads the whole inventory snapshot: `workspace.ts:455-457` calls `loadCurrent()` → `queries.loadInventory`.
   - Neon's SQL-over-HTTP endpoint **does not compress responses** [measured: `content-encoding` absent for `identity`, `gzip`, `br` and `zstd`; 400 KB of repeated text came back as 400 KB].
   - A snapshot costs about **1.2 KB per item on the wire** [measured, synthetic data with ~1 variant, ~1.5 attributes and 1 photo per item].
   - Entering N items one by one therefore costs about N² × 1.2 KB. **Entering ~2,000 items (two writes each) uses ~4.6 GB, close to the whole 5 GB monthly free egress.** When the cap is hit, the compute is suspended until the next month [verified].
   - The fix is cheap: a revision counter, plus writes that return the changed rows (§4.1).
2. **Commands are almost idempotent, but ids are minted at submit.**
   - A write that commits and then times out (20 s, `neon-http.ts:6`), followed by a user retry, inserts a **duplicate receipt or item**. The cause: `newId()` runs at submit time (`stock-forms.ts:39,43,45,49-51`, `quick-add.ts:40,51`, `FolderForm.vue:34`, `VariantsForm.vue:43`), and inserts have no `on conflict do nothing`.
   - Fixing this is S, and it is the foundation of any offline queue.
3. **Edit forms send every field** (`ItemForm.vue:52-58`, `FolderForm.vue:41-46`). A stale form on device B therefore reverts a rename made on device A — the spec's anti-goal "data loss on edits from two devices". Sending only changed fields is S.
4. **No off-the-shelf sync engine fits.**
   - ElectricSQL, PowerSync and Zero all hold a logical-replication connection. On Neon that **keeps the compute from scaling to zero** [verified]: ~0.25 CU × 730 h ≈ 182 CU-h/month, more than the free 100 CU-h.
   - The others replace Neon instead of working with it.
   - The project's own command log (serializable commands, client UUIDv7, one atomic batch per command) is already 70% of an outbox.
5. **Data safety depends on an export that does not exist yet.** Neon Free keeps only **6 hours** of point-in-time restore and 1 manual snapshot [verified]. A minimal JSON backup should ship with Plan 5, before real data goes in.
6. **Hosting origin.** On GitHub Pages every project site of `hazer-hazer` shares the origin `hazer-hazer.github.io`. Any other Pages site of that account can read GrayMatter's IndexedDB, which holds the connection string. Moving origin later loses all device data. **Choose the final origin (custom subdomain or a per-project origin) before Plan 5 ships.**
7. **Bundle.**
   - `index.html` preloads ~860 KB raw / ~280 KB gzip of JS [measured]. That includes the whole Neon driver (150 KB raw / 50 KB gz) and MiniSearch (~78 KB raw / ~22 KB gz), neither of which the cached first paint needs.
   - PGlite **JS** is already tree-shaken out of production [measured]. Its **assets** are still emitted: 15.6 MB raw, 5.2 MB gzip. They are not precached. Plan 5 Task 1 already targets them.

---

## 1. What is strong today

- **One atomic batch per command, no read-then-write.**
  - `toStatements` (`storage-postgres/src/commands/index.ts:13`) turns every command into one batch.
  - "Set" computes its delta in SQL (`commands/stock.ts:31-41`). Folder moves guard against cycles on the server (`commands/folders.ts:19-33`). Archive is guarded by `archived_at is null`, which makes it idempotent (`commands/archive.ts:34,41`).
  - This is why the HTTP driver works, and it makes replay possible.
- **Client-generated UUIDv7 ids** (`core/src/ids.ts:5`) and an **append-only journal**. Movements carry a server `seq` identity (`migrations/0000_init.sql:83`), which is already a natural cursor for the journal.
- **Consistent snapshot in one round trip.** `readBatch` runs 11 statements in one `REPEATABLE READ READ ONLY` transaction (`queries.ts:18-80`, `executors/neon-http.ts:32-41`). Stock is aggregated in SQL (`queries.ts:50-63`), so the 50k-movement journal never ships to the client.
- **Pure validation in core.** `validateCommand(normalized, snapshot)` (`workspace.ts:446-449`) is the place an offline queue would validate against an optimistic snapshot.
- **Cache-first startup.**
  - `startFromCache` (`workspace.ts:338-358`) shows the IndexedDB copy before any network call. This hides Neon cold starts; the spike measured 1,177 ms for the first request after sleep.
  - `navigator.storage.persist()` is requested (`device-db.ts:145-151`).
- **Careful concurrency.**
  - Generation counters drop stale connect outcomes (`workspace.ts:94-100, 385-390`), and load sequence numbers drop out-of-order snapshots (`workspace.ts:252-271`).
  - The write queue serializes writes (`workspace.ts:420-432`).
  - Covered by about 1,080 lines of `workspace.test.ts`.
- **Secret hygiene.**
  - Passwords are redacted from every error (`sources.ts:56-75`, `workspace.ts:43-46, 488-497`), and the UI never renders raw error text (`errors.ts:10-15`).
  - Purchase URLs are validated on write (`validate.ts:123`) and again at render time (`item-view.ts:259`). There is no `v-html`.
- **Cheap views.**
  - Indexes are memoized per snapshot object in a WeakMap (`views.ts:69, 131-138`), and the snapshot is `markRaw` (`workspace.ts:273`), so Vue never deep-proxies 10k rows.
  - The MiniSearch index is built lazily on first search (`SearchPalette.vue:49`).
  - Measured view costs at 10k items: `folderView` 0.0 ms, `itemView` 0.4 ms, search 0.6–1.5 ms.
- **PGlite parity.** The same schema and SQL run in tests and in the dev demo. The demo driver is imported dynamically (`dev/demo-source.ts:18`), and the production bundle contains no PGlite JS [measured].
- **Fonts are self-hosted** by `@nuxt/fonts` (84 KB, 6 woff2) [measured]. The CSP needs no `fonts.gstatic.com`.
- **Tests:** 55 files, 432 passing, 4 skipped (Neon conformance) [measured: 88 s; `bbcd50b` since tuned workers].

---

## 2. Risks and debts found in the code

| # | Where | Issue | Impact |
|---|---|---|---|
| D1 | `workspace.ts:455-457`, `:248-277` | A full `loadInventory` after **every** write, inside the write queue. | Egress grows with N² during bulk entry. Each write waits for a full download, which takes seconds at 10k items on mobile, and later writes queue behind it. |
| D2 | `workspace.ts:302-311`, `:335` | Every refresh and every inventory switch reloads the full snapshot, even when nothing changed. | Visibility refreshes (every 15 min, `workspace.client.ts:6`) each cost a full snapshot. |
| D3 | `storage.ts:23-26`, `inspect.ts:8-17`, `migrator.ts:23-26`, `workspace.ts:170` | Connect makes **5 sequential round trips** before the snapshot: inspect ×2, ensure ×2, list ×1. `create table if not exists gm_meta` (a write) runs on every connect. | Adds ~0.5–1.5 s to the start on mobile [estimate: 60–150 ms per warm request in the spike, more on LTE]. |
| D4 | `migrator.ts:31-37` | Migrations run without a lock and without re-checking the version inside the batch. | Two devices on a new version at once: DDL migrations fail on the loser (recoverable). Data-only migrations would **run twice**. |
| D5 | `migrator.ts:28-29` | Any newer DB version makes older clients read-only. | Even an additive migration locks the phone until it updates; nothing triggers a service-worker update check. |
| D6 | `commands/*.ts` (e.g. `items.ts:18-19`, `stock.ts:16-19`, `dictionaries.ts:19-20`) | Inserts lack `on conflict (id) do nothing`. Ids are minted at submit (`stock-forms.ts:39-51`, `quick-add.ts:40,51`, `StockSheet.vue:82-94`). | Timeout-after-commit plus retry gives a duplicate movement or item. Blocks replay. |
| D7 | `ItemForm.vue:52-58`, `FolderForm.vue:41-46` (likewise `VariantForm`, `InventoryForm`) | Updates send every field, including the full `tagIds`. | Lost updates across devices (stale form wins). |
| D8 | `neon-http.ts:6,12` | 20 s `AbortSignal.timeout` also covers the **body download**. | A large snapshot on a slow link (12 MB at 10k items) aborts, the source is marked `unavailable`, and the app shows "offline" although the network works. |
| D9 | `sources.ts:93-100` | A suspended project (quota exceeded) is classified as a generic `failed` or `source_error`. | The user sees a vague error with no "read-only until 1st, export your data" guidance [error format unverified]. |
| D10 | `nuxt.config.ts:29` | `registerType: 'autoUpdate'`. | A silent reload can drop half-typed input (Plan 5 Task 2 fixes this). |
| D11 | `nuxt.config.ts:30-39` | The manifest has no `id`, `share_target`, `shortcuts` or `screenshots`. | Install identity is tied to `start_url`; the share/shortcut affordances are missing. |
| D12 | Build output | The PGlite `.wasm`/`.data` (15.6 MB) are emitted in production, though not precached. | Deploy size, and confusion. |
| D13 | `workspace.client.ts:3,14` | `createNeonDriver` and the whole storage package are imported statically. | ~50 KB gzip of driver on the critical path, which the cached first paint does not need. |
| D14 | `device-db.ts:80-82` + `workspace.ts:276` | The whole snapshot is re-written to IndexedDB after every write. | structuredClone takes 54 ms at 10k items on desktop, ~250–400 ms on a mid-range phone [estimate]; it runs on the main thread. |
| D15 | Schema `0000_init.sql:81-96` | Nothing stops `UPDATE`s of `movements`. There are no unique name constraints (only client-side `duplicate_name`). There is no change cursor besides `movements.seq`. | The journal could be mutated by a bug. Duplicate tags can appear from two devices. Incremental sync has no anchor. |
| D16 | App-wide | No global error capture (`vue:error`, `unhandledrejection`) and no persisted log. | Field failures on the phone are invisible. |
| D17 | Repo root | No `LICENSE`. No `packageManager` field (Plan 5 Task 4 assumes one). `api/ssl/gm.key` (mkcert dev key, expired 2026-03) is tracked. | Blocks open-sourcing; breaks `pnpm/action-setup`. The key is low-impact but conflicts with "no secrets in the repo". |
| D18 | `workspace.ts` (587 lines) | Connection management, listing, snapshot loading and the write queue all live in one closure. | Adding an outbox here would be risky. Split it first (§4.2). |

---

## 3. Measurements

### 3.1 Bundle [measured, `nuxt generate`, Vite 8 / Nuxt 4.6.4]

| What | Raw | gzip -9 |
|---|---|---|
| JS preloaded by `index.html` (entry + 28 modulepreloads) | ~860 KB | ~280 KB |
| — Neon serverless driver (in chunk `BFknruzj`, with vue-i18n and uuid) | 150 KB (driver alone) | 50 KB |
| — MiniSearch chunk (`B53oxLdt`, includes palette code) | 76 KB | 22 KB |
| All JS | 1,006 KB | 314 KB |
| CSS (`entry.css`) | 61.5 KB | 11.5 KB |
| Fonts (6 woff2) | 84 KB | — |
| Service-worker precache | 76 entries, 1,166 KiB | — |
| PGlite assets emitted but unused: `pglite.wasm` + `.data` + `initdb.wasm` | 15.6 MB | 5.2 MB (brotli 4.3 MB) |

Nuxt already writes `404.html` and `200.html` byte-identical to `index.html`. Plan 5 Task 1's copy step is therefore redundant at base `/`; re-check under `/graymatter/`.

### 3.2 Snapshot size and wire bytes [measured, synthetic]

Synthetic inventory per item: ¼ of items have 4 variants, 1.5 attribute values, 1 photo row, 1.75 stock lines; 5% archived.

| Items | JSON in IndexedDB | Wire (array mode, raw text) | gzip (not used by Neon) | Without audit columns |
|---|---|---|---|---|
| 1,000 | 1.75 MB (1.8 KB/item) | 1.22 MB | 0.14 MB | 1.00 MB (−18%) |
| 10,000 | 17.4 MB | 12.2 MB | 1.4 MB | 10.0 MB |

- The driver sends `Neon-Array-Mode: true` and `Neon-Raw-Text-Output: true`, so rows arrive as arrays of strings without keys.
- The synthetic gzip ratio (~9×) is optimistic. Real data would be closer to 4–6× [estimate]. It does not matter today: Neon sends uncompressed bytes.
- A single response is capped at 64 MB [verified, Neon docs], which is about 50k rich items.

### 3.3 CPU [measured on the dev Mac, best of 4; Android at 4–6× [estimate]]

| Step | 1k desktop | 10k desktop | 10k mid-range Android (est.) |
|---|---|---|---|
| JSON.parse of the snapshot | 3 ms | 29 ms | 150 ms |
| `snapshotIndex` build (`views.ts:78`) | 8 ms | 86 ms | 400 ms |
| `createSearch` (MiniSearch) | 11 ms | 116 ms | 500–700 ms |
| structuredClone (proxy for an IndexedDB put) | 5 ms | 54 ms | 250–400 ms |
| search query / `folderView` / `itemView` | ≤ 0.4 ms | ≤ 1.5 ms | ≤ 10 ms |

At the owner's realistic size (1–2k items) everything is fast. At 10k the costs that are rebuilt after each change add up to ~1 s on a phone (index, search index, IndexedDB put). Once writes stop replacing the snapshot wholesale, those rebuilds become rare (§4.4).

### 3.4 Egress model, current design [estimate from 3.2]

Per-load size ≈ 1.2 KB × items. Neon Free allows 5 GB per project per month; on overrun the compute is suspended until the next billing period [verified].

| Scenario | Loads | Monthly egress |
|---|---|---|
| Steady use, 1k items, 20 writes + 10 refreshes per day | 900 × 1.2 MB | **~1.1 GB (21%)** |
| Steady use, 3k items, same habits | 900 × 3.6 MB | **~3.2 GB (63%)** |
| Steady use, 5k items | 900 × 6 MB | **~5.3 GB (over the cap)** |
| Initial entry of N items, 2 writes each | Σ 2·k·1.2 KB ≈ 1.2 KB·N² | N=1,000: 1.1 GB; **N=2,000: 4.6 GB**; N=3,000: 10 GB |

After §4.1 (revision check plus a write returning ~1–3 KB of changed rows), the same months use **tens of MB**. Full loads only happen when another device actually changed something.

**CU-hours [estimate].** Each wake keeps a 0.25 CU compute for ≥ 5 min (≈ 0.02 CU-h). Twenty to thirty sessions a day is ~15–25 CU-h/month, well under 100. The one thing that must never happen is polling more often than every ~5 min. With a tab left open 24/7 that would be ~180 CU-h.

---

## 4. Recommendations

### 4.1 Neon free-tier efficiency (highest priority)

**R1.1 — Revision counter; skip unchanged loads.** Effort S, risk low.
- Migration `0001`: `insert into gm_meta (key, value) values ('rev', '0') on conflict do nothing`.
- `openPostgresStorage.apply` appends `update gm_meta set value = (value::bigint + 1)::text where key = 'rev' returning value` to every batch. It is atomic with the write.
- `listInventories` becomes a `readBatch` that also returns `rev`. Refreshes already call it, so this adds zero requests.
- `CachedSnapshot` gains `rev`. `loadCurrent` is skipped when the cached rev equals the source rev.
- Files: `storage-postgres/src/{storage,queries,migrator}.ts`, `migrations/0001_rev.sql`, `core/src/storage.ts` (`listInventories` returns `{ inventories, rev }`), `app/lib/{workspace,device-db}.ts`.
- Tests:
  - PGlite: rev +1 per `apply`, unchanged by reads.
  - `workspace.test.ts`: a refresh with an unchanged rev makes no `loadInventory` call; a changed rev loads.
- One global rev per database over-invalidates other inventories in the same source. That is acceptable.

**R1.2 — Writes return their own patch.** Effort M, risk medium.
- `PgExecutor.batch` returns the rows of trailing read statements; the Neon `sql.transaction` already returns every result.
- New `affectedReads(command): Statement[]` in `storage-postgres/src/commands/`:
  - stock commands → that item's stock-line aggregate (the `queries.ts:50-63` query filtered by `item_id`);
  - `item.*` → item row + tags + attributes;
  - `variant.*` → variant rows;
  - `folder.*` → folder row;
  - `archive`/`restore` → rows by `archive_id` (plus the folder subtree);
  - `deletePermanently` → returns ids to drop;
  - dictionary deletes → fall back to a full load (rare, with cascades).
- Core: pure `patchSnapshot(s, patch): InventorySnapshot` returns a new object, so the WeakMap indexes stay correct.
- If the returned rev is `cached + 1`, the patched snapshot is authoritative. Otherwise another device wrote in between, so do a full load.
- **Safety net:** a property test (fast-check) on PGlite. For random command sequences, `patchSnapshot(load(), patch)` must deep-equal `load()` after every step.
- Roll out on the hot path first (stock.*, `item.create`, `item.update`, `item.setAttribute`, `variant.*`), with full reload as the fallback.

**R1.3 — One-round-trip handshake.** Effort S, risk low.
- One `readBatch` returns table counts, `schema_version`, inventories and `rev`.
- Run `ensureSchema` (and its `create table if not exists`) only when the result is `empty` or `older`.
- Files: `storage.ts`, `inspect.ts`, `migrator.ts`, `sources.ts`.
- Test: count executor calls on a current schema (1 instead of 5).

**R1.4 — Pre-warm before the first write.** Effort S.
- On `visibilitychange` → visible, or when a write sheet opens (stock, quick add), and the last DB contact was more than 4 min ago, fire the R1.1 rev check.
- This hides the ~1 s cold start behind typing, and doubles as the freshness check.
- Never poll on a timer.

**R1.5 — Timeouts and quota handling.** Effort S.
- Split the timeout: 15 s to first byte for writes, 60–90 s total for snapshot reads (`neon-http.ts:6-12`). Do not mark a slow but working download as `unavailable`.
- Classify a suspended project as its own reason `quota` (match on the Neon error text once captured [unverified]). Show "Neon monthly limit reached — read-only until the 1st. Export your data" with an Export action (R3.1).
- Cache the journal of recently opened items (LRU, ~50 items) so cards keep their history while read-only.

**R1.6 — Slimmer snapshot (optional).** Effort S.
- Drop `created_*`/`updated_*` from the snapshot selects of folders, items, variants, tags, attributes, units and photos. Only movements and `SourceConfig` use audit fields in the UI (grep).
- Saves 18% of the wire. Low priority once R1.1–R1.2 exist.

**R1.7 — Delta sync "changes since" (later).** Effort L.
- Per-row `rev bigint` from a sequence, set in every write statement.
- A `tombstones(table, id, rev)` table filled by triggers, because FK cascades delete silently.
- A `stock_lines` table maintained in the write batch instead of aggregating 50k movements on every load.
- Sequences are not commit-ordered: use an `xid8` watermark (`pg_snapshot_xmin(pg_current_snapshot())`) or re-read a small window.
- Worth it only past ~5k items or with frequent multi-device use.
- Interim hack: a client-uploaded gzip+base64 snapshot "checkpoint" blob, ~4× smaller on the wire than rows.

### 4.2 Offline writes / local-first

**Where the code stands.** Commands are plain serializable objects (`core/src/commands.ts`). Ids are client-side, validation is pure, and each command is one deterministic batch. The missing pieces:
- idempotent replay (D6);
- a persisted queue;
- a TS reducer so the UI can show queued changes before they reach the server;
- a conflict policy for non-journal edits.

**R2.1 — Idempotent commands with stable ids.** Effort S, risk low. **Plan 5.**
- Add `on conflict (id) do nothing` to every id-keyed insert: inventories, folders, items, `variants` via `unnest`, tags, attributes, custom_units, photos, movements (including `initialReceipt` and both transfer legs). `item_tags`: `on conflict do nothing`.
- Updates, archive, restore and delete are already idempotent.
- Mint ids once per form session and regenerate only after success or close. A small `useCommandIds()` composable covers `stock-forms.ts`, `quick-add.ts`, `FolderForm.vue`, `VariantsForm.vue` and the tag creation in `ItemForm.vue`.
- Test: a table-driven PGlite test where every command type applied twice yields the same snapshot.

**R2.2 — Send only changed fields.** Effort S, risk low. **Plan 5.**
- A pure `changedFields(initial, current)` helper in `app/lib`. Forms send only what differs; `tagIds` only if the set changed.
- The SQL already skips `undefined` (`sql.ts:34-43`), so each field becomes last-writer-wins on its own.
- Tests: the helper, plus a workspace test with two stale edits that touch different fields.

**R2.3 — Outbox (post-MVP).** Effort L, risk medium–high.
1. Refactor first: split `workspace.ts` into `connections.ts` (generations, connect/reconnect), `snapshots.ts` (load, cache, rev) and `writes.ts` (queue). Behaviour stays the same and `workspace.test.ts` stays green.
2. An IndexedDB store `outbox` with `{ seq, sourceId, inventoryId, command, enqueuedAt, attempts, lastErrorCode }`.
3. Core gets `applyCommand(s, c, actor, now): InventorySnapshot`, a TypeScript mirror of the SQL, including archive cascades and the stock aggregates. A **conformance property test** compares it with PGlite over random command sequences.
4. The UI shows `server snapshot + pending commands`.
5. Replay runs in order with backoff when `online`, `visibilitychange` or a successful refresh fires. Once R2.1 is in, replay is safe.
6. Commands that fail (FK violation because the target was deleted for good on another device) go to a "Couldn't sync" list with Retry / Discard / Edit.
7. Optional: Background Sync in a custom service worker (`injectManifest`). Chrome only.

**Conflict semantics.**
- **Journal entries** (receive, use, return, transfer) only append, so they commute.
- **`stock.set` queued offline** turns into a relative adjustment at enqueue time: target minus the local quantity, with a note like "counted 37 offline". This keeps receipts made meanwhile on other devices. An absolute "set" replayed later would wipe them out.
- **Field edits** are last-writer-wins per field (R2.2).
- **Folder moves** keep the server-side cycle guard. If a conflicting move would create a cycle, the server skips it and the queue shows "not applied". A move into a folder that was deleted for good fails on the foreign key and goes to the conflict list.
- **Duplicate tag or attribute names** created offline: allow them, and offer a "merge tags" action later. A unique index would make replay fail on an id the item already references.

**Sync engines** [verified where marked; licenses and free tiers per vendor docs].

| Engine | Works with Neon + static app, no server? | Verdict |
|---|---|---|
| ElectricSQL | Needs the Electric service (self-hosted or Electric Cloud, usage-based, "free below $5"). Reads Neon via **logical replication → compute never sleeps** [verified]. | No |
| PowerSync | PowerSync Service plus Neon Auth (accounts) and the Data API. The replication slot has the same never-sleep issue. | No (CU cap, accounts) |
| Zero (Rocicorp, Apache-2, 1.0 in June 2026) | Needs `zero-cache`, a server with a Postgres replica. | No |
| Triplit / Instant / Jazz | Their own backends instead of Neon; Triplit's company status is unclear [unverified]. | No (lock-in, breaks bring-your-own-Neon) |
| RxDB (Apache-2 core) | Custom pull/push handlers could call Neon HTTP directly. But the document model has no SQL aggregates, and the fast storage plugins are paid. | Possible, but duplicates the domain layer |
| Automerge / Yjs | One CRDT document per inventory could be stored as bytea in Neon and merged on the client. Loses SQL and the journal aggregates; whole-document egress. | No |
| **Own command outbox + rev cursor** | Uses only what exists. | **Yes** |

The same command log later gives **PGlite ↔ Neon sync** for local mode (§4.7): push the outbox, pull by rev.

### 4.3 Data safety

**R3.1 — JSON backup and CSV export.** Effort S–M. **A minimal JSON backup belongs in Plan 5.**
- Format: `{ format: 'graymatter-backup', version: 1, schemaVersion, exportedAt, source, inventory, folders, items, variants, tags, attributes, units, itemAttributes, variantAttributeValues, photos, movements }`.
- Movements need one paged query (`select … where inventory_id = $1 and seq > $cursor order by seq limit 5000`). At 50k movements that is roughly 12 MB once [estimate].
- CSV (later): one row per item and variant, with folder path, quantity, unit, average and last price, and attributes as columns.
- Delivery:
  - Android: `navigator.share({ files })` to Drive, Telegram or Files, with a download fallback.
  - Desktop: a download, or R3.3.
- Offline or quota-suspended: export the cached snapshot (marked "without journal").
- Files: `core/src/backup.ts` (pure build and parse, versioned), `storage-postgres/src/queries.ts` (`loadJournal`), `app/lib/backup.ts`, a Settings action.
- Tests: round trip through the schema; old versions rejected or upgraded.

**R3.2 — Import / restore.** Effort M. Plan 6.
- Restore into an **empty source**, keeping ids, or **as a new inventory** with ids remapped.
- Inserts are batched (~500 rows per statement via `unnest`) with `on conflict do nothing`, so the import can be re-run.
- This is also the escape hatch when the month's quota is spent: Neon Free allows **100 projects** [verified]. Create a new project, restore the latest backup, and keep working.
- The same path moves data from local mode to Neon (§4.7).

**R3.3 — Backup reminders and automatic backups.** Effort S → M.
- S: Settings shows "Last backup: 12 days ago", with a nudge after 200 writes or 14 days.
- M, desktop Chrome: keep a `FileSystemDirectoryHandle` in IndexedDB and write `graymatter-YYYY-MM-DD.json` on app open. Chrome 122+ offers "Allow on every visit" [verified]. The pickers do **not** exist on Android [verified].
- Later: Google Drive `appDataFolder` via the Google Identity Services token client. The `drive.appdata` scope is **non-sensitive** [verified], but every fork needs its own OAuth client id, so it suits the owner's deployment more than the project in general.

**R3.4 — Database-side guards.** Effort S.
- Add a trigger that rejects `UPDATE` on `movements`. Deletes happen only through the cascade from items, inventories or variants.
- Document Neon Free's safety net: **6 h point-in-time restore** (1 GB of change history) and **1 manual snapshot** [verified]. That is enough for "undo the last hour", nothing more.

**R3.5 — Migrations across devices.** Effort S, risk low. **Plan 5.**
- Each migration batch starts with `select pg_advisory_xact_lock(<const>)`, then a guard: a `DO` block that raises `gm_concurrent_migration` if `schema_version <> N`. The loser re-inspects (it now sees `current`) instead of failing or running the migration twice.
- Add `gm_meta.min_app_schema`. Additive (expand) migrations leave it alone, so older apps keep writing. Only breaking (contract) migrations raise it.
- Read-only applies only when `appVersion < min_app_schema`. When it does, call `registration.update()` and show "Update to keep editing".
- Tests: two PGlite executors migrating concurrently (one wins, one re-inspects), and an old app against an expand migration (writes still allowed).

**R3.6 — Encrypting the connection string at rest (assessment).**
- The realistic threats are XSS and malicious extensions. Anything at rest that the page can decrypt without user input, XSS can decrypt too.
- A PIN or WebAuthn PRF prompt on every launch fights the "know within seconds" scenario.
- PRF works best on Android Chrome with Google Password Manager, unevenly elsewhere [verified, vendor trackers].
- Higher value for the effort:
  1. CSP (Plan 5).
  2. A dedicated origin (§4.6).
  3. Documenting a least-privilege Neon role: the owner role only for migrations, an app role with DML on the gm tables.
  4. Documenting password rotation if a device is lost.
- If wanted later: an opt-in "Lock with fingerprint" (PRF → AES-GCM key, unlocked once per session, PIN fallback). Effort M.

**R3.7 — Settings transfer by QR.** Effort S–M, later.
- The desktop shows a QR of `{ sources: [...] }` behind "tap to reveal" (a tiny generator such as `uqr`).
- The phone scans it inside the app with `BarcodeDetector` (Chrome Android) and the camera. The secret never enters a URL, so it never lands in browser history.
- Do **not** use a `https://app/#import=…` link: Chrome history stores fragments.

### 4.4 Scale and performance

**R4.1 — Lighter critical path.** Effort S–M, risk low. Plan 5/6.
- In `workspace.client.ts`, load the Neon driver lazily: `drivers.neon = lazyDriver(() => import('~/lib/sources').then(m => m.createNeonDriver()))`, connecting after `startFromCache()`. The cached paint does not need it: −50 KB gzip.
- Load MiniSearch on first palette open with a dynamic `import()` in `SearchPalette.vue`, or prebuild the index in `requestIdleCallback`: −22 KB gzip.
- Budget, enforced in CI by a small script over `.output/public` that sums the gzip size of the `modulepreload` set:
  - critical JS ≤ 200 KB gzip;
  - total precache ≤ 1.5 MB;
  - no `*.wasm`/`*.data` in the precache.

**R4.2 — Search at 10k.** Effort S now, M later.
- Now: build the MiniSearch index in idle time right after a snapshot lands, not on the first keystroke.
- After R1.2, update it incrementally with MiniSearch `replace`/`discard`, keyed `i:<id>`/`v:<id>`.
- Move it to a Web Worker only if the phone still stutters past ~5k items. It is ~500 ms there today [estimate].

**R4.3 — IndexedDB writes.** Effort S. Debounce `putSnapshot` (≤ 1 per 2 s, and on `visibilitychange` → hidden). After R1.2, store the patch-applied snapshot the same way.

**R4.4 — Virtual lists.** Effort S, only when needed. `@tanstack/vue-virtual` for folder lists over ~300 rows and for the Archive list. Search is already capped at 50 hits.

**R4.5 — Measure on the phone.** Effort S.
- Lighthouse CI (mobile preset) on the build, and one remote trace over `adb`.
- Targets [estimate]: cached repeat start ≤ 1.2 s to the cached list on a mid-range Android; first visit ≤ 3.5 s on 4G.

### 4.5 PWA capabilities

In order of value for this app:

1. **Web Share Target (GET).** Effort S–M, Plan 5 or 6.
   - Add `"share_target": { "action": "./share", "method": "GET", "params": { "title": "title", "text": "text", "url": "url" } }`.
   - A `pages/share.vue` route pulls the URL out of AliExpress's share text, opens the palette prefilled with the cleaned title ("do I have it?"), and offers "Add as new item" with the purchase link.
   - Fits scenario 1 exactly. Needs the installed WebAPK; works on static hosting.
   - A pure parser `parseShared({ title, text, url })` in `lib/share.ts`, with tests built from real AliExpress share strings.
2. **Update prompt** (already Plan 5 Task 2). Also trigger it from `schema_newer` (R3.5).
3. **Shortcuts** (already Plan 5).
4. **Manifest hygiene** (S): `id: './'`, `screenshots` (narrow and wide, for the richer Android install sheet), `categories`. An install button from `beforeinstallprompt` on Welcome and Settings.
5. **View Transitions** (S, optional): Nuxt `experimental.viewTransition: true`, honouring `prefers-reduced-motion`. Check it does not double the existing header motion.
6. **Background Sync:** only with the outbox (R2.3).
7. **Skip for now:**
   - Periodic Background Sync — Chrome only, engagement-gated, intervals ≥ ~12 h, wakes Neon.
   - Badging — no alerts in scope.
   - File handlers — desktop only; revisit with import.
8. **Storage:** show whether `navigator.storage.persisted()` is true. `state.persistent` today only means "IndexedDB works" (`device-db.ts:139`).

### 4.6 Quality and operations

**R6.1 — Tests.**
- Today every test is logic in Node, with no DOM coverage.
- **Component tests** (M): Vitest Browser Mode with the Playwright provider (Chromium) for ~5 interaction-critical components: SearchPalette keyboard flow, AppSheet + close watcher, StockSheet, QuickAddSheet, FolderTree. Keep happy-dom out of it: Reka relies on real layout and focus.
- **E2E** (M): Playwright against `nuxt dev`, or a test build with a `GM_E2E=1` flag that keeps the demo driver in memory, since production excludes PGlite. Flows:
  1. Welcome → demo → quick add → the palette finds it as "tl-072";
  2. receive, use, set;
  3. archive, restore;
  4. `context.setOffline(true)` → read-only banner, then cache start;
  5. after R2.1, a retry after an injected timeout leaves no duplicate.
- **Speed** (S): a template PGlite data dir (`dumpDataDir` once per worker, then `loadDataDir` per test) skips initdb and migrations [unverified gain; `bbcd50b` already capped workers].
- **Property tests** for R1.2 and R2.3 (fast-check on PGlite) are what make patching and offline replay trustworthy.

**R6.2 — CI on GitHub Actions** (free for public repos). Effort S.
- Add `"packageManager": "pnpm@11.24.0"` to the root `package.json`. It is missing, and Plan 5 Task 4 relies on it.
- Jobs: lint, typecheck, test (fast), `generate` + bundle budget (R4.1), Playwright e2e (later).
- Neon conformance runs only on `workflow_dispatch`, with the `GM_NEON_TEST_URL` secret, against the `_test` database (`assertTestDatabase` already enforces the suffix).

**R6.3 — Error reporting without a server.** Effort S.
- `plugins/errors.client.ts` hooks `vue:error`, `window.onerror` and `unhandledrejection`.
- A ring buffer in IndexedDB (200 entries: time, route, app version, error code, text redacted via `redactSecret` for every stored source).
- Settings → Diagnostics → "Copy" / "Share".
- No third party by default. Sentry's free plan is possible for forks, but needs a `beforeSend` scrubber; current limits [unverified].

**R6.4 — Hosting.**

| Host | Free limits (Nov 2026) | Headers / SPA fallback | Notes |
|---|---|---|---|
| GitHub Pages (planned) | 1 GB site, ~100 GB/month soft [from GitHub docs, not re-verified] | No custom headers (CSP via `<meta>` only, no `frame-ancestors`, no HSTS control); deep links served with **404 status** from `404.html` | **Origin `<user>.github.io` is shared by all of the user's project sites** |
| Cloudflare Workers static assets / Pages | Static requests free and unlimited; 20,000 files; 25 MiB per file [verified] | `_headers`, `_redirects`, SPA mode with 200 status | Per-project `*.pages.dev` origin or a custom domain |
| Netlify | Credit-based since 2026: 300 credits/month, ~15 GB bandwidth if nothing else is used; deploys blocked when out [verified via third parties] | `_headers` | Credit model is a risk |
| Vercel Hobby | Non-commercial only | `vercel.json` headers | Fine, but no advantage here |

- Recommendation: keep GitHub Pages for MVP as planned, but **serve it from a custom subdomain** (`CNAME`, free HTTPS) **before real data is entered**. This isolates the origin and fixes it for good: IndexedDB is per origin.
- Keep the build host-agnostic and ship an optional Cloudflare `_headers` template for forks.

**R6.5 — CSP notes for Plan 5 Task 3.**
- Fonts are local, so drop `fonts.gstatic.com`.
- Inline scripts in the built `index.html`: the color-mode bootstrap and `window.__NUXT__` config (`__NUXT_DATA__` is JSON and needs no hash). Hash them in a post-generate step and write the `<meta>` into every emitted HTML file: `index`, `200`, `404` and the prerendered route copies.
- `connect-src https://*.neon.tech` covers the driver's `api.*` host. Add `wss:` only if the WS executor is ever used in the app.
- No `'unsafe-eval'`. PGlite's direct `eval` (build warning) is not in production.

### 4.7 Open-source readiness

**R7.1 — License and repo hygiene.** Effort S.
- Add `LICENSE`. MIT or Apache-2.0 (the latter has a patent grant); all dependencies are permissive.
- Add a NOTICE for Manrope (SIL OFL) because the fonts ship in the build.
- Removing `api/` and `web/` (spec §4.9) also removes the tracked mkcert key (a local dev certificate).

**R7.2 — Onboarding wizard.** Effort M. Welcome offers three paths:
1. **"On this device"**: local mode (R7.3). No account.
2. **"Bring your own Neon"**: a step-by-step guide (create project, pick region, copy the connection string), probe, done. Explain that data and secrets stay on the device and that the free tier has an egress cap.
3. **"Try a temporary cloud database"**: `POST https://neon.new/api/v1/database` creates a claimable database with no account. It expires in 72 h unless claimed, and lives in us-east-2 only [verified, docs]. Browser CORS is [unverified].

**R7.3 — Local mode as a first-class source.** Effort M, post-MVP.
- PGlite in a dedicated worker with IndexedDB (`idb://`), or OPFS (`opfs-ahp`, worker only).
- Loaded lazily (~4.3 MB brotli once, runtime-cached by the service worker, never precached).
- `navigator.storage.persist()` required, with automatic backup reminders: device loss means data loss.
- Plan 4's IndexedDB file store already covers photos.
- "Move to Neon" = backup + restore (R3.1/R3.2). Later, two-way sync via the command outbox.

---

## 5. Proposed order

**Plan 4 (photos), small additions only.**
- `photo.add` with `on conflict (id) do nothing` and the photo id minted once per upload.
- Make sure photo writes go through the same write path, so they inherit R1.1–R1.2 later.

**Plan 5 (ship).** The current draft plus these S items, before real data goes in:
1. **R2.1** idempotent commands and stable ids — fixes the duplicate-on-retry bug.
2. **R2.2** changed fields only — fixes cross-device lost updates.
3. **R1.1** revision counter (skip unchanged loads) and **R1.3** one-request handshake.
4. **R1.4** pre-warm; **R1.5** timeouts and quota message.
5. **R3.5** migration lock and expand/contract versioning.
6. **R3.1 (minimal)** JSON backup via share or download, plus a "last backup" line in Settings.
7. **R6.4** custom-subdomain decision; **R6.2** `packageManager`; **R7.1** LICENSE; **R6.3** local error log.
8. Plan 5 Task 1 tweak: Nuxt already emits `404.html`. Verify it under the base path instead of adding a copy step.

**Plan 6 (efficiency and resilience), right after MVP.**
- **R1.2** writes return patches, with the property test.
- **R3.2** import/restore.
- **R4.1** lazy driver and search, with the CI bundle budget.
- **R4.2** idle search build; **R4.3** debounced IndexedDB writes.
- **Web Share Target**.
- **R6.1** e2e and component tests.
- **R3.4** journal guard trigger.

**Later, in this order.**
1. Refactor `workspace.ts` (§4.2 step 1).
2. **R2.3** outbox with conflict list.
3. **R7.3** local mode as a first-class source, and the onboarding wizard (R7.2).
4. **R3.3** desktop auto-backup, then Drive.
5. **R1.7** delta sync (past ~5k items).
6. **R3.7** QR transfer.
7. PRF lock (R3.6).
8. Worker search and virtual lists, as needed.

---

## 6. Unverified or open items

- What Neon's HTTP API returns for a suspended project (quota exceeded): status code and text (D9, R1.5). Capture it once.
- Whether egress counts the full HTTP response bytes (assumed yes; Neon calls it "public network transfer").
- Android timings in §3.3 are 4–6× extrapolations from desktop. Measure via `adb` (R4.5).
- Real-data gzip ratio (only relevant to the R1.7 checkpoint idea).
- `neon.new` from a browser (CORS); a template PGlite data dir's speed-up; Sentry's free-tier limits; GitHub Pages limits (from older docs).
- Neon Object Storage (5 GB per project on Free) [verified to exist] as an alternative to Uploadcare: browser CORS, signing (S3-style keys would live on the device like the connection string) and whether its egress shares the 5 GB cap are unknown. A one-hour spike is worth it before Plan 4 is executed. Uploadcare's CDN keeps photo traffic off the Neon cap, which is an argument to keep it.

---

## Sources

- Neon plans and Free limits: https://neon.com/docs/introduction/plans · https://neon.com/faqs/free-plan-limits-and-quotas
- Neon scale to zero and logical replication (subscriber keeps the compute active): https://neon.com/docs/introduction/scale-to-zero · https://neon.com/docs/guides/logical-replication-neon
- Neon serverless driver (HTTP limits): https://neon.com/docs/serverless/serverless-driver
- Neon Object Storage: https://neon.com/docs/storage/object-storage
- Claimable Postgres (neon.new): https://neon.com/docs/reference/claimable-postgres
- PowerSync + Neon: https://docs.powersync.com/integrations/neon · https://powersync.com/pricing
- Electric Cloud pricing: https://electric-sql.com/blog/2026/04/02/electric-cloud-pricing
- Zero license and 1.0: https://zero.rocicorp.dev/docs/open-source · https://infoq.com/news/2026/06/zero-version-1
- WebAuthn PRF support: https://www.corbado.com/blog/passkeys-prf-webauthn
- Drive scopes (`drive.appdata` non-sensitive): https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- File System Access persistent permissions: https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api
- Cloudflare Workers static-asset limits: https://developers.cloudflare.com/workers/platform/limits · https://developers.cloudflare.com/changelog/2025-09-02-increased-static-asset-limits/
- Netlify 2026 credits (third party): https://netli.fyi/blog/netlify-free-plan-limits-2026
- Spike numbers: `docs/superpowers/spikes/2026-11-neon-browser.md`
