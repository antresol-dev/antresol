# 06 — Unconventional ideas: neighbouring domains, insights, assistants

Track: borrow from warehouses, libraries, museums, pantry/photo/finance apps and AI assistants to attack five pains: **forgetting what you have, buying duplicates, not knowing what's left, finding parts physically, cheap data entry.** Research date: 2026-11-11. Repo read on `revival` (after Plan 3). Anything I could not confirm is marked **(unverified)**.

## 0. Three findings that change the calculus

1. **Neon now runs functions next to the data.**
   - Neon Functions are Node.js with an HTTP `fetch` handler, cron triggers and an `mcp` starter template, "available on any plan, subject to usage limits" [Neon Functions].
   - Free allowance per a secondary summary: 10 active capacity-hours and 1M invocations per month **(unverified)**.
   - So a *remote* MCP no longer needs a server we operate.
2. **The Neon Free restore window is 6 hours.** There is 1 manual snapshot and no scheduled backups [Neon plans]. A bad import or agent write noticed the next morning can't be undone by Neon, so export/backup is a safety feature.
3. **Claude custom connectors accept static request headers** (a bearer token, no OAuth needed).
   - They work on web, Desktop and the mobile apps, but calls come from Anthropic's cloud, so the server must be public. Local stdio servers are Desktop-only [Claude connectors].
   - The Claude API also allows direct browser calls with a bring-your-own-key header [Willison].
   - Haiku 5.5 costs $0.10/$0.50 per million tokens (claude-api skill price table, cached 2026-11-03), so extracting one order screenshot costs a fraction of a cent.

---

## 1. Ideas

Effort: **S** ≈ 1–2 evenings, **M** ≈ a plan-sized task, **L** ≈ multi-plan. "Fit" means fit with no server and free tiers.

### A. "Do I already have it?"

**1. Share-to-GrayMatter "you already have this" — S/M**
- *From:* Amazon's "You purchased this on…" banner; library holdings check before ordering.
- *Looks like:*
  - Phone: in AliExpress or Chrome, Share → GrayMatter opens a sheet: "**You have 3 × TL072** · ICs/Op-amps · last $0.18/pc, Mar 2025", with *Record receipt* / *Add new*.
  - Desktop: paste a link or title into ⌘K.
- *Why:* the core scenario, at the moment of temptation, with zero typing.
- *Fit:* uses the manifest `share_target` (GET). On Android links usually arrive in `text`, not `url` [Chrome share target]. Matching reuses on-device MiniSearch and works offline.
- *Risks:* AliExpress may share only a short link plus a marketing title **(unverified)**. A static app can't follow the redirect (CORS). Only the installed PWA receives shares.
- *Tasks:* add `share_target` and a `/share` route; write a payload parser; build a result sheet; prefill quick add and receive.

**2. Listing fingerprints — S**
- *From:* recurring-merchant detection in finance apps.
- *Looks like:*
  - Normalise each receipt `sourceUrl` to a key: AliExpress `/item/<id>.html` [AliExpress URL pattern], LCSC `C…`, Tayda SKU.
  - A pasted or shared known key jumps to the item: "Bought this exact listing 2×".
  - The card lists "Where I bought it".
- *Why:* exact match beats fuzzy match. Also replaces the "purchase link on item" non-goal for free.
- *Fit:* client code over receipts; small snapshot addition.
- *Risks:* short links; shops change URL schemes.
- *Tasks:* `listingKey(url)` in core with per-shop tests; listing index in the snapshot; hook into paste, share and quick add.

**3. Spend and "regret" insights — M**
- *From:* personal-finance spending views (per month, per merchant, price history).
- *Looks like:* an Insights screen (desktop first) with:
  - spend per month and per store (`sourceUrl` host);
  - unit-price history per item;
  - a **duplicate-buy report**: receipts recorded while stock was already ≥ the previous batch ("10k: bought 3× while you had 80+").
- *Why:* measures the pain directly. Gives a north-star metric: duplicate buys per quarter.
- *Fit:* aggregates run in SQL (window function over `movements`), so the result is a few KB of egress.
- *Risks:* only as good as journal discipline.
- *Tasks:* `insights` query; duplicate-buy query; three small charts; price sparkline on the card.

