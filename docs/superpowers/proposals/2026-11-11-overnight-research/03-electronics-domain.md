# 03 — Electronics parts and DIY synth building as a domain

Overnight review, 2026-11-11. Sources: web research, live HTTP probes of supplier APIs run tonight, and read-only reading of `packages/core/src` (plus one scratch script that ran the real `createSearch` on fixtures; the repo was not modified).

**Evidence tags:** **[V]** verified tonight (live probe, code, or primary doc). **[S]** secondary source. **[U]** unverified or inferred: check before building on it.
Effort: **S** ≈ 1–2 days, **M** ≈ 3–5 days, **L** ≈ 1–3 weeks.

---

## 0. TL;DR

1. **Search answers the core phone scenario wrongly today.** With variants `47k` and `4k7`, the query `4.7k` returns **47k** (a 10× error), and the right part is not shown **[V]**. A notation-aware value index fixes this (P1).
2. Part values cannot use `Quantity`, which is limited to 6 decimals (so no pF). They need their own `EngValue` type (mantissa, exponent, quantity kind), separate from stock units.
3. Real synth BOMs share a rough shape (Qty / Value / Refs / Package / Description / supplier part numbers) and are messy: section rows, Qty disagreeing with refs, `L` prefixes used for LEDs. **Google Sheets CSV export is readable from the browser (CORS `*`)** **[V]**. Pasted text is the most general input.
4. Nexar, Mouser and DigiKey (token) can be called from a static app with a key kept on the device, like the Neon URL; jlcsearch needs no key **[V probes]**. Free tiers are small or gate datasheets, and the community API was overloaded once tonight. So the default should be **link-outs plus a curated offline dataset**, with API adapters optional.
5. Top 5: value-aware search, an ephemeral "Check a BOM" screen, Android share target "Do I have it?", templates with an E-series generator, and reorder points / "running low" feeding a shopping list.

---

## 1. Findings

### 1.1 What GrayMatter does with part values today [V]

Probe: real `createSearch`, item "Resistor 1/4W metal film" (variants `47k`, `4k7`) and "Ceramic capacitor" (variants `0.1uF`, `4n7`).

