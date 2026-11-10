# 02: Fast capture, identification and physical-world links (no server)

Research date: 2026-11-11. Target: Android Chrome (installed PWA) plus desktop Chrome. Package versions and dates come from the npm registry (fetched today). Anything I could not confirm from a primary source is marked **[unverified]**.

## Key findings

1. **The best capture feature needs no new hardware: a Web Share Target.** Share an AliExpress product or screenshot to GrayMatter and it answers "you have 12 TL072 in Op-amps" before you buy. Works on Android Chrome 76+ for installed PWAs; needs a custom service worker (`@vite-pwa/nuxt` → `injectManifest`).
2. **Scanning is native on the owner's phone.** `BarcodeDetector` has shipped on Android since Chrome 83 (needs Google Play services). For desktop Windows/Linux, use `barcode-detector@3.2.3` (zxing-wasm, ~390 KB brotli). Avoid html5-qrcode (last release April 2023).
3. **Labels should carry a short code, not a UUID:** uppercase `HTTPS://<HOST>/C/<8-char code>`, which fits QR version 2 (25×25). One small `codes` table serves QR labels, NFC tags and supplier barcodes. A code becomes a row only when first assigned, so blank sheets can be printed ahead.
4. **Uploadcare's free tier has changed.** The official pricing page today says **1,000 operations/month, 1 GB storage (never resets), 5 GB traffic, "personal use only", and over-limit means suspension until next month**. The spec's 3 GB / 30 GB / 3,000 uploads is out of date. This affects Plan 4 (§7).
5. **Cloud vision with the owner's own API key works from a static page.** The Anthropic API accepts CORS with `anthropic-dangerous-direct-browser-access: true`; `@anthropic-ai/sdk@1.8.0` sends it when `dangerouslyAllowBrowser: true` (checked in the SDK source). A phone screenshot costs about 3.4k input tokens. On-device AI doesn't work on Android: Chrome's Prompt API is desktop-only, and Tesseract and Florence-2 are poor or heavy on a phone.

---

## 0. Shared foundation: one `codes` table and one `/c/:code` route

Topics 1–3 all reduce to "a physical thing carries a string, and the string resolves to a folder, item or variant". Build that once.

**Data model** (new migration in `packages/storage-postgres`, new `codes: Code[]` in `InventorySnapshot`):

```ts
// core/model.ts
interface Code {
  value: string            // 'GM:7K3M9Q2X' for own labels, 'LCSC:C2286', 'EAN:4006381333931', 'MPN:LM358DR2G'
  inventoryId: Id
  folderId: Id | null      // exactly one of folderId / itemId / variantId is set (CHECK constraint)
  itemId: Id | null
  variantId: Id | null
  source: 'label' | 'supplier' | 'retail'   // an NFC tag carries the same 'label' code as the QR
  createdAt: string; createdBy: string
}
// commands.ts
| { type: 'code.assign'; inventoryId: Id; value: string; source: Code['source']; target: { folderId?: Id; itemId?: Id; variantId?: Id } }
| { type: 'code.unassign'; inventoryId: Id; value: string }
```

- The primary key is `(inventory_id, value)`, with an index on `value` so an own-label code can be found across inventories. Foreign keys to folders, items and variants use `on delete cascade`, matching `photos`. Archiving keeps the code: scanning a code whose target is archived opens the target with a "Restore" action.
- **Own codes:** 8 characters of Crockford base32 (`0-9A-Z` without I, L, O, U), generated on the device with `crypto.getRandomValues`, which gives 40 bits. Every character is in the QR alphanumeric set, the code is easy to type, and it is printed under the QR as `7K3M-9Q2X`.
- **Codes are born on first assignment.** A blank sheet of 65 random codes needs no database write. Scanning an unknown own code opens "New label → assign to folder / item / variant, or create one". At 40 bits, collisions are negligible for one person, and the primary key catches one anyway.
- **Route** `pages/c/[code].vue`: look in the current snapshot, which also works offline because the snapshot is cached. If it isn't there and the device is online, run one `select inventory_id, … from codes where value = $1`, switch inventory if needed, then `router.replace('/folder/…' | '/item/…?variant=…')`. Vue Router matches paths case-insensitively by default (`sensitive: false`), so `/C/7K3M9Q2X` from an uppercase QR resolves. Static hosting must serve the SPA for `/c/*`. The service worker's `navigateFallback: '/'` covers this once installed; the first visit needs a host rewrite, which is a Plan 5 item.
- **Search palette:** typing or pasting a code, or a full label URL, jumps straight to the target. That also makes a USB keyboard-wedge barcode scanner work on desktop for free (effort S).

This table also connects to the post-MVP "physical storage locations" hierarchy. When locations arrive, add a `locationId` target; the labels already on bins keep working.

---

## 1. Barcode and QR scanning in the PWA