**4. Authority records: aliases and canonical values — M**
- *From:* library authority files ("see from" variants) and controlled vocabularies.
- *Looks like:*
  - Item aliases: TL072 ← TL072CP/IP/ACP.
  - Numeric attributes store canonical values: `10K`, `10kΩ`, `10000` → **10 kΩ**, displayed with SI prefixes (core already parses them).
  - Dictionaries get "merge values" ("1uF" + "1µF").
- *Why:* many duplicates are naming duplicates. This is also the base for post-MVP filters, BOM matching (18) and queries (17).
- *Fit:* core logic plus one table. No egress cost.
- *Risks:* over-normalising text. Make it opt-in per attribute.
- *Tasks:* `aliases` field (searchable); numeric attribute kind; merge-values command; index canonical renderings.

### B. "What's left?" — trusting the number

**5. Stock confidence and cycle counting — M**
- *From:* warehouse cycle counting: count small scheduled subsets, track record accuracy (matched ÷ counted), and set count frequency by ABC class [Scandit], [AccountingTools].
- *Looks like:*
  - A faint "counted 3 w ago" / "never verified" on items.
  - **Count mode** on a folder (phone, one hand): big number, ±, *Matches* / *Set*.
  - Desktop: "accuracy, last 90 days: 86%".
- *Why:* "not knowing what's left" is really "not trusting the number".
- *Fit:* today `stock.set` writes nothing when the target equals stock (`having … <> 0` in `storage-postgres/src/commands/stock.ts`), so a confirming count leaves no trace. Add a `count` kind or a zero-delta adjustment; sums are unaffected.
- *Risks:* nagging. Keep it ambient, never red.
- *Tasks:* `stock.count` command; `lastCountedAt` in the snapshot; count sheet; accuracy stat.

**6. Guess-then-count, the playful audit — S (on top of 5)**
- *From:* active recall in Anki/Readwise: answer before you see [Readwise].
- *Looks like:* count mode first asks "How many 100k 0805 do you think?" (slider), then you count. Then: "you over-estimated 3×".
- *Why:* trains exactly the memory whose failure causes duplicate buys, and turns counting into a game.
- *Fit:* guesses stay in IndexedDB.
- *Risks:* gimmick fatigue. Cap at 5 items per session.
- *Tasks:* guess step; local store; calibration stat.

**7. Two-bin "keep stocked" flag and burn rate — S/M**
- *From:* two-bin kanban: the empty first bin is the reorder signal, no counting needed [Smartsheet], [MMS]. Reorder points from usage.
- *Looks like:*
  - A "Keep stocked" toggle on staples.
  - The card shows "~14 months of cover at your pace" (from 12 months of `usage`).
  - A one-tap "**Opened the last bag**" puts the item on the shopping list (19).
  - Usage-frequency ABC suggests which items to flag.
- *Why:* low-stock value without the numeric thresholds and alerts that the spec keeps out.
- *Fit:* one boolean plus a usage aggregate.
- *Risks:* hobby usage is noisy. Show cover only with 3 or more usages.
- *Tasks:* flag; aggregate query; "running low" action.