| Query | Result (item/best variant) | Expected |
|---|---|---|
| `4.7k`, `4,7k` | resistor/**47k**, cap/4n7 | resistor/4k7 |
| `4.7kΩ` | cap/4n7, resistor/4k7 | resistor/4k7 only |
| `4700` | (none) | resistor/4k7 |
| `100n`, `100nF` | (none) | cap/0.1uF |
| `104` | (none) | cap/0.1uF (EIA code, low rank) |
| `4K7` | resistor/4k7 | ✓ |

Two causes:
- `compact()` deletes the decimal point, so `4.7k` becomes `47k`.
- MiniSearch 7.2.0 splits terms on `\p{P}` and lowercases them, so `4.7k` becomes `4` + `7k` and `M`/`m` collide.

Related code facts:
- `parseAmount` cannot express values below 10⁻⁶ of the base unit.
- `stock.set` with an unchanged count writes **no row** (`having … <> 0`), so a confirmed audit leaves no trace.
- `stock.use` fails with `insufficient_stock` when counts have drifted, which will break build consumption.
- Priced totals filter `kind = 'receipt'`, so a cost basis on usage rows would be safe.

### 1.2 How hobbyists name parts

- **Resistors:**
  - Common forms: `100k`, `4k7` (RKM/IEC 60062: the letter replaces the decimal point), `4.7k`, `470R`, `R47`, `1M`.
  - BOMs often write a bare `100` for 100 Ω, e.g. "Resistor, 1% | 100 | 0603" in a real module BOM **[V]**.
  - Specs are given as `1%`, `1/4W`, `0805`, "metal film".
- **Capacitors:**
  - European BOMs: `100n`, `18p`, `22u` **[V]**. US BOMs: `0.1uF`, "10µF Electrolytic" **[V]**.
  - Body markings use EIA codes (`104` = 100 nF; `472J` = 4.7 nF ±5%) **[U, standard knowledge]**.
  - C0G for small audio values, X7R for decoupling, film for 2.2–470 nF **[S]**.
- **Pots:**
  - Written `B100k`/`A10k`. In the Alpha convention A = log and B = linear; old European usage is reversed **[U]**.
  - Alpha 9 mm vertical is the standard: `RV09AF-40-20K-B100K` (plastic shaft), `RD901F-40-15R1-B100K` (metal shaft).
  - Trimmers: `3362P`, `3296W/X` (X has a side screw, so it fits under the panel) **[S]**.
- **Jacks:** "Thonkiconn". `PJ398SM`, `PJ301M-12` and `WQP518MA` are interchangeable; the stereo variant is not **[S]**. Kosmo uses 6.35 mm jacks **[S]**.
- **ICs and semis:** named by base part number (`TL072`, `LM13700`, `CD4069UB`, `BC547`, `1N4148`) while real MPNs carry suffixes (`TL072CP`, `TL072HIDR`) **[V]**. Matching must treat the base as a prefix.
- **Substitutes (forum consensus):**
  - TL082 is a drop-in for TL072, slightly noisier.
  - NE5532 has the same pinout but bipolar inputs, with far higher bias current; it clicks and drifts in high-Z/DC stages **[S]**.
  - Counterfeit TL072s are reported **[S]**.
  - BC547 (CBE) and 2N3904 (EBC) have different pinouts **[U, verify per datasheet]**.

### 1.3 E-series and assortments

- **The series:** E6 ≈ 20%, E12 ≈ 10%, E24 ≈ 5% (also sold at 1%), E96 ≈ 1%. E3, E6 and E12 are subsets of E24 **[S]**.
- **Gaps:** 8 E24 values (including 2.7, 3.3, 4.7, 6.8, 8.2) are **not in E96**. A 1% E96 shelf has 47.5k, not 47k **[S]**.
- **Encoding:** E96 is computable (`round(10^(i/96), 3 s.f.)`); E24 must be hard-coded **[S]**.
- **Stocking advice:** North Coast Synthesis designs with E24 at 1%: "the saving in effort and inventory control pays for the slightly higher price" **[S]**. So E24 should be the default generator.
- **Kits:**
  - The common 0805 sample book has **170 values, 0 Ω–10 MΩ, 25–50 each** **[S]**. 170 = E24 × 7 decades + 0 Ω + 10 MΩ **[U, inferred; it matches the advertised range]**.
  - THT kits: 600 pcs, 30 values, 20 each, 10 Ω–1 MΩ **[S]**.
  - One buyer measured book values off by 20% or more **[S]**.

### 1.4 BOM formats in the wild

- **A real Eurorack module Google Sheet** (CSV export, CORS OK) **[V]**:
  - Header: `Name,Qty,Value,Index,Specs,Package,Mouser reference,Note`.
  - Section rows: `SMD parts:`, `Other parts:`. Refs are space-separated.
  - Values: `100`, `1k`, `18p`, `100n`, `22u`, `B10k`, `5.0V`.
  - Traps: `1N5819HW diode` has Qty 1 but refs `D1 D2`; **`3mm yellow LED`** uses refs `L2 L3 L4`; Thonk URLs appear instead of part numbers.
- **Synthrotek-style doc BOM:** sections per family; `QTY | Value | Ref. | Mouser Part #`; cells like "Synthrotek, Various Suppliers" **[V]**.
- **LMNC/Kosmo:** Rapid-centric official BOMs plus community Tayda/Mouser versions. Users report CSV/XLS/PDF copies of one BOM "with completely different notations" **[S]**.
- **KiCad 8/9 CSV:** headers `Reference, Qty, Value, Footprint, Datasheet, Description` **[S]**. A known bug drops Qty with `--group-by --exclude-dnp` **[S]**.
- **InteractiveHtmlBom** (common in build guides, e.g. Erica Synths): data embedded as LZString-compressed JSON with a `bom` key; exact fields **[U]**.
- **Distributor tools:**
  - LCSC accepts CSV/XLS(X), up to 4 MB and 800 lines; Newark, Farnell and TTI take MPN + qty **[S]**.
  - Tayda bulk order: **[U]**.
- **PartsBox (comparison):** import never creates parts; column-mapping presets; "how many complete units can be built now"; one BOM line can draw from several lots **[S]**.

### 1.5 How established tools model this [S]

- **InvenTree:**
  - Parameter templates with a base unit (pint): `10k` = `10000`, ranges from two filters, uniqueness by value.
  - A separate location tree with "structural" nodes and "location types".
- **Part-DB:** parameters with units, KiCad HTTP library, project BOM import.
- **Binner:** supplier order import, supplier barcode scanning, bin QR codes ("scan the bin to assign location"), label printing.
- **Hobbyists:**
  - Many never count resistors or caps; they sort physically and reorder "when it looks low".
  - Spreadsheets die from friction.
  - Power users add a drawer number and numeric columns to answer questions like "largest capacitance in smallest package".

### 1.6 Lookup APIs from a static browser app

All probes were curl requests with `Origin: https://example.org`.

| Source | Auth | CORS (probed) | Free tier | Verdict |
|---|---|---|---|---|
| **jlcsearch** (tscircuit, unofficial) | none | reflects origin **[V]** | undocumented; **"D1 DB is overloaded" once tonight** **[V]** | Good opt-in enrichment: MPN, package, price, LCSC id. `/resistors/list.json?resistance=47000&package=0805` works **[V]**. No SLA |
| **Nexar/Octopart** GraphQL | client credentials (secret on device) | token and graphql preflight `*` **[V]** | lifetime 100–1000 parts (docs conflict); datasheets and tech specs are **Pro add-ons** **[V]** | Not worth it by default |
| **Mouser Search** | key in query | preflight 404 without `apiKey`, OK with it **[V]** | 30/min, 1000/day **[S]** | Best "real API" with the user's own key |
| **DigiKey v4** | OAuth2 client credentials **[S]** | token POST and search GET return ACAO **[V]**; custom-header preflight bot-blocked for curl **[U]** | 1000/day **[S]** | Probably works; test in a browser |
| **LCSC official** | signed, approval by email **[S]** | — | — | Not suitable |
| **jlcparts DB** | static | GitHub Pages | 0.9–11 GB (reports conflict) **[S]** | Too big to bundle |
| **Store search links** | none | navigation | — | Always works. 200 for LCSC, Octopart, Mouser, AliExpress, JLCPCB, Thonk; 403 to curl (bot walls) for Tayda, DigiKey, TME, alldatasheet **[U in browser]** |

Conclusion: ship store and datasheet **links** plus a **curated offline dataset** (about 50 synth parts, 20–40 KB in the bundle, no Neon egress). Add Mouser and jlcsearch as opt-in adapters with keys kept in IndexedDB. The post-MVP MCP server is the right home for heavy enrichment, since it has no CORS limits and no exposed keys.

### 1.7 Stock practices and physical organisation [S/U]

- **Two-bin kanban:** an empty front bin is the reorder signal. It suits cheap, high-use parts, and for a hobbyist it maps to a one-tap "running low" rather than counting.
- **Organisers:**
  - 24–64-drawer cabinets: Akro-Mils 64 = 16×4 **[U]**, Raaco, Stanley.
  - IKEA Alex drawers, bags in index boxes, SMD books, binder pages, Gridfinity bins **[U]**.
  - Values grouped by decade family (1k/10k/100k together).
- **Labels:**
  - Bin labels with QR codes that link to the inventory record **[S]**.
  - Niimbot printers can be driven from Chromium via Web Bluetooth (`@mmote/niimbluelib`) **[S]**.
  - `BarcodeDetector` is available in Chromium on Android, macOS and ChromeOS but not desktop Linux; use zxing-wasm as a fallback **[S]**.
- **Kits vs modules:** parts inside an unopened kit are not free stock. A finished module's value equals the parts it consumed.

---

## 2. Value parsing spec (core `values.ts`)

**Type.**
- `EngValue = { kind: QuantityKind; digits: string; exp: number }`, where the value = `digits × 10^exp`.
- Kinds: `resistance|capacitance|inductance|voltage|current|power|frequency|percent|unknown`.
- Canonical key: `` `${kind}:${digits}e${exp}` ``. Use `Number()` only for sorting and comparing.

**Rules, in order.**
1. Normalise: NFKC; map `µ`/`μ` to `u` and `Ω`/`Ω` to `ohm`; treat a single `,` between digits as the decimal mark.
2. Split multi-spec strings on spaces. Each token is tried as a value, tolerance (`\d+%`), voltage, power (`1/4W` → 0.25), package, dielectric or taper.
3. **Prefixes:** `p n u m k K M G`, plus SPICE `meg`. `R`/`r`/`E` mean 10⁰ in resistance.
4. **RKM:** a letter between digits replaces the decimal point (`4k7`, `2u2`, `1M5`, `6V3`). A leading letter means "0." (`R47`, `p47`).
5. **Kind:**
   - A unit suffix (`F`, `Ω`/`ohm`/`R`, `H`, `V`, `A`, `W`, `Hz`) fixes it.
   - Otherwise use the hint (item family).
   - Otherwise infer from the prefix: `p`/`n` → capacitance; `k`/`M`/`R` → resistance; `u` is ambiguous between capacitance and inductance.
   - Always return ranked `alternatives`.
6. **`m` in a resistance without `Ω`:** treat as M (hobby convention) and set `warning: 'ambiguous_m'`. Explicit `mΩ` means milli.
7. **Code mode** applies only when hinted, or as a low-rank alternative:
   - Capacitors: 3 digits are two significant digits plus a multiplier, in pF (digit 8 → ×0.01, 9 → ×0.1). A trailing letter is **tolerance** (B C D F G J K M Z), never kilo.
   - Resistors: 3/4-digit codes and EIA-96 (`01C`).
8. **MPN guard:** reject tokens shaped like part numbers (`^\d?[A-Z]{1,3}\d{2,}`, or more than one letter run) before trying RKM.
9. **Reject** negatives, double prefixes and multiple decimal marks.
10. **Packages:**
    - Chip codes default to imperial (`0805`) with a metric alias (`2012`). Metric `0603` is imperial `0201`.
    - Aliases: `SO-8`=`SOIC-8`=`SOP-8` **[U]**, `DIP-8`=`PDIP-8`, `TO-92`, `SOT-23`, `SOD-123`, `DO-35`.

**Display.** Per-inventory style: `rkm` (`4k7`, `4n7`) or `decimal` (`4.7k`). Capacitors show a mantissa between 1 and 999 (`100n`, not `0.1u`) unless US style is chosen.

### 2.1 Parser test cases

| # | Input | Hint | Expected | Note |
|---|---|---|---|---|
| 1 | `10k` | — | R 1e4 | k ⇒ resistance |
| 2 | `10K` | R | 1e4 | upper-case K |
| 3 | `4k7` | R | 4.7e3 | RKM |
| 4 | `4.7k` | R | 4.7e3 | |
| 5 | `4,7k` | R | 4.7e3 | comma decimal |
| 6 | `4.7 kΩ` | — | R 4.7e3 | space + Ω |
| 7 | `4.7kohm` | — | R 4.7e3 | |
| 8 | `4700` | R | 4.7e3 | plain with hint |
| 9 | `4700` | — | unknown 4700 | no kind |
| 10 | `470R` | — | R 470 | |
| 11 | `R47` | — | R 0.47 | |
| 12 | `0R47` | R | 0.47 | |
| 13 | `4R7` | — | R 4.7 | |
| 14 | `0R` / `0` | R | 0 | jumper is valid |
| 15 | `1M5` | — | R 1.5e6 | |
| 16 | `1meg` | — | R 1e6 | SPICE |
| 17 | `1m` | R | 1e6 + `ambiguous_m` | |
| 18 | `100mΩ` | — | R 0.1 | explicit milli |
| 19 | `472` | R, code | 4.7e3 | SMD 3-digit |
| 20 | `4701` | R, code | 4.7e3 | 4701 Ω without code mode |
| 21 | `01C` | R, code | 1e4 | EIA-96 100 × 100 |
| 22 | `4n7` | — | C 4.7e-9 | n ⇒ capacitance |
| 23 | `4.7nF` | — | C 4.7e-9 | |
| 24 | `4,7 nF` | — | C 4.7e-9 | |
| 25 | `100n` | — | C 1e-7 | |
| 26 | `0.1uF` | — | C 1e-7 | displays `100n` |
| 27 | `.1µF` | — | C 1e-7 | leading dot, U+00B5 |
| 28 | `0.1μF` | — | C 1e-7 | Greek mu U+03BC |
| 29 | `2u2` | C | 2.2e-6 | |
| 30 | `p47` / `0p47` | — | C 4.7e-13 | |
| 31 | `1n0` | — | C 1e-9 | |
| 32 | `104` | C, code | 1e-7 | |
| 33 | `104K` | C, code | 1e-7, ±10% | K = tolerance |
| 34 | `472J` | C, code | 4.7e-9, ±5% | |
| 35 | `220` | C | [220 pF plain, 22 pF code] | ambiguous: ask |
| 36 | `10uF 25V` | — | C 1e-5 + V 25 | multi-token |
| 37 | `6V3` | — | V 6.3 | |
| 38 | `1/4W` | — | W 0.25 | |
| 39 | `10mH` | — | L 0.01 | |
| 40 | `B100K` | pot | R 1e5, taper B | |
| 41 | `100KB` | pot | R 1e5, taper B | taper last |
| 42 | `10k 1% 0805` | — | R 1e4, 1%, pkg 0805 | |
| 43 | `u`, `k7`, `4k7k`, `1.2.3`, `-10k` | any | null | invalid |
| 44 | `TL072` | — | null | MPN guard |
| 45 | `2N3904` | — | null | not "2 nano" |

### 2.2 Combination test cases

Combinations use in-stock values only. Resistors: series a+b, parallel ab/(a+b); capacitors the reverse. Rank by |error|, then fewer parts, then higher stock.

| Target | In stock | Tol | Expected best |
|---|---|---|---|
| 47k | 100k, 91k, 39k, 8k2, 22k | 1% | 39k + 8k2 = 47.2k (+0.43%) |
| 47k | 100k | 1% | none. At tol ≥ 7%: 100k ∥ 100k = 50k (+6.4%), "out of tolerance" |
| 50k | 100k | 1% | 100k ∥ 100k exact |
| 200k | 100k | 1% | 100k + 100k exact |
| 47k | 47.5k | 1% | 47.5k (+1.06%), "nearest, slightly outside" |
| 4n7 | 2n2, 3n3, 1n5 | 5% | 3n3 ∥ 1n5 = 4.8n (+2.1%) |
| 1u | 2u2 | 20% | 2u2 in series with 2u2 = 1.1u (+10%) |

---

## 3. Feature proposals

### P1. Notation-proof value search — S

- **What:** a value index next to MiniSearch. Every item name, variant name and numeric attribute that parses as an `EngValue` goes into a `Map<canonicalKey, hits>`.
  - Value queries hit it at **tier 0**, filtered by kind when the kind is known.
  - A text hit whose value contradicts the query (47k vs 4.7k) is demoted.
  - `compact()` stops gluing digits across a decimal point.
- **Why:** fixes the 10× wrong answer in §1.1, with no data entry.
- **Model:** no storage change. Core `values.ts` (P2 subset) and `search.ts`; `SearchHit.valueMatch?: 'exact'|'near'`.
- **UI:** palette rows read "4k7 · Resistor book 0805 · 50 pcs". With no exact value: "No 4k7. You have 4k3 (12), 5k1 (40)". The quick-add name field warns "you already have 4k7".
- **Risks:** MPNs read as values (guard rows 44–45). Plain numbers count as values only when the family is known.
- **Tasks:**
  1. Parser subset with §2.1 tests.
  2. Value index.
  3. Ranking merge and the `compact` fix.
  4. §1.1 table as regression tests.
  5. Near-value hint.

### P2. Full engineering-value parser and formatter — M

- **What:** all of §2. It is shared by search, attributes, BOM import and share parsing.
- **Model:** core `values.ts` and `eseries.ts` (E3–E24 hard-coded, E48/E96 computed). A `valueStyle` preference, stored per device or inventory **[U: no settings table yet]**.
- **UI:** inputs echo their reading ("= 4.7 nF").
- **Risks:** ambiguity. Show alternatives, never guess silently.
- **Tasks:**
  1. Tokenizer.
  2. Kinds and inference.
  3. Codes.
  4. Packages.
  5. Formatter.
  6. Property test `parse(format(v)) == v`.

### P3. Numeric attributes with range filters — M

- **What:** attribute kind `number` with a `quantityKind`, stored canonically (`"47e-10"`) in the existing `value text` columns. Variants sort by value. Filters such as "Resistance 10k–100k", "Voltage ≥ 25V", "Package = 0805" run client-side over the in-memory snapshot. The roadmap already lists this.
- **Model:**
  - Migration: widen `attributes_kind_check`, add `quantity_kind text null`.
  - `attribute.create` gains `quantityKind`; `validate.ts` parses values.
  - A variant name that parses with the item's family kind auto-fills the attribute, to avoid typing the value twice.
- **UI:** desktop filter chips above the list plus a value column; the phone gets a filter sheet from the search bar.
- **Risks:** names and attributes drifting apart; auto-fill on rename reduces this.
- **Tasks:**
  1. Migration and types.
  2. Validation.
  3. Number-kind form.
  4. Auto-fill.
  5. Filters.
  6. Sort.

### P4. Part-family templates and E-series generator — S/M

- **What:** "New item from template" creates any missing attributes. "Add values → Series" generates variants, e.g. "E24 1 Ω–9.1 MΩ + 0 Ω + 10 MΩ" (the 170-value book), or from a pasted kit list.

| Family | Item-level attributes | Variant-level | Unit |
|---|---|---|---|
| Resistor | Mount, Package (0805/0603/1206/axial 0207), Power, Tolerance, Tech | Resistance | pcs |
| MLCC / ceramic | Package or Pitch, Dielectric (C0G/X7R/X5R), Voltage | Capacitance | pcs |
| Film cap | Type (MKT/MKP/box), Voltage, Pitch | Capacitance | pcs |
| Electrolytic | Temp (85/105 °C), Pitch, Bipolar | Capacitance + Voltage, Size | pcs |
| Potentiometer | Size (9/16/24 mm), Mount, Shaft (knurled/D, length, metal/plastic), Gangs, Detent | Resistance, Taper | pcs |
| Trimmer | Type (3362P/3296W/3296X), Adjust | Resistance | pcs |
| Jack | Size (3.5/6.35), Type (mono switched/stereo), Model | — | pcs |
| IC | Base MPN, Function, Channels, Input (JFET/bipolar/CMOS), Supply | Package | pcs |
| Transistor | Polarity, Pinout (CBE/EBC), Matched | Package | pcs |
| Diode / LED | Type / colour / size, Package | Vz or colour | pcs |
| Header / power | Pitch, Rows×Pins (2×5, 2×8), Shrouded | — | pcs |
| Hardware | Kind, Thread (M2.5/M3), Material | Length | pcs |
| Wire / solder | Gauge | Colour | m / g |
| Module | HP, ±12V/+5V mA, Format | — | pcs |

- **Why:** a 170-value book cannot realistically be entered by hand.
- **Model:** templates are static JSON in core. Generation is `variant.createMany` + `variant.setAttribute` in one batch, up to 340 statements: **check the Neon HTTP batch limits** **[U]**.
- **UI:** a desktop "Series" tab in Add variants (series, from, to, extras); the phone gets a template picker in quick add.
- **Risks:** template sprawl. Keep about 12, editable after creation.
- **Tasks:**
  1. Templates JSON.
  2. `eseries.generate`.
  3. Dialog tab.
  4. Batch check.
  5. Test that E24 × 7 + 2 = 170.

### P5. Kit receipt with price split — S

- **What:** `stock.receiveBatch { batchId, totalPrice, sourceUrl, note, lines[] }` writes N receipts and splits the total in proportion to quantity, in integer minor units, with the remainder placed deterministically.
- **Why:** books and kits are bought as one AliExpress line; today the cost has to be faked onto one variant.
- **Model:** `movements.batch_id` (nullable). The journal shows "part of a 170-line batch".
- **UI:** "Receive kit" on an item: a quantity for all variants ("50 each") and one price field. Phone and desktop share the sheet.
- **Risks:** rounding. Test that the parts sum to the total.
- **Tasks:**
  1. Command and validation.
  2. Split function and tests.
  3. SQL.
  4. Sheet.

### P6. "Do I have it?" via share sheet and paste — M

- **What:** add a `share_target` to the PWA manifest (Chrome Android, installed PWA **[S]**). Sharing an AliExpress listing opens `/share`, which:
  - parses the title soup ("600PCS 1/4W Metal Film Resistor 1% 10K 4.7K 47K…") into values, families and MPNs, and shows stock for each;
  - **matches the URL against past receipts' `sourceUrl`** ("You bought this listing on 12 Aug: 100 pcs, 37 left"). The AliExpress id comes from `/item/(\d+).html`; short links cannot be resolved client-side **[U]**.
  - The same parser runs on text pasted into ⌘K.
- **Why:** the owner's #1 scenario, and it stops duplicate purchases using data the app already stores.
- **Model:** read-only. The journal is not in the snapshot, so add a light `receipt_urls` projection (bucket, URL, date, qty) **[check egress]**.
- **UI:** on the phone, a result screen with a chip per value (have / low / none) and "+ Quick add" prefilled with title, URL and attributes.
- **Risks:** noisy titles; share text formats vary by app **[U]**.
- **Tasks:**
  1. Manifest entry.
  2. `/share` route.
  3. Title tokenizer on P2.
  4. URL normalisers (AliExpress, LCSC, Tayda, Thonk).
  5. Projection.
  6. Result UI.

### P7. Substitutes and combinations — M

- **What:**
  - (a) A combination solver over stock (§2.2).
  - (b) A curated offline `parts.json` covering about 50 synth parts: aliases, pinout, supply, datasheet URL, and `substitutes[{mpn, compat: drop-in | pin-compatible-caveat | not-pin-compatible, note}]`. Examples: TL072 → TL082 (drop-in) and OPA2134; NE5532 with its bias-current caveat; BC547 ↔ 2N3904 with a **pinout differs** warning; 78L05 vs 79L05 pinouts **[U: verify each against the datasheet]**.
- **Why:** answers "I need 47k, can I make it?" and "Will the TL082 I have work?".
- **Model:** a core dataset with no storage, matched by base-MPN prefix.
- **UI:** a "Substitutes" block on the item card listing in-stock parts first; P1's no-exact state links to combinations.
- **Risks:** a wrong substitute destroys trust. Every entry needs a source link and a `verified` flag.
- **Tasks:**
  1. Solver and tests.
  2. Schema and 20 sourced seed entries.
  3. Card UI.

### P8. Ephemeral "Check a BOM" — M

- **What:** paste text, drop a CSV/TSV/XLSX file, or paste a Google Sheets link (rewritten to `/export?format=csv&gid=`). The importer then:
  - maps header synonyms: qty / qnty; ref / designator / index; value; footprint / package; name / description; mpn / "mfr #"; supplier columns `mouser*`, `tayda*`, `lcsc*`/`jlc*` (`C\d+`), `digi*`, `thonk*`, and URLs;
  - detects section rows;
  - expands refs (`R1-R4`, spaces, commas) and flags mismatches with Qty;
  - skips DNP;
  - infers the family from the description before the ref prefix (the `L` = LED trap);
  - parses values with that family hint;
  - matches by learned alias, then base-MPN prefix, then family + value (+ package, a mismatch only warns), then fuzzy text.
- **Result:** per line ✓ / short / unmatched, plus "buildable ×N" = min(floor(stock / qty)). **Nothing is saved.**
- **Why:** most of the value of builds, with no new tables.
- **Model:** optional `match_aliases(inventory_id, key_text, item_id, variant_id)` so manual matches are remembered.
- **UI:** desktop two-pane (lines | match + stock) with a ×N stepper; the phone gets a paste box and a summary.
- **Risks:** format chaos, so a mapping preview is required. SheetJS is heavy, so lazy-load it. iBOM support comes later.
- **Tasks:**
  1. CSV and paste parsing (PapaParse).
  2. Header mapper with preview.
  3. Refs expander.
  4. Family inference.
  5. Matcher.
  6. UI.
  7. Fixtures from the §1.4 BOMs.

### P9. Saved BOMs and builds — L

- **What:**
  - Builds with a multiplier and a status (planned → reserved → built).
  - Available = on hand − reserved by open builds, allocated in build order.
  - "Mark built" writes `usage` movements with `build_id` atomically. Each carries a **cost basis** (`total_price` = average unit price × qty) and can receive 1 × the module at the build's cost.
  - When counts are stale, the build offers "set actual count" inline instead of failing on `insufficient_stock`.
- **Why:** builds × quantity, cost per module, and a real project reference instead of a free-text note.
- **Model:**
  - `boms`, `bom_lines` (refs, qty, raw value, parsed key, mpn, supplier SKUs jsonb, match, dnp) and `builds`.
  - `movements.build_id`; usage may carry `totalPrice` when it has a `buildId`.
  - Open builds go into the snapshot; archive target `bom`.
- **UI:** a Builds section. Each line shows need / have / reserved, with a "Mark built" sheet. The phone is mostly read-only plus "Mark built".
- **Risks:** scope creep toward PartsBox. Keep one allocation per line and no lots.
- **Tasks:**
  1. Schema.
  2. Commands.
  3. Reservation maths in core.
  4. Atomic completion SQL.
  5. UI.
  6. "Save as BOM" from P8.

### P10. Shopping list — M

- **What:** lines are derived from build shortages, reorder points and "running low" flags, plus manual lines. Each line has:
  - a suggested quantity rounded up to the pack size;
  - **"Buy again"** from the last receipt's `sourceUrl`;
  - per-store search links from editable `{q}` templates;
  - CSV export (`MPN,Qty,Description`) for the LCSC, Mouser and DigiKey BOM tools;
  - "Mark bought", which opens receive with the URL prefilled.
- **Why:** the roadmap's shopping lists, tied to stock to close the anti-duplicate loop.
- **Model:** optional `shopping_items` for manual lines; derived lines are not stored.
- **UI:** a phone checklist with store buttons; a desktop table grouped by store.
- **Risks:** affiliate and tracking junk in URLs; strip query parameters.
- **Tasks:**
  1. Derivation.
  2. Templates.
  3. CSV.
  4. UI.
  5. Receive prefill.

### P11. Reorder points and "running low" — S/M

- **What:**
  - `minQuantity` per item (the default for every bucket) with per-variant overrides, shown as "Low" / "Out" badges.
  - A "never run out" set (100k, 10k, 1k, 100n, 10u, TL072, PJ398SM).
  - A one-tap **"Running low"** flag (two-bin style) for consumables nobody counts, cleared by the next receipt.
- **Why:** "nobody knows what's left", without forcing anyone to count resistors.
- **Model:** `min_quantity` and `low_flag_at` on items and variants; the receipt batch clears the flag; `item.update` and `variant.update` extended. This is post-MVP per the roadmap.
- **UI:** a long-press "Running low" action, a "Low" filter, and "min 20" on the item card.
- **Risks:** item vs variant semantics. Document it as "per bucket".
- **Tasks:**
  1. Migration.
  2. Commands.
  3. `isLow` helper.
  4. Badges and filter.
  5. Flag action.

### P12. Counts and audits — M

- **What:** `stock.count { movementId, itemId, variantId, counted, auditId? }` journals a `count` movement **even when the delta is 0**. Each bucket shows "last counted". "Audit this drawer/folder" walks buckets oldest-counted first.
- **Why:** trustworthy numbers before builds. Today a confirmed count leaves no trace.
- **Model:** `MovementKind` adds `count`; new `movements.audit_id`; a `last_counted_at` projection.
- **UI:** phone first (standing at the cabinet): a big ✓ or a number pad per bucket. The journal collapses zero-delta counts.
- **Risks:** journal noise.
- **Tasks:**
  1. Kind and command.
  2. SQL.
  3. Projection.
  4. Audit flow.
  5. Journal rendering.

### P13. Locations with grid cabinets — L

- **What:** the second hierarchy from the spec.
  - `locations(id, inventory_id, parent_id, name, code, kind, grid_rows, grid_cols, grid_naming 'A1'|'1A'|'numeric', audit, archive)`.
  - `placements(item_id, variant_id?, location_id, slot?, note)`: **a pointer, not a stock split**.
  - `folders.default_location_id`, so a folder that mirrors a box places new items automatically.
  - Deeper compartments become child locations.
  - Folders say *what* a part is; locations say *where* it is.
- **Model:** new snapshot tables; `location.*` and `placement.*` commands; archive target `location`; search indexes code and slot ("B·A3").
- **UI:**
  - The item card shows "Bench cabinet › A3", which opens a grid with the cell highlighted.
  - Desktop: a rows × cols map with low/out tints; drag an item onto a cell.
  - Phone: a drawer list and mini-map.
- **Risks:** later requests for stock split by location. If that happens, use `location_id` on movements plus transfers.
- **Tasks:**
  1. Schema.
  2. Commands, archive.
  3. Snapshot.
  4. Grid naming utilities and tests (`A1` ↔ (0,0)).
  5. Screens.
  6. Search.

### P14. Labels and QR — M

- **What:**
  - A CSS print sheet (A4 label stock or 50×25 mm labels): big value, spec line, location code, and a QR code linking to the item or location.
  - Optional Niimbot output over Web Bluetooth **[S]**.
  - In-app scanning with `BarcodeDetector`, falling back to zxing-wasm.
- **Model:** none. Deep links need an SPA fallback in hosting (Plan 5) **[U]**.
- **UI:** desktop "Print labels" from a selection or location; a phone scan button in the search bar.
- **Risks:** the variety of printers. Start with print/PDF only.
- **Tasks:**
  1. QR library.
  2. Label templates.
  3. Print CSS.
  4. Deep-link routes.
  5. Scanner.

### P15. Lookup links and enrichment adapters — S (links) / M (adapters)

- **What:**
  - Item card "Find" row: AliExpress, LCSC, Tayda, Thonk, Mouser, Octopart, datasheet.
  - A "Datasheet" URL attribute.
  - Opt-in adapters with keys in IndexedDB: **jlcsearch** (no key; fills package and LCSC id) and **Mouser** (the user's key; datasheet and description).
- **Model:** results are written via `item.setAttribute`.
- **UI:** "Fill from LCSC / Mouser" shows a diff to accept.
- **Risks:** API drift and outages (one observed tonight).
- **Tasks:**
  1. Templates.
  2. Adapter interface.
  3. Two adapters.
  4. Diff UI.

### P16. Kits and finished modules — M (after P9)

- **What:**
  - An unbuilt kit is one item, optionally with its BOM attached; its parts are not loose stock.
  - "Build kit" uses the kit and receives the module, costed as kit plus extras, and optionally receives leftover parts.
  - Salvaged parts are receipts at price 0 marked "salvage".
  - Module attributes (HP, mA) leave room for a later case power/HP budget **[idea]**.
- **Model:** reuses `build_id` (P9) and `batch_id` (P5).
- **Tasks:**
  1. Kit template.
  2. Build-kit flow.
  3. Leftover receive.

### P17. Distributor label scanning — M, low priority

- **What:** parse Mouser/DigiKey ECIA DataMatrix labels and LCSC QR codes into quick add (MPN, qty, URL).
- **Why low:** AliExpress bags carry no standard label.
- **Risks:** formats are **[U]**; collect real samples first.
- **Tasks:**
  1. Samples.
  2. Parsers.
  3. Scan-to-quick-add.

---

## 4. Top 5 by value/effort

1. **P1 + P2-core: notation-proof value search (S, then M).** Fixes a real wrong answer in the core scenario, needs no data entry, and everything else builds on it.
2. **P8: ephemeral "Check a BOM" (M).** "Can I build this ×N, what's missing" with no new tables; real fixtures already exist.
3. **P6: share target / paste "Do I have it?" + purchase-URL match (M).** Targets duplicate purchases on the phone with data already stored.
4. **P4: templates + E-series generator (S/M).** The 170-value book becomes a 30-second setup, and its values feed P1/P3.
5. **P11 + derived P10: reorder points and "running low" feeding a shopping list (S/M).** "Never run out" with almost no counting.

Next: P5 (S, correct kit cost), P12 (zero-delta counts are lost today), then the larger pillars P3, P9 and P13.

## 5. Open questions and unverified items

- **Formats:**
  - Does Tayda have a bulk-order format?
  - What text does the AliExpress share intent send, and can short links be resolved?
  - What are the exact iBOM `bom` fields and the default KiCad 9 CSV headers?
- **APIs:** a DigiKey preflight from a real browser; Mouser's response fields; Nexar evaluation limits (its docs conflict).
- **Batch size:** the Neon HTTP batch limit for 340-statement variant generation.
- **Dataset accuracy:** every pinout and substitute claim (BC547/2N3904, 78L05/79L05) needs a manufacturer-datasheet check before it goes into the dataset.
- **Owner preference:** does the owner name values RKM-style (`4k7`) or decimal (`4.7k`)? This sets the default display.

## Sources

- [RKM code](https://handwiki.org/wiki/RKM_code) · [IEC 60062](https://handwiki.org/wiki/IEC_60062) · [E-series / IEC 60063](https://www.wikipedia.org/wiki/IEC_60063) · [EEPower resistor values](https://eepower.com/resistor-guide/resistor-standards-and-codes/resistor-values/) · [North Coast Synthesis: preferred values](https://northcoastsynthesis.com/news/preferred-values-for-resistors-and-capacitors)
- [InvenTree parameters](https://docs.inventree.org/en/latest/concepts/parameters/) · [InvenTree stock locations](https://docs.inventree.org/en/latest/stock/) · [Part-DB concepts](https://docs.part-db.de/concepts.html) · [Part-DB BOM import](https://docs.part-db.de/usage/bom_import.html) · [PartsBox BOM import](https://partsbox.com/bom-import.html) · [PartsBox advanced builds](https://partsbox.com/advanced-build-system.html) · [Binner](https://GitHub.com/replaysMike/Binner) · [DigiKey maker blog](https://www.digikey.com/en/maker/blogs/2025/how-i-organize-and-keep-track-of-my-inventory)
- [Nexar part limits](https://support.nexar.com/support/solutions/articles/101000476314-part-limits-and-how-they-work) · [Nexar FAQ](https://support.nexar.com/support/solutions/articles/101000497890-frequently-asked-questions) · [Nexar add-on fields](https://support.nexar.com/support/solutions/articles/101000542739-plan-add-on-specific-data-fields) · [Nexar similar parts](https://support.nexar.com/support/solutions/articles/101000434631-supply-similar-parts) · [Mouser API](https://www.mouser.com/api-search/) · [DigiKey developer](https://developer.digikey.com/documentation) · [LCSC API](https://www.lcsc.com/docs/openapi/index.html) · [jlcsearch](https://docs.tscircuit.com/web-apis/jlcsearch-api) · [jlcparts](https://www.github.com/yaqwsx/jlcparts)
- [Thonkiconn](https://www.thonk.co.uk/shop/thonkiconn) · [synthdiy wiki: Jacks](https://axebps-redlib.hf.space/r/synthdiy/wiki/Jacks) · [sdiy: Kosmo components](https://sdiy.info/wiki/Kosmo_components) · [sdiy: stocking up](https://sdiy.info/wiki/Stocking_up_on_components) · [kassu2000 common parts](https://kassu2000.blogspot.com/p/common-parts-list.html) · [LMNC alternate BOMs](https://lookmumnocomputer.discourse.group/t/alternate-boms/1325) · [Synthrotek-style BOM](https://docs.google.com/document/d/e/2PACX-1vRD35eqKnI6_RcJQbAZdR9ryeiib_4_OJL4WtXnscVh4N6yExzml3siIK42aqCPUXqdYUgyHpwzI9YS/pub) · [Example module BOM sheet](https://docs.google.com/spreadsheets/d/13YGDT3bGwYPkZGuFIIXs6zN4Td07lZ-tuEd5n-Ji8LM) · [KiCad BOM issue](https://gitlab.com/kicad/code/kicad/-/issues/22613) · [LCSC BOM tool](https://lcsc.com/bom)
- [Silicon Chip: NE5532 vs TL072](https://siliconchip.com.au/Issue/PE/2023/May/AUDIO+OUT) · [diyAudio TL072 replacement](https://www.diyaudio.com/community/threads/tl072-opamp-replacement.209839/) · [0805 sample book](https://www.electrokit.com/en/parm-med-8500st-motstand-smd-0805) · [600 pcs kit](https://kunkune.co.uk/shop/electronic-components/600pcs-metal-film-resistors-1-4watt-1-tolerance-30-values/)
- [Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target) · [BarcodeDetector (caniuse)](https://caniuse.com/mdn-api_barcodedetector_barcodedetector) · [NiimBlueLib](https://unpkg.com/@mmote/niimbluelib@0.0.1-alpha.38/README.md) · [Two-bin kanban](https://businessmap.io/blog/two-bin-kanban-system) · [PedalPCB inventory thread](https://forum.pedalpcb.com/goto/post?id=316355) · [AllAboutCircuits thread](https://forum.allaboutcircuits.com/threads/how-do-you-organise-your-components.210053/)