### Status
- **Native `BarcodeDetector`:** launched in Chrome 83 on Android, macOS and ChromeOS. Android needs Google Play services. Not available on Windows or Linux desktop Chrome, nor in Firefox; Safari only behind a flag ([Chrome shape-detection docs](https://developer.chrome.com/docs/capabilities/shape-detection), [caniuse](https://caniuse.com/mdn-api_barcodedetector)). It is also exposed in workers. Android formats (check with `getSupportedFormats()`): aztec, code_128, code_39, code_93, codabar, data_matrix, ean_13, ean_8, itf, pdf417, qr_code, upc_a, upc_e. The Text and Face detectors are still behind a flag.
- **Fallback:** [`barcode-detector`](https://github.com/Sec-ant/barcode-detector) 3.2.3 (19 Oct 2026) is a spec-shaped polyfill/ponyfill over [`zxing-wasm`](https://github.com/Sec-ant/zxing-wasm) 3.1.6 (ZXing-C++). Measured from jsDelivr, `zxing_reader.wasm` is 947 KB raw and **389 KB brotli** (the full build is 1.5 MB / 574 KB). By default it fetches the wasm from jsDelivr, so use `prepareZXingModule({ overrides: { locateFile } })` to self-host. The polyfill only installs when no native global exists, so Android keeps using ML Kit.
- **Alternatives:** `html5-qrcode` 2.3.8 (last release April 2023, 450+ open issues; avoid); `@zxing/browser` 0.2.1 (pure JS port, slower, weaker on 1D); `@undecaf/zbar-wasm` 0.11.0 (May 2024); `vue-qrcode-reader` 5.7.3 (pins the older `barcode-detector@2.2.2`; prototype only).
- **Camera pitfalls:** on multi-camera Androids, `facingMode: 'environment'` often opens the ultra-wide lens, which has no autofocus and makes codes blurry up close ([SO](https://kaweah.freedombox.rocks/kiwix/stackoverflow.com_en_all_2023-11/questions/66306956/how-to-choose-which-camera-to-activate-with-getusermedia-for-barcode-scanning-), [Anyline camera docs](https://documentation.anyline.com/web-sdk-component/latest/advanced-camera-api.html)). Torch is available on Chrome Android through `track.applyConstraints({ advanced: [{ torch: true }] })`. Whether `focusMode` and `zoom` are honoured depends on the device; read them from `track.getCapabilities()`.

### Recommendation
- A small `useScanner()` composable (~150 lines) on `barcode-detector/ponyfill`, not a scanning UI library.
- A full-screen sheet in the app's quiet style: viewfinder rectangle, torch and lens-switch icon buttons. Opened from a scan icon in the phone's bottom search bar, the palette action "Scan" (⌘K), and "Scan to receive" in the receive sheet.
- Detect on `requestVideoFrameCallback`, throttled to ~8–10 fps. On the first hit: `navigator.vibrate(30)`, freeze the frame, resolve.
- Remember the working lens per device (IndexedDB, next to the tree state). Apply `zoom: 2` when supported: it pulls small codes in and avoids the ultra-wide lens.

**Resolution pipeline** (pure functions in `core`, easy to unit-test):
1. Own URL or `GM:` code → `codes` lookup.
2. **LCSC QR:** a brace payload like `{pbn:…,on:…,pc:C2286,pm:LM358DR2G,qty:50,…}`, from which take `pc`, `pm` and `qty` **[unverified: check on a real bag]**.
3. **DigiKey/Mouser DataMatrix:** ECIA / ISO 15434 `[)>␞06␝…` with data identifiers `P` (customer PN), `1P` (MPN), `Q` (qty). InvenTree and Part-DB both parse these ([InvenTree barcodes](https://docs.inventree.org/en/latest/barcodes/custom/), [Part-DB scanner](https://docs.part-db.de/usage/scanner.html)).
4. EAN/UPC → `EAN:<digits>`.
5. Anything else: raw text goes to the search palette.

If the value is not in `codes`, search for the MPN, then offer "Link this barcode to…", "Receive into…" with the quantity filled in from `Q`/`qty`, or "New item".

**Effort:** S for QR-only on native Android; M including the supplier parsers and the desktop wasm fallback.
**Risks:** no Play services on de-Googled phones (the wasm fallback covers it); the ultra-wide lens and low light; 1D codes on crinkled bags; `.wasm` is not in the current `workbox.globPatterns` (add it if offline desktop scanning matters). AliExpress parts bags rarely carry a useful barcode, so the value is in **own labels** and LCSC/DigiKey/Mouser bags.

---

## 2. Labels for bins, drawers and bags

### 2a. What the QR should encode
| Option | Verdict |
|---|---|
| `https://host/item/<uuid>` | 36-char UUID gives QR version 4–5 at 12 mm, which is hard to scan. Ties the label to one item, can't be printed ahead. Homebox users complain that "the whole uid … is much too big for the QR" ([Homebox discussion](https://WWW.GITHUB.COM/hay-kot/homebox/discussions/796)). |
| Custom scheme `graymatter://…` | Phone camera apps would show plain text. Manifest `protocol_handlers` only takes `web+` schemes and is a desktop feature **[unverified on Android]**. Avoid. |
| **`HTTPS://HOST/C/7K3M9Q2X`** | **Recommended.** A stock camera or Google Lens opens it; the in-app scanner parses the `/c/<code>` path on any host, so labels survive a domain move. |

**Size arithmetic:** QR alphanumeric mode holds 38 characters at version 2-M and 47 at 2-L; byte mode holds only 26 at 2-M. `HTTPS://` + host + `/C/` + 8 characters = 19 + host length. A host of up to 19 characters stays at **version 2 (25×25)**. The lowercase form uses byte mode and becomes version 3 (29×29). At 3 thermal dots per module (203 dpi, 0.375 mm), a version-2 code is 9.4 mm wide plus the quiet zone, which fits 12 mm Niimbot labels. On A4 with a laser printer, 10–12 mm is comfortable. Both `uqr` (unjs, 0 deps, SVG output) and `lean-qr` 2.7.4 pick the alphanumeric segment automatically when every character qualifies **[unverified for uqr: check the output version]**.

### 2b. A4 label sheets (desktop)
- **No PDF library needed.** Add a `/labels/print` page with an `@page { size: A4; margin: 0 }` print stylesheet and an absolutely positioned grid in `mm`. The QR codes are inline SVGs, so they stay crisp at any DPI.
- Presets **[check against the packaging]**: Avery L7651 (65 labels, 38.1×21.2 mm), L7656 (84, 46×11.1 mm), L7160 (21, 63.5×38.1 mm), and "custom" (columns, rows, size, pitch, margins).
- **"Start at position N"** to reuse part-used sheets, plus a calibration print (outlines only). Print at "Actual size / 100%".
- Two modes: **blank codes** (N random codes, assigned later by scanning) and **named labels** (folder or item name, key values such as "10 kΩ · 0805", code, QR).
- If a downloadable PDF is ever wanted: `jspdf` 4.2.1 (Mar 2026) is maintained; `pdf-lib` 1.17.1 dates from 2021.

### 2c. Thermal printers from the browser
- **Niimbot (B1, B21, D11, D110…):** [`@mmote/niimbluelib`](https://github.com/MultiMote/niimbluelib) 0.49.1 (5 Nov 2026, MIT) powers [NiimBlue](https://github.com/MultiMote/niimblue), a browser label designer at niim.blue (829 stars, pushed 9 Nov 2026; Bluetooth and USB). The protocol is reverse-engineered, with a community printer wiki at [printers.niim.blue](https://printers.niim.blue) (B1, B21 Pro, D110, D110_M, D11_H, D101, B31, M2_H…) and "no official supported list". Web Bluetooth works in Chrome on Android; I found no report specific to Android Chrome **[unverified]**. **Best fit for this owner:** a cheap Bluetooth printer the phone drives directly; 12–15 mm labels for bag tags, 40–50 mm for drawer fronts.
- **Brother QL (DK rolls, USB) and PT (P-touch):** [`@thermal-label/brother-ql-web`](https://thermal-label.github.io/brother-ql/) (WebUSB, MIT, per-device verification tracking). The same [organisation](https://thermal-label.github.io/) covers Dymo LabelManager, LabelWriter and LetraTag, and Marklife. QL is USB-only in practice, so desktop. The Dymo LabelWriter 550 needs NFC-locked Dymo media. P-touch Bluetooth models use classic Bluetooth (RFCOMM); Chrome on Android has had Web Serial over RFCOMM since Chrome 138 ([intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/BqUGCcurReE)), but I found no JS P-touch driver for it **[unverified]**.
- **Phomemo:** [phomymo](https://gh.r-mj.com/transcriptionstream/phomymo) covers M02, M03 and T02 over Web Bluetooth. The M110 has only a Python implementation.
- **Reconnecting:** Web Bluetooth `getDevices()` was behind a flag in the sources I found, so expect a device picker each session **[unverified for current Chrome]**.

### Recommendation, effort, risks
- **Phase 1 (S):** the `codes` table and route, a "Label" sheet on folders and items (QR preview, code, Print, Copy link), and the A4 print page with presets and blank-code mode.
- **Phase 2 (M):** a `LabelPrinter` interface (`print(bitmap: ImageData, media)`) with a `niimbot` implementation that lazy-loads niimbluelib. Render the label to a 1-bit canvas in the app, so every printer backend just takes a bitmap.
- **Risks:** a printer firmware update can break the reverse-engineered protocol; there are no Bluetooth APIs on iOS (irrelevant for this owner); A4 printer margins vary, hence the calibration print.

**Phone UI flow:**
1. Folder screen → `⋯` → **Label**. A bottom sheet shows the QR preview, `7K3M-9Q2X`, and the actions [Print on Niimbot] [Add to A4 queue] [Write NFC tag] [Copy link].
2. The A4 queue is printed later from the desktop.
3. Scanning a blank label shows "New label" with: Assign to this folder / Pick folder… / Pick item… / Quick add an item here.

---

## 3. Web NFC (Android Chrome)

### Status
[developer.chrome.com/docs/capabilities/nfc](https://developer.chrome.com/docs/capabilities/nfc): shipped in Chrome 89, Android only; `makeReadOnly()` needs Chrome 100+. NDEF only (text, URL, MIME, external records); no low-level ISO-DEP/NFC-A, no peer-to-peer. Calls need a user gesture, a top-level secure context and the `nfc` permission, and work only while the page is visible and the screen unlocked. Supports `AbortController` and `write(…, { overwrite: false })`.

### Recommendation
NFC is a **second carrier for the same code**: one NDEF URL record, `https://host/c/7K3M9Q2X`, on an NTAG213 sticker (144 bytes of user memory, plenty).
- **App closed:** Android's tag dispatch opens the URL, the same deep link as the QR. Whether the installed WebAPK or a Chrome tab catches it is the same open question as for QR ([web.dev on WebAPKs](https://web.dev/articles/webapks); sources conflict for links from other apps) **[unverified → E2]**.
- **App open:** a "Tap tag" sheet runs `NDEFReader.scan()` and gets the `reading` event **[unverified whether Android dispatch still fires too → E9]**.
- **Writing:** the Label sheet's [Write NFC tag] button runs `ndef.write({ records: [{ recordType: 'url', data: url }] })` with the folder's code, creating the code row first if needed. `makeReadOnly()` is optional, behind a confirm, because it can't be undone.

**Effort:** S, once §0 exists. **Risks:** Android only; metal drawers need on-metal tags; NFC is often switched off; tapping a 3×4 grid of small drawers is slower than one QR scan. Use NFC on a few busy bins, not on every bag.

---

## 4. OCR and AI recognition without a server

### Status
- **Tesseract.js** 7.0.0 (Dec 2025): fine on clean screenshots but layout-blind, so an order list becomes a soup of text that still needs parsing. Poor on laser-etched IC markings **[unverified: widely reported, not benchmarked]**.
- **PaddleOCR in the browser:** `@gutenye/ocr-browser` 1.4.9 and `ppu-paddle-ocr` 6.7.0 (both on `onnxruntime-web`). Better on scene text; still text, not structure.
- **Transformers.js** 4.3.2 (27 Oct 2026, rewritten WebGPU backend, [v4 blog](https://huggingface.co/blog/transformersjs-v4)). Florence-2-base does OCR but is ~230M parameters / ~340 MB (2024 figure), too heavy for routine phone use.
- **Chrome built-in AI:** the Prompt API is stable on **desktop** Chrome 148 ([built-in APIs](https://developer.chrome.com/docs/ai/built-in-apis)). The May 2026 docs say **Chrome for Android is not supported**, and the model needs ~22 GB free disk ([Prompt API](https://developer.chrome.com/docs/ai/prompt-api)). Not an option for the phone.
- **The owner's own API key, called from the browser:**
  - **CORS:** the Anthropic API accepts browser calls with `anthropic-dangerous-direct-browser-access: true` ([Willison, 2024](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access)); `@anthropic-ai/sdk` 1.8.0 sends it when `dangerouslyAllowBrowser: true` (confirmed in the published `client.js` today).
  - **Vision** ([docs](https://platform.claude.com/docs/en/build-with-claude/vision)): JPEG, PNG, GIF or WebP; 10 MB per image; at most 8000×8000. Cost = ⌈w/28⌉×⌈h/28⌉ visual tokens; Claude 4.7+ models use the high-resolution tier (long edge ≤ 2,576 px, ≤ 4,784 tokens). A 1080×2400 screenshot is **≈ 3,354 input tokens**.
  - **Prices per MTok in/out** (cached 3 Nov 2026): Claude Opus 5.5 $4/$20 (the default model), Claude Sonnet 5.5 $2/$10, Claude Haiku 5.5 $0.10/$0.50. So about 1.3¢ input per screenshot on Opus 5.5, about 0.03¢ on Haiku 5.5, plus output. Model choice is the owner's call; measure in E5.
  - **Structured outputs:** `output_config.format = { type: 'json_schema', schema }` on all three ([docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)). No `minimum`/`maximum`/`minLength`; `additionalProperties: false` required; at most 24 optional parameters and 16 `anyOf`/type-array parameters, so use empty strings instead of nullable fields. Opus 5.5 and Sonnet 5.5 can't turn thinking off, so use `effort: 'low'`; check `stop_reason === 'refusal'` before parsing.
  - **Other providers:** OpenAI and Gemini also allow own-key browser calls **[unverified for 2026]**; Gemini's free tier may use prompts for training **[unverified]**.

### Recommendation
Don't build on-device OCR for markings. For a part marking, use **Android's own Lens/"Select text" → Share → GrayMatter** (§5): Google's OCR is free and better. Spend the effort on **"order screenshot → items"** with the owner's own key:

- **Key storage:** **per device in IndexedDB**, beside the Neon connection string, never in Neon. Same trust model: whoever has the Neon string can already read and write the whole inventory.
- **Mitigations:** a dedicated key in its own Console workspace with a low monthly spend limit **[check limits are available on the account]**; a strict CSP (`connect-src` limited to the Neon host, `api.anthropic.com` and the photo CDN; no third-party scripts); a "Forget key" button.
- **Privacy:** the screenshot leaves the device; say so in the UI. Send **no inventory data**: the model extracts, the app matches locally with the existing MiniSearch.

**Effort:** M. **Risks:** extraction errors in lots × pack size (hence a review sheet, never auto-apply); cost if the key leaks; the model refusing; the API changing.

### Prompt and schema sketch
Module: `packages/app/app/lib/order-import.ts` (lazy chunk). Call:

```ts
const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
const res = await client.messages.create({
  model: 'claude-opus-5-5', max_tokens: 4000,
  output_config: { effort: 'low', format: { type: 'json_schema', schema: ORDER_SCHEMA } },
  system: ORDER_SYSTEM,
  messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/webp', data } },
    { type: 'text', text: sharedText ? `Shared text: ${sharedText}` : 'Extract the purchased lines.' } ] }],
})
```

`ORDER_SCHEMA`: every field is required, so there are zero optional parameters:

```json
{ "type":"object","additionalProperties":false,"required":["page_kind","currency","lines"],
  "properties":{
    "page_kind":{"type":"string","enum":["order_list","order_detail","product_page","cart","other"]},
    "currency":{"type":"string","description":"ISO code as shown, or empty"},
    "lines":{"type":"array","items":{"type":"object","additionalProperties":false,
      "required":["title","short_name","part_numbers","sku_text","value_hint","lots","pieces_per_lot","unit","lot_price_text","line_total_text","confidence"],
      "properties":{
        "title":{"type":"string","description":"verbatim, may be truncated"},
        "short_name":{"type":"string","description":"clean name: part number, package, key value; no marketing words"},
        "part_numbers":{"type":"array","items":{"type":"string"}},
        "sku_text":{"type":"string","description":"selected option verbatim, e.g. '10K ohm 100PCS'"},
        "value_hint":{"type":"string","description":"variant value only, e.g. '10k', '100nF', 'DIP-8'; empty if none"},
        "lots":{"type":"string","description":"decimal; the xN / Qty count of lots"},
        "pieces_per_lot":{"type":"string","description":"decimal from SKU or title ('100PCS','50pcs/lot','5M'); empty if unknown"},
        "unit":{"type":"string","enum":["pcs","m","g","l","other"]},
        "lot_price_text":{"type":"string"},"line_total_text":{"type":"string"},
        "confidence":{"type":"string","enum":["high","medium","low"]}}}}}}
```

`ORDER_SYSTEM`, the core rules:
- One line per purchased SKU that is visible. Never invent lines or hidden values.
- `xN` or `Qty N` means **lots**. The pack size comes from the SKU first, then the title.
- Copy prices exactly as shown, with the currency symbol.
- `short_name` drops words like New, Original, High Quality and Free Shipping.

**On the client:**
- **Quantity:** `quantity = lots × pieces_per_lot` (core decimal math). If `pieces_per_lot` is empty, quantity is just `lots` and the line is flagged.
- **Total price:** `totalPrice = parseMoneyText(line_total_text)`, falling back to `lots × lot_price`.
- **Matching:** search `part_numbers`, then `short_name`. Match `value_hint` against variant names through the SI-prefix parser, so "10K ohm" becomes `10k`.

**Review sheet:** one row per line, each with a choice:
- "Receive +200 into *TL072* (have 12)";
- "New item in [folder ▾]";
- "Skip".

**Apply** sends one batch of `stock.receive` and `item.create` commands, with `initialReceipt` carrying `sourceUrl` when the shared text had a link. Use the same JSON schema later as the input schema of the planned MCP server's "add items" tool.

---

## 5. Getting data in from the marketplace

### Status
- **Web Share Target** ([Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target), [MDN](https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/share_target)): Android Chrome 76+ and desktop Chrome 89+; the app must be installed; **one `share_target` per manifest**. GET handles text and URLs; POST `multipart/form-data` handles files and **must be caught by the service worker** (there is no server). On Android, `url` is usually empty and the link arrives inside `text`.
- **Nuxt wiring:** switch `@vite-pwa/nuxt` to `strategies: 'injectManifest'` with a custom `sw.ts`; precaching (`precacheAndRoute(self.__WB_MANIFEST)`) and the navigate fallback keep working. References: Elk, a Nuxt PWA ([vite-pwa Nuxt](https://vite-pwa-org.netlify.app/frameworks/nuxt)), and [Workbox share targets](https://web.dev/articles/workbox-share-targets).
- **AliExpress:** the app shares a title plus a short `a.aliexpress.com/_…` link **[unverified exact format: see E4]**. A browser cannot fetch AliExpress pages or expand short links (CORS), and the ToS bars systematic retrieval ([summary](https://webscraping.ai/faq/aliexpress-scraping/what-are-the-penalties-for-scraping-aliexpress-against-their-policy), not a primary quote). The Affiliate/Open Platform API needs an approved app key and secret-based signing, so it doesn't fit a static PWA.
- **Bookmarklet (desktop):** runs inside the order page, reads the DOM, opens `https://host/import#<base64 JSON>`; no CORS problem. Breaks whenever AliExpress changes its markup; page CSP might block it **[unverified]**. Chrome on Android has no extensions; a desktop MV3 content script means maintaining an extension.
- **Clipboard:** a `paste` event on a focused field always works, including `clipboardData.files` for images **[unverified for Gboard image paste]**. `navigator.clipboard.readText()` needs a gesture and a permission.

### Recommendation
One share target, POST multipart, accepting `title`, `text`, `url` and `files: [{ name: 'media', accept: ['image/*'] }]`, with `action: '/share'`.

**Service worker:** on `POST /share`, read `formData()`, save it with `idb-keyval` (already a dependency) under `share:<ts>`, then `Response.redirect('/share?id=<ts>', 303)`.

**`/share` page:**
- **Text with a link** (a product shared from the AliExpress app or Chrome): pull the URL out of `text`, strip pack-size and marketing words from the title, find part-number-like tokens (`/[A-Z]{1,4}\d{2,}[A-Z0-9-]*/i`), and run the existing search. Show **"In stock: TL072, 12 pcs in Op-amps"** or "Not found", with [Open], [Receive…] (purchase URL filled in) and [Quick add] (name and URL filled in). The "do I already have it?" check in two taps, with no AI.
- **Image:** "Read order with Claude" (§4) if a key is set; otherwise attach it as a photo to Quick add (Plan 4).
- **Plain text** (Lens OCR of a chip marking, an order e-mail): search, or "Parse as order" with the text-only variant of the same prompt.

**Effort:** M; most of it is the switch to `injectManifest` and testing the service worker.
**Risks:**
- A custom service worker adds update and caching bugs; keep it tiny.
- Share target only works once installed; test the WebAPK update when the manifest changes.
- The AliExpress share format can change, so parse defensively and always fall back to "search the raw text".

---

## 6. Voice ("used 3 TL072")

### Status
- **`webkitSpeechRecognition`:** available on Chrome Android (prefixed), but recognition is server-side at Google. Continuous mode on Android is unreliable: it ends after silence and restarting it beeps ([community reports](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/60445404/issues-with-web-speech-api-in-android-chrome)).
- **On-device recognition:** `processLocally` + `SpeechRecognition.install()` ([MDN](https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally)) works on desktop. The May 2026 intent-to-ship thread says **Android and ChromeOS do not support on-device Web Speech yet** ([blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/P8P-x7AnC6I)).
- **Offline alternatives:** Whisper through Transformers.js (tens of MB or more, slow on a phone); Vosk-browser **[unverified maintenance]**; **Gboard voice typing**, which works offline with downloaded language packs and needs zero code.

### Recommendation
The engine is the easy part; the **grammar** is the value.
- **Parser:** `parseQuickCommand(text)` in `core` → `{ verb: 'use'|'add'|'set'|'move', qty, unit?, query, variantHint? }`. Accepts "used 3 TL072", "-3 tl072", "+100 10k 0805", "set 1k to 50", and numbers spoken as words.
- **Palette:** the parse is the first result, **"Use 3 × TL072 · 12 → 9"**; Enter or a tap applies a `stock.use`. Several matches are listed, each with its own preview.
- **Voice:** type, or use the keyboard mic (offline in Gboard). An optional mic button in the phone search bar uses `webkitSpeechRecognition` in single-utterance mode with `interimResults` (online only).
- **Undo:** an "Undo" toast (a reverse movement) on every quick command.

**Effort:** S (parser and palette) + S (mic button). **Risks:** misheard part numbers ("TL 0 72"), mostly absorbed by the typo-tolerant search; spoken values ("4.7k"); privacy of server-side recognition.

---

## 7. Camera capture for Plan 4 photos, and where to store them

### Capture
- **Two explicit buttons:** **Camera** (`<input type="file" accept="image/*" capture="environment">`, opens the rear camera) and **Gallery** (the same without `capture`, opens the Android photo picker). Recent Android/Chrome builds changed the picker for `video/*` inputs ([addpipe](https://blog.addpipe.com/html-file-input-accept-video-camera-option-is-missing-android-14-15/)), so don't rely on the implicit chooser. Keep `getUserMedia` for the scanner; native camera apps take better stills (HDR, focus).
- **Pipeline** (`packages/app/app/lib/image-prep.ts`, in a worker): `createImageBitmap(file)` (Chrome applies EXIF orientation, `imageOrientation: 'from-image'` **[verify, E6]**) → scale to a 2048 px long edge → `OffscreenCanvas` → `convertToBlob({ type: 'image/webp', quality: 0.8 })`, plus a 400 px thumbnail the same way. **Check `blob.type`**: browsers silently fall back to PNG. Re-encoding strips EXIF including GPS, a privacy plus. Expect ~250–500 KB full and ~15–30 KB thumbnail **[estimate]**. Skip AVIF: canvas encoding is unreliable across Chrome builds (sources conflict) and `@jsquash/avif` is a large, slow wasm on a phone. On 50–200 MP sensors decode memory can spike; if an older phone crashes, pass `resizeWidth/resizeHeight` to `createImageBitmap`.

### Storage: what changed and what is reachable from a static site
- **Uploadcare**, from the official [pricing page](https://uploadcare.com/pricing/), fetched 2026-11-11:
  - **Free plan:** 1,000 operations/month, **1 GB storage that does not reset**, 5 GB traffic/month, 500 MB max file size, "Personal use only".
  - **Over the limit:** "temporary suspension until the start of the next month".
  - **What counts** ([billing docs](https://uploadcare.com/docs/billing/)): an upload is 1 operation per 100 MB; an image request **not yet cached** on the CDN is 1 operation, whatever its parameters; cached requests cost 0; API calls are 1 each; usage is rounded up to the nearest thousand.
  - **Implications for Plan 4:** 1 GB at ~400 KB per photo is about 2,500 photos in total. A weekend photographing 300 existing bags, each with a thumbnail transform, costs 600+ operations. Two such weekends, or many first-time thumbnail views, risk a suspension that stops photos loading for the rest of the month. That brushes against the anti-goal "inventory stops opening because of photos", though broken thumbnails can degrade gracefully.
  - **Mitigations:** upload the device-made thumbnail as its own file (a predictable 1 operation, no CDN-cache-dependent transforms); show a placeholder when a CDN image fails; show monthly upload counts in Settings. "Personal use only" also matters for future open-source users.
- **Cloudinary:** 25 credits/month free, 1 credit ≈ 1 GB storage, 1 GB bandwidth or 1,000 transformations ([docs](https://cloudinary.com/documentation/billing_and_plans)). Unsigned upload presets allow browser uploads with only a cloud name and preset **[unverified for 2026]**. Sources disagree on whether the free plan is permanent.
- **ImageKit:** 20 GB bandwidth/month free; storage figures conflict (1–20 GB); delivery reportedly stops at the cap ([plans](https://imagekit.io/plans)) **[unverified]**.
- **Cloudflare R2** ([pricing](https://developers.cloudflare.com/r2/pricing/)): 10 GB-month storage, 1M Class A and 10M Class B operations, **free egress**. No server needed: the browser signs S3 requests itself (`aws4fetch`, a few KB) with a **bucket-scoped token stored on the device**, the same trust model as the Neon string, plus a bucket CORS rule. `r2.dev` URLs are rate-limited and dev-only ([docs](https://developers.cloudflare.com/r2/buckets/public-buckets/)), so production needs a custom domain. Probably requires a payment method on the account **[unverified]**. Bonus: the app can **delete** files, removing the spec's "files stay after permanent delete" compromise.
- **Backblaze B2:** S3-compatible with CORS, about 10 GB free **[unverified for 2026]**.
- **GitHub as storage:** the Contents API works with a PAT, but photos would be public, repo size has soft limits, and raw URLs are not a CDN. A hack, not an adapter.

**Recommendation:** keep the Plan 4 file interface, but have the app produce **both sizes on the device**, so no adapter depends on server-side transforms. Ship Uploadcare first only if the owner accepts the 1,000-operation cap. Otherwise make **`files-s3`** (R2 or B2 with a device-stored key) the first adapter: it is about the same effort (M) and has far more headroom. Update the spec's Uploadcare numbers either way.

---

## Ranked capture ideas for this owner

DIY synth parts from AliExpress, an Android phone, desktop setup.

1. **Share → "Do I have this?"** Web Share Target with text, a product-title cleaner and stock preview, plus Receive/Quick add with the URL filled in. It answers the main scenario in seconds. **M.**
2. **Short-code QR labels on drawers and bins:** the `codes` table, the `/c/:code` route and the Label sheet. One foundation for everything physical. **M.**
3. **In-app scanner** on native `BarcodeDetector`, with a lens picker, torch and zoom. **S–M.**
4. **A4 label sheets:** CSS print page, presets, start offset, blank-code mode; print 65 codes and assign them by scanning. **S.**
5. **Quick commands in the palette:** "used 3 TL072", "+100 10k 0805", dictated with Gboard's mic, with a stock preview and Undo. **S.**
6. **Order screenshot → items** through the share target and the owner's own Claude key, with structured output and a review sheet that applies one batch. **M.**
7. **Plan 4 photo pipeline:** two buttons, WebP made on device in two sizes, EXIF-safe, and a storage decision that takes Uploadcare's new limits into account. **M.**
8. **Supplier barcode parsing** (LCSC QR, DigiKey/Mouser DataMatrix, EAN), linked to items with quick receive of `Q`. **S** on top of #3.
9. **NFC tags** on the five or so busiest drawers, written from the Label sheet. **S** on top of #2.
10. **Niimbot printing** through niimbluelib behind a `LabelPrinter` interface, for bag tags with QR, name and value. **M.**
11. **Desktop bookmarklet** on the AliExpress orders page → `/import#…`. **M, fragile.**
12. *(Wait.)* On-device OCR or LLM: Chrome's Prompt API on Android, or WebGPU OCR. For now, Lens text plus share does the job.

## Experiments worth running (about an hour each)

- **E1 · Scanner on the real phone.** A single HTML page (no Nuxt) that logs `BarcodeDetector.getSupportedFormats()` and `enumerateDevices()`, opens each back camera, and prints `track.getCapabilities()` (torch, zoom, focusMode). Serve it locally and open it on the phone via `adb reverse tcp:3000 tcp:3000`. Scan a 10 mm QR, an LCSC or DigiKey bag, an EAN, and a crumpled AliExpress bag label. Record time to first detect per lens, with and without `zoom: 2`.
- **E2 · Do links open the installed PWA?** Install any HTTPS deploy (a Plan 5 preview, or a throwaway static PWA with `scope: '/'`). Open `https://host/c/TEST1234` from the stock camera app, Google Lens, an NFC tag with that URL record (app closed), and a link in Gmail. Note standalone window versus Chrome tab. This decides whether QR and NFC "just open the bin".
- **E3 · Label size.** Print QR codes at 8, 10, 12 and 15 mm, uppercase (alphanumeric, version 2) and lowercase (byte, version 3), on an A4 laser at 300 dpi, and on a 203 dpi thermal printer if available. Scan from 10–30 cm in drawer lighting. This picks the default size and ECC (M versus L).
- **E4 · Share target format.** In a throwaway branch, add a POST `share_target` and a 20-line service worker handler that saves the form data to IndexedDB and shows it raw. Share from the AliExpress app (a product, an order, a screenshot), from Chrome (a page) and from Lens (selected text). Save the exact `title`/`text`/`url`/files as parser test fixtures.
- **E5 · Order extraction quality and cost.** Five real AliExpress screenshots: order list, order detail, cart, product page, multi-SKU order. A Node script with `@anthropic-ai/sdk`, the schema above and `effort: 'low'`, run on Claude Opus 5.5, then Sonnet 5.5 and Haiku 5.5 to compare. Score lots × pack size, `value_hint`, prices and part numbers against hand-made truth; log `usage` and latency. Decide the default model.
- **E6 · Photo pipeline.** Run the worker on a portrait photo, a landscape photo, a full-resolution photo from the largest sensor, and an old JPEG with an EXIF rotation. Check orientation, `blob.type`, size at quality 0.75 and 0.82, time and memory.
- **E7 · Uploadcare operation accounting.** On a fresh free project: upload 10 photos, request two transformed sizes each, reload twice, fetch the originals, then read the dashboard counter. This models the 1,000/month budget. In parallel, time a browser-signed R2 upload (`aws4fetch` + CORS rule) to size the `files-s3` alternative.
- **E8 · Voice.** A test page with `webkitSpeechRecognition` (`interimResults`, single utterance). Dictate 20 phrases ("used 3 TL072", "plus 100 10k 0805", "NE5532", "4.7 microfarad"…). Compare with Gboard voice typing in airplane mode, then feed both transcripts to a draft `parseQuickCommand` and count correct parses.
- **E9 · NFC.** Write an NTAG213 URL record via `NDEFReader.write` (on a button tap). Read it with the page open (a `reading` event) and with the app closed (Android dispatch, see E2). Test through a plastic drawer front and on a metal shelf.
- **E10 · Niimbot** (if the owner has, or buys, a B1 or D110). Print a QR label from niim.blue on Android Chrome. Then run niimbluelib's example with a 1-bit canvas holding a version-2 QR and "10 kΩ · 0805". Note reconnect friction (a picker every session?) and print time.