**8. Shelf life and care reminders — S**
- *From:* pantry apps ("use first", Grocy's "due soon" [Grocy]), plant-care schedules.
- *Looks like:*
  - Optional shelf life on an item (solder paste, flux, CA glue, batteries).
  - Optional "care every N days" (LiPo storage charge, drying filament).
  - Old lots get a muted "use first" chip, and a "Due" list appears in the panel.
- *Why:* serves "anything, anywhere" beyond electronics, cheaply.
- *Fit:* the receipt date is the lot date. Computed client-side.
- *Risks:* creep. Two fields, no more.
- *Tasks:* two fields; lot age; Due list.

### C. Finding parts physically

**9. Shelf marks before a second hierarchy — S/M**
- *From:* library call numbers, and the museum Spectrum standard's "Location and movement control" (location names precise enough to find any object) [Spectrum].
- *Looks like:* a short **mark** per item or variant (`A3·12`): a chip in lists, inline edit, sortable and searchable. Folders can have a default mark.
- *Why:* ~80% of post-MVP #3 (locations) for ~10% of the cost, and pick lists (18) can sort by it.
- *Fit:* one column.
- *Risks:* free-text drift. Normalise on input and suggest existing prefixes.
- *Tasks:* field plus normaliser; chip; sort; search.

**10. Physical deep links: QR/NFC labels and short accession IDs — S → M**
- *From:* warehouse location labels; Homebox/Sortly QR labels and `#asset-id` search [Homebox], [Sortly]; museum accession numbers.
- *Looks like:*
  - Every folder and item has a label: a QR code of `…/folder/<id>` plus a short code `#K7Q2`.
  - Desktop prints an A4 sheet. Later, a cheap Niimbot printer over Web Bluetooth (open-source library [niimbluelib]).
  - Phone: scan with the camera, or tap an **NFC sticker** written once with any NFC app (a URL record needs no app code [Web NFC]). The drawer's folder opens with "Count this box" one tap away.
- *Why:* turns "where is the 4069?" and "what's in this box?" into one tap. A natural entry into cycle counts.
- *Fit:* `/folder/[id]` and `/item/[id]` already exist. `BarcodeDetector` exists on Android via Play Services; check `getSupportedFormats()` [Shape detection].
- *Risks:*
  - Deep links on static hosting need an SPA fallback (GitHub Pages `404.html`) **(unverified for this setup)**.
  - Whether a scan opens the PWA or a tab **(test in E5)**.
  - Short-code collisions: check them against the snapshot.
- *Tasks:* short-code function; `#` search prefix; printable sheet; later, Niimbot.

**11. Pick-to-light — L, experimental**
- *From:* warehouse pick-to-light.
- *Looks like:* an ESP32 plus LED strip along the drawer cabinet. "Find" lights the cell for 10 s.
- *Why:* the most literal fix for "finding parts", and a great open-source demo for someone who solders.
- *Fit:* an HTTPS page calling a LAN device hits Chrome Local Network Access: a permission prompt, with a mixed-content exemption for private IPs or `targetAddressSpace:"local"` [Chrome LNA]. Web Bluetooth avoids the issue.
- *Risks:* hardware work; browser rules still shifting.
- *Tasks:* mark→LED map; Bluetooth or LAN bridge; "Light it" button.

### D. Cheap data entry

**12. Kit receiving and E-series generators — M**
- *From:* retail receiving against an advance shipping notice: one scan receives the whole delivery.
- *Looks like:*
  - A "Received a kit" sheet with presets: E12/E24 resistor ranges, ceramic-cap kits, "N values × M pcs".
  - One confirmation creates the missing variants and one receipt each, splitting the batch price.
  - Desktop shows a matrix preview.
- *Why:* AliExpress assortments are both the most forgotten and the most tedious items to enter.
- *Fit:* one atomic batched command (UUIDs on the device, no read-then-write). Not a general "bulk operation".
- *Risks:* the even price split is a fiction (acceptable).
- *Tasks:* E-series data; `stock.receiveKit` command; sheet; PGlite test.

**13. Screenshot or text intake with bring-your-own-key — M**
- *From:* receipt scanners and expense apps (photo → lines → confirm).
- *Looks like:*
  - Phone: share an order screenshot or confirmation text into GrayMatter.
  - Claude, using the user's key stored on the device like the connection string, returns lines: title, option ("100PCS 10K"), quantity, price, URL.
  - The app matches each line to items and variants and shows a **draft** with per-line accept/edit.
  - Desktop: drop several screenshots at once.
- *Why:* removes the largest data-entry cost exactly when parcels arrive. Delivers post-MVP #9 (photo recognition) in a practical form.
- *Fit:* browser-direct calls [Willison] at near-zero cost. Prompt and schema are shared with the MCP (14).
- *Risks:*
  - The key is readable on the device (the same trade-off already accepted for the connection string).
  - Quantity parsing from option text is the main error source, so keep confirmation.
  - Use a provider interface for open-source users.
- *Tasks:* `llm` adapter interface; Anthropic adapter with structured outputs; matcher; draft UI; key setting.

### E. Assistants

**14. Local MCP as a `.mcpb` bundle — M**
- *From:* Claude desktop extensions: a zip plus manifest whose `sensitive` `user_config` values live in the OS keychain and are injected as env vars [Desktop extensions].
- *Looks like:*
  - A new `packages/mcp` reusing `core` (commands, validation, MiniSearch) and `storage-postgres` over the Neon driver.
  - It loads the snapshot once, caches it with a TTL and searches locally, which keeps egress low.
  - Read tools: `search`, `get_item`, `list_folder`, `check_bom`, `spend_summary`.
  - Write tools only *propose*: `propose_items`, `propose_receipts`, `propose_usage` land in the Inbox (16).
  - No archive or delete tools. Annotate tools with `readOnlyHint`/`destructiveHint`, which are hints, not access control [MCP spec].
  - Defence in depth: a dedicated Postgres role with minimal grants (no DELETE) [Neon roles]; `created_by = "Claude · MCP"` through the existing `actor.device`.
- *Why:* the roadmap's first post-MVP goal, done with zero servers.
- *Fit:* free. Desktop only.
- *Risks:* doesn't reach the phone; role setup is manual; it must refuse writes when the database schema is newer than it knows.
- *Tasks:* stdio skeleton; snapshot cache plus read tools; propose tools; manifest and build; role SQL and docs.

**15. Remote MCP on Neon Functions — M**
- *From:* "backend next to the data" [Neon Functions].
- *Looks like:*
  - The same MCP code is deployed from the `mcp` template and guarded by a long random token sent as a connector request header [Claude connectors].
  - On the phone, the Claude app takes "add these" plus a screenshot, then proposals appear in GrayMatter's Inbox.
  - Claude's own Gmail connector can read AliExpress order emails and pass the lines on, so we write no email parser **(the Gmail connector's tool list comes from a secondary source)**.
  - A cron trigger can produce the digest and the backup (22).
- *Why:* the only way to use Claude with the inventory *from the phone*.
- *Fit:* the same vendor and egress pool, nothing to operate. It bends "no own server", so keep it an **optional Neon-only add-on**.
- *Risks:* young product (regions, eviction); a public URL; only 1 custom connector on the Free Claude plan. Expose proposals only, never direct writes.
- *Tasks:* transport-agnostic MCP core; function entry plus token check; deploy script; setup guide.

**16. The Inbox: agents propose, you approve — M**
- *From:* pull requests; "pending transactions" in banking.
- *Looks like:*
  - A `proposals` table holds a serialised list of core `Command`s, a summary and a source ("Claude · screenshot 14 Nov").
  - An **Inbox** section shows a count. Accept all, accept per line, or discard.
  - Accept runs the existing atomic commands.
- *Why:* one safety model for local MCP, remote MCP, BYOK intake, email agents and importers. Nothing lands in the journal without a tap. MCP clients vary in how they confirm, so our own UI is the dependable gate.
- *Fit:* one tiny table. Commands are already plain data.
- *Risks:* stale proposals (re-validate at apply time); clutter (auto-expire after 30 days).
- *Tasks:* table and migration; `proposal.*` commands; Inbox screen; wire 13–15 into it.

**17. Natural-language queries without an LLM first — M**
- *From:* Gmail search operators; spreadsheet smart filters.
- *Looks like:*
  - ⌘K parses `100k 0805`, `op-amp in stock`, `<5 jacks`, `#K7Q2`, `@A3` using canonical values (4).
  - It answers with a **sum line**: "100k · 0805 — 340 pcs in 2 variants".
  - A BYOK LLM only translates English into this grammar and never touches the database.
- *Why:* "how many 100k in 0805?" answered offline in under 100 ms, honouring the "slow search" anti-goal.
- *Fit:* client-only.
- *Risks:* forgettable syntax. Show parsed filters as removable chips.
- *Tasks:* parser in core; evaluator; sum line; optional LLM translation.

### F. Builds, sharing, delight, safety

**18. "Can I build it?" — BOM check, pick list, consume — M/L**
- *From:* PartsBox builds: what the board needs vs. what you have, the shortfall as a purchase list, kitting and pick lists [PartsBox]; InvenTree builds.
- *Looks like:*
  - Desktop: paste a BOM (CSV, a KiCad iBOM export [iBOM], or a forum list).
  - Each line is matched through aliases and canonical values and marked ✓ have / ⚠ short / ✗ missing.
  - Actions: **Shortfall → shopping list**; **Pick list** sorted by shelf mark (phone: tick off while picking); **Consume build**, which writes one `usage` per line with the note "Build: Clouds" in a single atomic batch.
- *Why:* the owner thinks in modules, and the BOM is where duplicates get ordered wholesale.
- *Fit:* client-side matching; one batched command.
- *Risks:* depends on 4. Mapping BOM values to variants needs design.
- *Tasks:* CSV parser; matcher with manual fix-up; `stock.consumeBuild`; pick list; shortfall link.

**19. A shopping list that remembers why — S/M**
- *From:* Grocy auto-adds missing items [Grocy]; PartsBox purchase lists.
- *Looks like:*
  - Lines come from "keep stocked" (7), BOM shortfalls (18) and manual adds.
  - Each line keeps its reason ("for Clouds") and its last listing and price (2).
  - The share sheet (1) also says "on your list ✓". Lines auto-close on a matching receipt.
- *Why:* post-MVP #2, reframed as the place where duplicates are *prevented*.
- *Fit:* one table.
- *Risks:* list bloat (auto-close handles most of it).
- *Tasks:* table and commands; screen; auto-close; integrations.

**20. Read-only catalogue file — M**
- *From:* swap-meet "haves" lists; museum online collections.
- *Looks like:*
  - "Share read-only copy" writes one self-contained HTML file: the snapshot JSON, a tiny search and photo URLs.
  - Filters: "for trade" tag only; prices and URLs hidden by default.
  - Send it in a messenger or put it on a Gist/Pages. The reverse direction is importing a friend's BOM (18).
- *Why:* social sharing with no accounts and no database access. A read-only Postgres role would expose everything [Neon roles].
- *Fit:* client-only, built on export (22).
- *Risks:* stale by design.
- *Tasks:* HTML template target; filter UI; size guard.

**21. Rediscover card and weekly digest — S/M**
- *From:* Google Photos memories; Readwise daily review (rate a card, it returns sooner or later [Readwise]). Real spacing is available via ts-fsrs [ts-fsrs].
- *Looks like:* on the first open of the week, one dismissible card:
  - "+4 receipts, −2 builds this week."
  - "You haven't looked at **PT2399 ×6** in 9 months. Still there?" with *Yes* / *Used* / *Gave away*.
  - "One year ago: 50 jacks arrived."
- *Why:* the most direct cure for forgetting: stock resurfaces before it gets re-bought.
- *Fit:* "last seen" is stored on the device. Computed on open, because Periodic Background Sync needs installation, engagement and network heuristics [Periodic sync]. Server-sent digests would need 15.
- *Risks:* ignored cards. One card at most, quiet style.
- *Tasks:* local view log; resurfacing picker (age weighting first, FSRS later); card.

**22. Safety net: export, scheduled backup, egress meter — S/M**
- *From:* ERP nightly backups; budgets in finance apps.
- *Looks like:*
  - Settings → "Download full backup" (JSON with schema version and journal), with a reminder after 30 days.
  - Optional cron backup via GitHub Actions in the owner's private repo or a Neon Function. GitHub disables scheduled workflows in public repos after 60 inactive days [GitHub workflows].
  - A small meter: "~120 MB of 5 GB transfer this month", estimated from bytes received.
- *Why:* given the 6-hour restore window [Neon plans] and agents that write, this is the cheapest insurance on the list. It is also the base for 20, 23 and the adapters.
- *Fit:* client-side; a few MB per export.
- *Risks:* untested backups. Add a "restore into the PGlite demo" check.
- *Tasks:* format and validation; export and import; reminder; egress estimator; cron recipe.

**23. Community preset "Synth DIY starter" — S**
- *From:* template galleries (Notion, Grocy demo data).
- *Looks like:* the new-inventory form offers JSON presets from the repo. The "Synth DIY" preset includes:
  - folders: Resistors, Capacitors (Film/Ceramic/Electrolytic), ICs (Op-amps/OTAs), Jacks, Pots, Hardware;
  - attributes: Value (numeric Ω/F/H), Package (THT/0805/0603), Voltage;
  - common aliases.
- *Why:* saves the desktop setup evening, makes the open-source debut useful at once, and generalises post-MVP #4 (copying between inventories) into "save as preset / apply preset".
- *Fit:* static data applied as one batch.
- *Risks:* opinionated defaults. Keep it small.
- *Tasks:* schema; one preset; picker; "save as preset".

---

## 2. Re-ranked post-MVP list

| New | Item | Was | Reason |
|---|---|---|---|
| 1 | **Export/import and backup reminder** (22) | #6 | 6-hour restore window; prerequisite for agents, sharing and presets. Consider for Plan 5. |
| 2 | **Share target and listing fingerprints** (1, 2) | missing | The core scenario for very little code. |
| 3 | **MCP: local `.mcpb`, then remote on Neon Functions, both through the Inbox** (14–16) | #1 | Still the big goal. Build the proposals model first; read tools ship first. |
| 4 | **Numeric attributes, canonical values, aliases, query grammar** (4, 17) | #5 | Enables BOM matching, queries and de-duplication. |
| 5 | **Shopping list with reasons and the keep-stocked flag** (19, 7) | #2 + "low-stock thresholds" (out) | A binary flag replaces thresholds. |
| 6 | **Builds** (18) | missing | The owner's real unit of work. |
| 7 | **Shelf marks and QR/NFC labels** (9, 10) | #3 | Most of the value of locations. Revisit the full hierarchy only if marks are too flat. |
| 8 | **Count mode, confidence, rediscover** (5, 6, 21) | missing | Attacks forgetting directly. |
| 9 | **BYOK screenshot intake** (13) | #9 | Same goal, practical, near-free. |
| 10 | **Presets** (23) | #4 | Falls out of export. |
| 11 | **Insights / regret report** (3) | missing | Needs months of journal first. |
| 12 | **Read-only catalogue** (20) | missing | Social, built on export. |
| 13 | **Other adapters** | #7 | Keep local PGlite for newcomers. **Don't put photos in Neon Object Storage in the same project**: its egress is shared with Postgres [Neon plans], which would recreate the "won't open because of photos" anti-goal. A separate free project has its own egress **(unverified as a photo store)**. |
| 14 | **Incremental loading** | #8 | Last. Revisit when the egress meter says so. |

The rest of the "outside MVP" list:
- Keep out: accounts, own server, currency conversion, offline writes.
- "Purchase link on the item": not needed, idea 2 derives it.
- Bulk operations: keep the general selection mode out, but allow the purpose-built kit-receive and consume-build batches.
- QR settings transfer: an S task worth doing later, with the secret shown only behind an explicit tap.

---

## 3. Bold bets

**A. The ledger that agents fill.**
- Shift from "an app you type into" to "a journal agents propose into and you approve in one tap".
- Pieces: Inbox (16), MCP local and remote (14, 15), BYOK intake (13), Claude's Gmail connector.
- MCP Apps (a ratified MCP extension for interactive UIs that Claude can render) could show the approval list inside Claude itself [MCP Apps], [SEP-1865]. The app's Inbox stays the source of truth.
- Data entry approaches zero while append-only, `created_by` and archive keep it safe.

**B. Builds-first inventory for synth DIY.**
- The module, not the part, becomes the main object: BOM in → availability → shortfall list → pick by mark → consume → cost per build from receipt prices.
- PartsBox proves the shape for professionals. Nobody does it for a phone-first hobbyist fighting AliExpress chaos.
- A community "BOM commons" of popular open modules could be the open-source hook.

**C. An inventory that trains your memory.**
- Confidence badges, guess-then-count, rediscover cards and the regret report together form a loop with measurable outcomes: duplicate buys per quarter and record accuracy.
- Applying spaced repetition to *possessions* rather than facts appears new **(no prior product found)**, and it hits the root pain.

---

## 4. Experiments worth running this week

**E1 — Baseline the pain (30 min, no code).**
1. AliExpress → Orders, last 12 months.
2. Copy each electronics line (name, date, quantity) into a sheet.
3. Flag re-buys of the same part within 12 months and sum their cost.

That number is the north-star. Re-measure in 6 months.

**E2 — Share payload capture (1 h).**
1. In a *throwaway* repo, publish a GitHub Pages page whose manifest has `share_target: {action:"/share", method:"GET", params:{title:"title", text:"text", url:"url"}}` and whose `/share` prints `location.search`.
2. Install it on the phone.
3. Share from the AliExpress app, Chrome, Telegram and Gmail.
4. Record which field carries the link, whether `/item/<id>` or only a short link arrives, and what the title looks like.

This decides how ideas 1 and 2 match.

**E3 — Screenshot → JSON accuracy (45 min, no code).**
1. Take 5 real order screenshots, including "100PCS 10K"-style options.
2. In claude.ai, use one fixed prompt: "Return JSON lines {title, option, quantity_pcs, total_price, currency, url?}".
3. Score each field against reality.

One quantity error or fewer in 20 lines → idea 13 is viable with per-line confirmation.

**E4 — Read-only MCP spike (one evening).**
1. In a scratch folder outside the repo, write a stdio server with `search` and `get_item` that imports `@graymatter/core` and `storage-postgres` via a workspace link. It reads `GM_NEON_TEST_URL` from the environment and never logs it.
2. Register it in Claude Desktop's config.
3. Ask 10 real questions ("do I have a 4069?", "how many 100k?", "what did I buy in March?").
4. Note each failure's cause: missing tool, missing data, or matching.

**E5 — Labels in the real drawer (1 h).**
1. Print QR codes for 5 boxes pointing at `/folder/<id>` on the deployed or preview URL.
2. Write one NTAG sticker with the same URL.
3. Scan with the camera and tap the sticker, and check:
   - Does it open the installed PWA or a tab?
   - Does a cold-start deep link survive static hosting?
4. Time "find part X" by label vs. by search.

**E6 — Neon Functions MCP hello-world (1–2 h).**
1. In a **separate** Neon project, deploy the `mcp` template with a `ping` tool and a token check.
2. Add it in claude.ai as a custom connector with the token in request headers.
3. Call it from the Claude Android app.
4. Note cold-start latency and where usage is metered.

---

## Sources

- [Neon Functions] https://neon.com/docs/compute/functions · https://neon.com/functions.md · https://neon.com/blog/neon-backend-is-ga
- [Neon plans] https://neon.com/docs/introduction/plans · [Neon roles] https://neon.com/docs/manage/database-access
- [Claude connectors] https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- [Desktop extensions] https://www.anthropic.com/engineering/desktop-extensions
- [MCP spec] https://modelcontextprotocol.io/specification/2025-11-25 · [MCP Apps] https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/ · [SEP-1865] https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- WebMCP (Chrome origin trial 149–156, secondary): https://www.mcpbundles.com/guides/webmcp-browser-support
- [Willison] https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access
- Gmail connector tools (secondary): https://skillsplayground.com/connectors/gmail-gmailmcp/
- [Chrome share target] https://developer.chrome.com/docs/capabilities/web-apis/web-share-target
- [Web NFC] https://developer.chrome.com/docs/capabilities/nfc · [Shape detection] https://developer.chrome.com/docs/capabilities/shape-detection
- [Chrome LNA] https://developer.chrome.com/blog/local-network-access · [Periodic sync] https://developer.chrome.com/docs/capabilities/periodic-background-sync
- Prompt API desktop-first: https://groups.google.com/a/chromium.org/g/blink-dev/c/iR6R7-nQeHI · Web Speech on-device not on Android: https://groups.google.com/a/chromium.org/g/blink-dev/c/P8P-x7AnC6I
- [niimbluelib] https://unpkg.com/@mmote/niimbluelib@0.0.1-alpha.38/README.md
- [PartsBox] https://partsbox.com/production-and-builds.html · https://partsbox.com/purchase-lists.html · [Grocy] https://grocy.info/ · Binner (order import incl. AliExpress): https://github.com/replaysMike/Binner
- [Homebox] https://hay-kot.github.io/homebox/tips-tricks · [Sortly] https://www.sortly.com/pricing/ · [iBOM] https://github.com/openscopeproject/InteractiveHtmlBom
- [Scandit] https://www.scandit.com/resources/guides/what-is-cycle-counting/ · [AccountingTools] https://www.accountingtools.com/articles/2017/5/10/cycle-counting
- [Smartsheet] https://smartsheet.com/understanding-kanban-inventory-management-and-its-uses-across-multiple-industries · [MMS] https://mmsonline.com/columns/back-to-basics-with-the-simple-two-bin-reorder-system
- [Spectrum] https://www.museumsgalleriesscotland.org.uk/advice-article/collections-management-accountability-and-ethics/ · https://pitstonemuseum.co.uk/pims/spectrum-5.0/04-Inventory.pdf
- [Readwise] https://blog.readwise.io/hack-your-brain-with-spaced-repetition-and-active-recall/ · [ts-fsrs] https://github.com/open-spaced-repetition/ts-fsrs
- [AliExpress URL pattern] (secondary) https://greasyfork.org/scripts/34530/code
- Marketplace counterfeit risk (forums): https://forum.pedalpcb.com/threads/pt2399-sourcing.27873/
- [GitHub workflows] https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
