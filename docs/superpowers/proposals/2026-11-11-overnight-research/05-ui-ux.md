# 05 · UI, UX, interaction and visual design: overnight review

**Scope:** the app as of `revival` after Plan 3 (screens task-2 to task-11, components in `packages/app/app/components`, tokens in `assets/css/main.css`), measured against the shell spec, the mockup and section 4.7 of the revival spec.
**Mockup of the top proposals:** `05-ui-mockups.html` (same folder). It shows phone and desktop side by side, light and dark, and the stepper in it works.
**Ground rules I kept:** neutral actions, indigo only for the main button, selection and folder icons; no lifted containers; 2 px gaps between rounded selectable rows; everything works on both devices; no optimistic writes (revival spec 5.1); no new libraries except shadcn-vue components.

---

## 1. Critique of the current screens

### 1.1 What works (keep it)

- **The shell is right.** The rail, tree and main column on desktop (`task-5/folder-1280-dark-hover.png`) read like Sortly without its clutter. The tree has guide lines, counts that keep their place, and "+ ⋯" that fade in on hover. The 2 px gaps and the soft selection slab do what the owner asked for.
- **The palette is the best screen in the app** (`task-6/*`). It has a scope chip with the inventory name, grouped results, quantities on the right and key hints. On the phone the list is reversed so the best hit sits next to the thumb. That is a better answer to the main scenario ("do I have a TL072?") than any inventory app I looked at. iOS 26 also moved search to the bottom of the screen, which supports this choice.
- **Typography carries the hierarchy.** Titles are 24/700, quantities bold and tabular with a small unit ("37 pcs"), and the subline is muted. There is no chrome-heavy styling, and the light theme is calm.
- **The engineering behind the feel is solid.** CloseWatcher for the Android back gesture, `interactive-widget=resizes-content` for sheets above the keyboard, a long press that lifts the row, `motion-safe` everywhere, focus returned to the opener. These are the details users never notice and always miss when they are absent.
- **Out of stock is quiet but legible.** A grey number and an "Out of stock" subline (`task-5`), no red. It fits the brief.

### 1.2 What hurts

1. **Fast stock changes are slow.** This is the biggest problem, because changing stock is the app's second job.
   - Every "−"/"+" tap is its own `stock.receive`/`stock.use` of 1 (`quickStep` in `lib/stock-forms.ts`). Five taps mean five round-trips and five journal rows.
   - While any write is in flight, `state.saving` disables every action button in the app (`locked = readOnly || saving` in about a dozen components). On a cold Neon start (1–2 s) you tap "+", the buttons grey out, and the next tap is lost. Fast repeated taps are impossible by design.
2. **The stock card's controls are awkward** (`task-9/stockcard-360.png`). Four outline buttons of equal weight (− + Receive Use) fill the row, and the "⋯" holding *Set quantity* wraps onto its own line, alone. The audit action ("actually there are 37") is the hardest one to find.
3. **Variant rows are overloaded on the phone** (`task-10/item-360.jpg`, `task-11`). Name, quantity, −, + and ⋯ share 300 px, so the name column gets about 90 px and "SOIC-8 · 10 kΩ" is cut. The number sits *outside* the stepper ("100 pcs − + ⋯"), so the eye doesn't read it as the value the buttons change (NN/g: minus left of the value, plus right). The −/+ are ghost icons with no container and look like loose glyphs.
4. **"Differs by variant" hides the answer** (`task-4/item-resistor-360-light.png`). For a resistor the resistance *is* the information, and the card replaces it with a sentence. The values only appear as variant sublines.
5. **Lists don't tell you much at a glance.** Every item gets the same `Cpu` chip icon, a cable sold in centimetres included (`task-8/folder-360.jpg`). An item with variants says "3 variants" but not which ones are empty. There is no sort, no "out of stock last" and no way to see everything in a subtree.
6. **The phone header spends the top of the screen on rare actions** (`task-5/folder-360-dark.png`). New folder, Rename, Move and Archive are four unlabelled icons in the hardest-to-reach band, with Archive (destructive) right next to Move. The owner asked for actions on the surface. They are, but the most frequent action of the four (New folder) has the same weight as the rarest (Archive).
7. **Chrome eats the phone screen.** The top bar, path, title and border take about 135 px and the dock about 84 px. That is roughly 30 % of a 360×740 screen, and none of it collapses on scroll.
8. **Confirmations guard reversible actions.** Archiving an item, folder or variant goes through `ConfirmSheet`, although archive is undoable by design (`{ type: 'restore', archiveId }` exists in core). That costs two taps and a sheet each time and trains people to confirm without reading.
9. **Toasts will collide with the dock.** `<Toaster />` in `app.vue` uses the default bottom position with no offset. On the phone, sonner toasts land on top of the search bar and "+", the most valuable 84 px of the screen. Any "Undo" toast makes this worse.
10. **The archive screen on the phone truncates the very thing you need** (`task-3/archive-360-light.jpg`). "Резистор 0…" appears twice and the two can't be told apart, because Restore and the trash icon take half the row.
11. **Quick add is a long form** (`task-7/quick-add-360.jpg`). Six open fields, the submit button under the keyboard, no "add another", and an inline folder list instead of recent folders. The happy path is right, but it looks like a database form.
12. **Dark theme details.** The selection slab `#1E1B4B` (`task-4/item-resistor-variant-1280-dark.png`) is far louder than light's `#EEF2FF`. Search highlights use `bg-chip`, nearly invisible in dark (`task-6/phone-360-palette-ne.png`). The PWA `theme_color` is fixed at `#F7F7F8`, so the status bar stays light in dark mode.
13. **Empty and loading states are bare.** "This folder is empty" offers no next step. The folder skeleton is one 160 px block unlike the list it replaces.
14. **The history is hard to scan** (`task-4/item-tl072-journal-360-light.png`). Every row repeats "Nov 10, 2026, 9:53 PM · macOS · Chrome". There is no day grouping and no running balance.
15. **Small bugs.** `font-extrabold` (800) is used in the palette, but `nuxt.config.ts` loads Manrope only at 400–700, so 800 is faked. `lib/format.ts` hard-codes `LOCALE = 'en'`. "avg $0.0543 / pcs" reads oddly; "$0.054 ea" is clearer.

---

## 2. What the field is doing (November 2026)

- **Swipe actions.** NN/g ([contextual swipe](https://www.nngroup.com/articles/contextual-swipe/)): keep the row visible, offer a "highly salient" undo, keep one meaning, don't clash with navigation swipes, never make swipe the *only* path.
- **Undo over confirm.** Material: snackbars go [*above* the FAB and persistent footers](https://material.io/components/snackbars). GNOME HIG and most current writing: undo for reversible actions, confirm only irreversible ones. Don't auto-dismiss action snackbars too fast (screen readers).
- **Steppers.** NN/g [input stepper](https://nngroup.com/articles/input-steppers): good for 1→2, bad for 1→50, so pair it with typing. Minus left of the value, plus right, big targets.
- **Haptics.** `navigator.vibrate()` works in Chrome for Android after a user gesture; it is absent in iOS Safari and was removed from desktop Firefox 129 ([W3C report](https://w3c.github.io/vibration/reports/implementation.html)). The owner's phone supports it.
- **Motion APIs.** [Same-document View Transitions are Baseline](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available?authuser=0) (Oct 2025). [`linear()` easing](https://developer.chrome.com/docs/css-ui/css-linear-easing-function) gives CSS springs in Chrome 113, Firefox 112 and Safari 17.2. Both are usable now, with fallbacks and reduced motion.
- **Platform styles.** Material 3 Expressive went bold (springs, shape morphs, FAB menus); iOS 26 Liquid Glass went translucent and was criticised for legibility ([Android Central](https://www.androidcentral.com/apps-software/android-os/android-16-material-3-expressive-vs-ios-26-liquid-glass)). Borrow behaviour, not looks. [Linear's March 2026 refresh](https://linear.app/changelog/2026-03-12-ui-refresh) went "calmer": fewer separators, more neutral, navigation that recedes. That matches the owner's taste.
- **Power use.** Linear: ⌘K, `/`, j/k, a searchable shortcut sheet. Raycast: an *action panel* on every result. Things 3: a "+" you drag to where the new item should land ([Cultured Code](https://culturedcode.com/things/support/articles/2803582/)).
- **Competitors.** Sortly: per-item low-stock alerts, bulk edit through spreadsheets. Homebox: functional, mobile web UI called unpolished. Neither has a fast "used 3" path. That is GrayMatter's opening.
- **Thumb zone.** Hoober's grip studies: frequent actions at the bottom, rare or destructive ones away from the thumb. The dock follows that; the phone header doesn't.

---

## 3. Proposals

Format: **what · why · effort (S ≤ 1 day, M 2–4 days, L a week or more) · risk · touches · done when.** IDs are used in the top 10 at the end.

### A. Phone ergonomics

**A1. A snackbar lane above the dock.** *S · low risk*
- **What:** on the phone, toasts sit directly above the search bar and "+" (offset = dock height + safe area), one at a time, swipe down to dismiss. Toasts with an action stay at least 6 s and pause while touched. On desktop, bottom-centre of the main column.
- **Why:** it is the precondition for every undo proposal below (Material: snackbars sit above FABs and footers).
- **Touches:** `app.vue` (`<Toaster position offset>`), `components/ui/sonner/Sonner.vue`, a `--dock-h` CSS variable from `MobileDock.vue`.
- **Done when:** at 360×740 no toast overlaps the search bar or "+"; with the keyboard open the toast sits above it; `prefers-reduced-motion` gives a fade only.

**A2. Haptics, very little of it.** *S · low risk*
- **What:** a `useHaptics()` wrapper around `navigator.vibrate`, feature-detected and called only inside user gestures:
  - 8 ms tick on each stepper tap;
  - 12 ms when a long press fires and when a swipe crosses its threshold;
  - `[6, 40, 6]` when a stock write commits.
  - An "Haptics" switch in Settings → Device.
- **Why:** on Android it turns "did my tap count?" into a physical answer. It costs nothing elsewhere.
- **Touches:** new `composables/useHaptics.ts`, `useLongPress.ts`, the steppers, `pages/settings`.
- **Done when:** taps vibrate on a Pixel-class phone; nothing breaks on iOS or desktop; the switch persists per device.

**A3. A header that collapses on scroll.** *M · medium risk*
- **What:** on the phone the path and the 24 px title scroll away. Once the `h1` leaves the viewport, the title fades into the top bar between the arrows and the actions (IntersectionObserver; a `animation-timeline: scroll()` version where supported).
- **Why:** it gives back about 70 px of list on every screen (critique 7). This is the Apple Files / Google Files pattern.
- **Touches:** `ScreenHeader.vue`, `ScreenBody.vue`.
- **Done when:** after 80 px of scroll the top bar shows the truncated title; scrolling up restores the full header; focus order and the `h1` landmark don't change; no layout jump.

**A4. Quick add that feels like a note, not a form.** *M · low risk*
- **What:** name first; folder as chips (current plus 3 recent from this device, "Other…" opens the picker); amount with unit; "Price and link" collapsed behind one text button. A sticky footer above the keyboard holds **Add** and **Add & next** (keeps the folder, clears the name). `enterkeyhint` set on every field.
- **Why:** this is the "bag arrived" scenario. Today it shows six fields and hides the button behind the keyboard (critique 11).
- **Touches:** `QuickAddForm.vue`, `QuickAddSheet.vue`, `AppSheet.vue` (footer slot made sticky), `lib/quick-add.ts`, a device-local `recentFolders`.
- **Done when:** adding three items to one folder takes three names and three taps on **Add & next**; the button is always visible above the keyboard on Android.

**A5. Swipe left on an item row to reveal stock actions.** *M · medium risk*
- **What:** touch only. Swiping left by 72 px reveals two neutral buttons, "Use 1" and "More"; a full swipe does nothing. The row stays visible (NN/g), with a haptic tick at the threshold. Swipe right still opens the menu.
- **Why:** "used one of these" along an organizer without opening each card. The actions stay in the long-press sheet and on the card, so the swipe is only a shortcut.
- **Touches:** `ItemList.vue`, a new `useRowSwipe.ts` next to `lib/swipe.ts`, and the `layout default.vue` swipe guard (ignore when the touch began on a swiped row).
- **Done when:** a vertical scroll never opens a row (axis lock at 10 px, 1.5× dominance); the menu swipe still works from empty space; screen readers get the same actions from the row menu.

**A6. Sheets with a grab handle and drag-to-dismiss.** *M · low risk*
- **What:** on the phone, `AppSheet` gets the 36×4 px handle from the shell mockup and follows the finger down to dismiss (velocity-aware). This means swapping the Reka dialog for shadcn-vue **Drawer** (vaul-vue). It counts as a shadcn-vue component, so the spec allows it. From 768 px keep the centred window.
- **Why:** one-handed closing without reaching for Cancel. It also gives an affordance the mockup promised and the build dropped.
- **Touches:** `AppSheet.vue`, `RowMenu.vue` sheet, `components/ui/drawer`.
- **Done when:** a flick down closes an unlocked sheet; a locked sheet (write in flight) springs back; CloseWatcher and focus return still work.

**A7. Phone header: one strong action and a labelled overflow.** *S · owner sign-off needed*
- **What:** keep "New folder" (folder screen) and "Edit" (item card) as icons. Move Rename, Move and Archive into a ⋯ that opens a sheet *with labels*, the same sheet the long press on the title opens.
- **Why:** it puts the rare and destructive actions out of the top-right mis-tap zone and labels them (critique 6). This partly reverses the owner's "actions on the surface" choice, so present it as an option. If A1 + C1 (undo) land, a mis-tapped Archive costs one tap to undo, and this matters less.
- **Touches:** `FolderActions.vue`, `ItemActions.vue`.
- **Done when:** the top bar has at most three icons at 360 px.

### B. Fast stock changes

**B1. A stepper that collects taps, writes once and can be undone before the write.** *M · medium risk*
- **What:** −/+ taps add up to a **pending delta** shown next to the committed number as a tinted chip ("+3 → 48") with a countdown ring. 2 s after the last tap the app writes **one** movement of 3 and the number rolls to the confirmed value. While pending, the snackbar reads "Receiving 3 pcs of TL072 · Undo"; Undo cancels without writing. Pending deltas flush on route change, `visibilitychange: hidden` and before any other write. Only the bucket being written is locked: per-target pending state replaces the global `state.saving` gate for stock controls.
- **Why:** it fixes critique 1 at the root: one journal row per intent, no lost taps on a cold start. It respects "no optimistic updates": the confirmed number changes only after the database answers, and the pending one is visibly *pending*. It also gives stock an undo without "reverse" rows in the append-only journal.
- **Touches:** `StockCard.vue`, `BucketList.vue`, `ItemScreen.vue`, `lib/stock-forms.ts` (`quickStep` takes a quantity), new `composables/usePendingSteps.ts`, `lib/workspace.ts` (per-target saving).
- **Done when:** five fast taps make one movement of 5; Undo within the window writes nothing; leaving the card flushes; a failed write brings the chip back with Retry; screen readers hear "TL072, 48 pcs" after the commit.

**B2. One "stock pad" sheet for Use, Receive and Set.** *M · low risk*
- **What:** one sheet instead of three: a segmented **Use · Receive · Set**, a large amount field with quick chips (−1/−5/−10, +10/+50/+100, the current value for Set), note collapsed, price and link only for Receive. The submit label states the result: "Use 3 → 42 left".
- **Why:** the user thinks "I used 3", not "open the Use form". The chips cover the 1→50 cases steppers handle badly (NN/g). The result preview prevents sign errors.
- **Touches:** `StockSheet.vue`, `lib/stock-forms.ts`, `en.json`.
- **Done when:** switching modes keeps the typed amount; Set shows the difference it will record ("+4 adjustment"); `inputmode="decimal"` with SI prefixes still works.

**B3. A new stock card layout.** *S · low risk*
- **What:**
  - Row 1: the big number left; a **single stepper pill** right (− | +), 44 px targets, one border, a divider in the middle.
  - Row 2: three equal text buttons **Receive · Use · Count**. "Count" is today's *Set quantity*, renamed to the stocktaking verb and visible.
  - The avg/last prices go under the number as "avg $0.054 ea · last $0.025".
  - No orphan ⋯.
- **Why:** critique 2. It also puts the stepper in the thumb's reach, right under the number it changes.
- **Touches:** `StockCard.vue`, `en.json` (`stockActions.count`).
- **Done when:** at 320 px nothing wraps; Set quantity takes one tap; tooltips stay on desktop.

**B4. Variant rows with the number inside the stepper.** *M · low risk*
- **What:**
  - On the phone each bucket row is name + attribute values (two lines, never truncated below 120 px) and a pill `[− 100 pcs +]` on the right.
  - Tapping the name opens a **variant sheet**: rename, attributes, Use…/Receive…/Count, move stock, archive.
  - The ⋯ goes away on touch, as on list rows.
  - On desktop, keep the ⋯ and show the pill on hover and focus; the number stays visible otherwise.
- **Why:** critique 3. The value sits between its − and + (the NN/g convention), and the name gets about 60 px back.
- **Touches:** `BucketList.vue`, a new `VariantSheet.vue`, `ItemScreen.vue`.
- **Done when:** at 360 px "SOIC-8 · 10 kΩ" shows in full; the pill and B1 pending chip work per variant; `aria-label` reads "10k, 100 pcs, use one / add one".

**B5. Stocktake mode for a folder.** *L · post-MVP (it is a batch)*
- **What:** "Count this folder" (folder actions and palette) turns the list into rows with numeric fields pre-filled with the current count; changed rows get an indigo dot; a sticky bar "Apply 7 changes" sends one `stock.set` per change in sequence, with progress.
- **Why:** the organizer audit is when the owner will "set" most, and opening 40 cards one by one is why inventories go stale.
- **Touches:** new `pages/folder/[id]/count.vue`, `lib/stock-forms.ts`. There is no core batch command; this is sequential, and a failed row stays marked.
- **Done when:** 20 rows can be counted with the numeric keyboard and Next without touching anything else; leaving with unsaved changes asks first.

### C. Undo and safety

**C1. Archive at once, with Undo instead of a confirmation.** *M · low risk*
- **What:**
  - Archiving an item, variant or folder runs immediately.
  - The snackbar reads "“NE555” archived · Undo", and Undo sends `{ type: 'restore', archiveId }` with the id the command just used.
  - Desktop: ⌘Z / Ctrl+Z repeats the last Undo while the snackbar is visible.
  - Keep `ConfirmSheet` for *irreversible* things only: permanent delete, removing an attribute together with its values, deleting tags, attributes or units.
- **Why:** critique 8. Archive was designed to be reversible, and the UI should use that.
- **Touches:** `ItemDialogs.vue`, `FolderDialogs.vue`, `ItemScreen.vue` (variant archive), `A1`.
- **Done when:** archive takes one tap from a menu; Undo brings back exactly the chain (core already scopes restore by `archiveId`); an archive from the item card navigates back to the folder and the snackbar survives the navigation.

### D. Lists and density

**D1. Placeholder thumbnails that tell items apart.** *S · low risk*
- **What:** until Plan 4 photos exist, the 42 px tile shows a **monogram**: the first 2–3 significant characters ("TL", "NE", "LM", "Рз") in 13/800 on `--thumb`. Optionally, an icon by unit: m → ruler, g → weight, l → droplet.
- **Why:** critique 5. Twenty identical chip icons are noise. Monograms let you scan by shape.
- **Touches:** `ItemList.vue`, `SearchPalette.vue`, a `lib/monogram.ts` helper.
- **Done when:** no two neighbouring rows in the demo share both monogram and tone; photos replace monograms when present.

**D2. Variant stock in the subline.** *S · low risk*
- **What:**
  - For items with variants the subline lists the buckets: "1k 3 · 10k 100 · 100k —", with empty ones as "—" in muted text, truncated with "+2".
  - Out-of-stock items get a small neutral "Out" pill next to the number instead of a sentence in the subline.
  - Keep `--warning` reserved for the future "low".
- **Why:** answers "do I have a 10k?" from the folder list without opening the card.
- **Touches:** `lib/views.ts` (`ItemRow.buckets`), `ItemList.vue`, the palette row.
- **Done when:** the resistor row in the demo shows its three values; the palette hit for a variant shows that variant's own count.

**D3. Attribute values instead of "Differs by variant".** *S · low risk*
- **What:**
  - The attribute row shows the distinct values: "1 kΩ, 10 kΩ, 100 kΩ", or with many "1 kΩ – 100 kΩ · 12 values" (sorted with the same numeric collation as names).
  - On desktop the variants list gains one column per per-variant attribute (a small table, see the mockup).
- **Why:** critique 4.
- **Touches:** `lib/item-view.ts`, `ItemAttributes.vue`, `BucketList.vue`.
- **Done when:** no row shows "Differs by variant"; a value with no variants set shows "—".

**D4. Sort, "in stock first" and "include subfolders".** *M · low risk*
- **What:**
  - A quiet control row above the items: Sort (Name, Quantity, Recently changed, Recently added) and a toggle "In stock first".
  - On desktop also "Include subfolders": a flat list of the subtree with each item's path in the subline, like Sortly's "All items".
  - Stored per device and inventory, like the tree's expand state.
- **Why:** browsing "Components" today means drilling into each child folder.
- **Touches:** `FolderScreen.vue`, `ItemList.vue`, `lib/views.ts`, `lib/tree-state.ts` (persistence).
- **Done when:** the setting survives a reload; "Recently changed" uses the latest movement time already in the snapshot (or `updated_at`).

**D5. Density: comfortable, compact, table, and grid after Plan 4.** *L · medium risk*
- **What:** a desktop view switch: **List** (62 px rows), **Compact** (40 px rows) and **Table** (Name, Variants, Qty, Avg price, Value, Updated; sortable, numbers right-aligned). After Plan 4 the phone also gets **Grid**: two columns, 1:1 photo, name, quantity badge.
- **Why:** desktop setup is the "Sortly" job, and the owner likes Sortly's desktop. Grid only pays off with photos.
- **Touches:** `ItemList.vue` and a new `ItemTable.vue` / `ItemGrid.vue`; state as in D4.
- **Done when:** j/k (E1) works in all views; Table fits 1280 px without horizontal scroll; Grid is hidden until any item in the folder has a photo.

**D6. Skeletons that match, and a freshness line.** *S · low risk*
- **What:** skeletons with the real row heights (2 folder rows and 6 item rows; the stock card plus 3 bucket rows). Under the list, a muted line "Updated 2 min ago · Refresh"; on the phone, pulling down past the top also refreshes. Set `overscroll-behavior-y: contain` so Chrome's own pull-to-refresh doesn't reload the app in a browser tab.
- **Why:** critique 13. The freshness line also explains offline and read-only states better than a badge does.
- **Touches:** `FolderScreen.vue`, `ItemScreen.vue`, `AppStatus.vue`, `layouts/default.vue`.
- **Done when:** no layout shift when data arrives (CLS ≈ 0); pull-to-refresh calls `workspace.refresh()` and shows progress in the line, not a spinner overlay.

### E. Desktop power

**E1. A keyboard layer and a `?` sheet.** *M · low risk*
- **What:** j/k or ↓/↑ move a soft list cursor, Enter opens, e edit, m move, Shift+⌫ archive (with C1 undo), n quick add, Shift+N new folder, `/` or ⌘K palette, [ ] back/forward, −/+ card stepper, u/r/c Use/Receive/Count, `?` a searchable cheat sheet. Ignored while typing. Each shortcut is shown next to its palette action, so the palette teaches them.
- **Why:** the desktop is for setup, and the owner likes Raycast. Today the only shortcut is ⌘K.
- **Touches:** a new `composables/useHotkeys.ts`, `layouts/default.vue`, `ItemList.vue`, `FolderList.vue`, `StockCard.vue`, `SearchPalette.vue`, a new `ShortcutsSheet.vue`.
- **Done when:** a whole session (find, open, use 2, move, back) is possible without the mouse; Russian layouts work by `e.code`, as ⌘K already does.

**E2. Actions from the palette (Raycast's action panel).** *M · low risk*
- **What:**
  - On desktop, with an item result selected, **Tab** (or →) opens an action panel on the right of the palette: Open ↵, Use 1, Receive 1, Use… (U), Receive… (R), Count… (C), Move (M), Copy name.
  - The quick stepper works right there, using B1, with the count updating in the row.
  - On the phone a **long press on a result** expands it in place into a stepper plus "Use… / Receive… / Open".
- **Why:** this closes the main scenario in one surface: "do I have TL072? Yes, 45. I just used 2." There is no navigation and no second screen. No inventory app does this.
- **Touches:** `SearchPalette.vue`, `lib/palette.ts`, `StockSheet.vue` (opens over the palette).
- **Done when:** ⌘K, "tl072", Tab, −, −, Esc leaves one movement of −2; the phone variant works one-handed with the field at the bottom; the screen reader announces the panel as a menu attached to the option.

**E3. Split view on wide screens.** *L · medium risk*
- **What:** from 1440 px the main column splits into list | card. Selecting a row loads the card on the right, while the URL still changes to `/item/[id]`, so Back and links keep working. Below 1440 px it behaves as now.
- **Why:** it keeps the list's scroll and context during setup and audits. It is the "tree | list | card" layout the brief mentions.
- **Touches:** `layouts/default.vue`, `pages/item/[id].vue`, `pages/folder/[id].vue`, `ScreenHeader.vue` (two headers or one shared).
- **Done when:** j/k moves through items and the card follows; resizing below 1440 px falls back without a reload.

**E4. Two columns on the item card from 1280 px.** *M · low risk*
- **What:** in the card, put stock, variants and attributes on the left (about 60 %) and description, tags and history on the right with their own scroll. Raise `max-w` from 760 to about 1080 on this screen only.
- **Why:** `task-8/item-card-1280.jpg` shows a 760 px stack with about 300 px of empty canvas on each side, while the history sits below the fold.
- **Touches:** `ItemScreen.vue`, `ScreenBody.vue` (a `wide` prop).
- **Done when:** at 1280×800 stock and history are both visible without scrolling.

**E5. Drag to move (post-MVP), and inline rename.** *M · low risk (rename) / L (drag)*
- **What:**
  - Now: F2 or a double-click on a title renames in place.
  - Later: drag rows onto tree folders, with the target row highlighted and the move landing with C1-style undo.
- **Why:** desktop setup.
- **Touches:** `ScreenHeader.vue`, then `ItemList.vue`, `FolderList.vue`, `FolderTreeNode.vue`.
- **Done when:** rename commits on Enter and cancels on Esc, and the drag design is noted for after MVP (the shell spec lists drag as a non-goal).

### F. Motion and feel

**F1. View transitions from a list row to the card.** *M · medium risk*
- **What:**
  - Wrap router navigation in `document.startViewTransition` when supported and motion is allowed.
  - The row's thumb, name and quantity get `view-transition-name: item-<id>-…` so they morph into the card's title and stock number (240–280 ms).
  - Back reverses the morph. Everything else crossfades.
  - Under reduced motion there is no transition.
- **Why:** this is the "hover and motion" the owner asked for, applied where it carries meaning ("this number is that number").
- **Touches:** a `plugins/view-transitions.client.ts` (router `beforeResolve`), `ItemList.vue`, `StockCard.vue`, `ScreenHeader.vue`.
- **Done when:** no flash of the sticky header; scroll restoration on Back still lands on the row; the palette → card path uses a plain crossfade.

**F2. Motion tokens, springs and small delights.** *S · low risk*
- **What:** tokens `--ease-out: cubic-bezier(.2,.8,.2,1)`, `--spring: linear(0, .53 9%, .96 18%, 1.07 24%, 1.04 31%, 1 41%, .99 60%, 1)` and durations 120/160/200/280. Use them for the stepper press (scale .94 on the spring), the pending chip, a digit roll on commit, tree expand with `interpolate-size: allow-keywords` where supported, and a 20 ms stagger on palette results.
- **Why:** motion that feels physical, without the Expressive look.
- **Touches:** `assets/css/main.css`, `FolderTreeNode.vue`, `StockCard.vue`, `SearchPalette.vue`.
- **Done when:** every animation reads its duration and easing from tokens; reduced motion leaves only opacity.

### G. Visual polish

**G1. Dark theme polish and the status bar.** *S · low risk*
- **What:** dark `--accent-soft` becomes `rgba(129,140,248,.16)` instead of the `#1E1B4B` slab. A new `--raised: #1F1F23` makes sheets, the palette and menus lighter than surfaces. A new `--mark` (`#FDE68A` light, amber 28 % dark). `<meta name="theme-color">` follows the *chosen* theme, so the installed PWA's status bar follows Settings. Load Manrope 800 or drop `font-extrabold`.
- **Why:** critique 12 and 15.
- **Touches:** `main.css`, `SearchPalette.vue` (`markClass`), `nuxt.config.ts` (fonts, manifest), `ThemeSwitch.vue`.
- **Done when:** the selection in the dark tree is at most twice as prominent as hover; the highlight is readable in both themes (≥ 3:1 against its row); the Android status bar is dark in dark mode.

**G2. A history you can scan.** *S–M · low risk*
- **What:** group by day (Today, Yesterday, Nov 10); time only in the row, full timestamp and device on hover or long press; a right-aligned signed amount plus a muted **running balance** ("→ 45"). Later, a 48 px step chart of quantity over time above the list, in foreground ink with an indigo "now" dot.
- **Why:** critique 14. The running balance is what an audit needs ("when was it last right?").
- **Touches:** `JournalList.vue`, `lib/item-view.ts` (`journalRows` adds `balance`), `lib/format.ts`.
- **Done when:** a 30-entry history fits about 40 % less height; balances match the stock total at the top.

### H. Onboarding and empty states

**H1. Empty states with a next step.** *S · low risk*
- **What:**
  - An empty folder shows "Nothing here yet", **Add item** (primary) and **New folder**, with a muted hint "or press N" on desktop.
  - An empty search gives "Add item “…”" as the first action (it exists; make it the highlighted row when there are no item hits).
  - Archive empty: one sentence on how archive works.
- **Why:** critique 13. Every empty state should teach one thing.
- **Touches:** `EmptyState.vue` (an icon slot), `FolderScreen.vue`, `archive.vue`, `SearchPalette.vue`.
- **Done when:** every empty state has either an action or a reason.

**H2. A first run that teaches three gestures.** *M · low risk*
- **What:** three one-time tips per device, each shown *in context* the first time it applies, never as a carousel: "Search lives at the bottom" (pointing at the bar), "Long-press any row for actions", "Swipe right for folders". Keep the demo inventory in the owner's world: op-amps, resistors with values, a cable in metres, one item out of stock, one with prices.
- **Why:** the app's best features (palette, long press, swipes) are invisible by nature.
- **Touches:** a new `composables/useTips.ts` (device-local flags), `MobileDock.vue`, `ItemList.vue`, `NavDrawer.vue`, `lib/dev` demo seed.
- **Done when:** each tip shows once, closes with one tap or the back gesture, and never covers the dock or a sheet.

**H3. Progressive disclosure on the card.** *S · low risk*
- **What:** an item with no variants, attributes or tags shows one quiet row, "Add details: variants · attributes · tags", instead of two outline buttons and empty sections. Each word opens its sheet. Once a section has content it appears with its own header and add button.
- **Why:** most quick-added items stay simple. The card should look simple too.
- **Touches:** `ItemScreen.vue`, `ItemAttributes.vue`, `TagsSection.vue`.
- **Done when:** a fresh quick-added item's card is the stock card, the details row and the history, nothing else.

### I. Accessibility and i18n readiness

**I1. Russian-ready plurals, numbers and units.** *M · low risk*
- **What:** vue-i18n `pluralRules` for `ru` via `Intl.PluralRules` (the current two-form pipe strings pick wrong Russian forms), with a lint on plural form counts. Take the `Intl` locale from i18n instead of `LOCALE = 'en'`. Localise unit symbols ("шт", "м", "г", "л") in i18n. Add a pseudo-locale (+35 % length) to test expansion; B3's buttons must hold "Приход / Расход / Пересчёт".
- **Why:** a later Russian UI should only need a file, as section 4.8 of the spec says.
- **Touches:** `nuxt.config.ts` (i18n), `i18n/locales/en.json`, `lib/format.ts`, unit display in `lib/amounts.ts`.
- **Done when:** with the pseudo-locale nothing overlaps at 360 px; "21 item / 22 item / 25 item" test strings pick the right Russian forms.

**I2. Announce stock changes; check targets and contrast.** *S · low risk*
- **What:**
  - Add a polite live region that says "TL072: 48 pcs" after a commit, and "Undo available" while a snackbar is up.
  - Steppers get `role="group"` with the value in the label.
  - Audit with axe:
    - 44 px targets on touch;
    - focus rings on the new pill and chips;
    - muted text on `--hover` (`#71717A` on `#F1F1F4` is about 4.3:1, below 4.5; use `--subtle` there).
- **Why:** the faster the interaction, the more feedback assistive technology needs.
- **Touches:** `StockCard.vue`, `BucketList.vue`, `AppStatus.vue`, `main.css`.
- **Done when:** TalkBack reads every step and every undo; axe shows no contrast or target violations on the four main screens.

---

## 4. Visual directions

All three keep the structure, Manrope, neutral actions and sparing indigo. They differ in temperature, edges and how numbers look.

### Direction A: Quiet utility (refine what exists). Recommended for MVP.

The current light theme stays; the dark theme gets the G1 fixes. Overlays are the only things with shadow.

| Role | Light | Dark |
| --- | --- | --- |
| background | `#F7F7F8` | `#0E0E10` |
| surface | `#FFFFFF` | `#18181B` |
| raised (sheet, palette, menu) | `#FFFFFF` | `#1F1F23` |
| border / divider | `#EDEDF0` / `#F0F0F2` | `#27272A` / `#222225` |
| foreground / muted / subtle | `#18181B` / `#71717A` / `#63636B` | `#F4F4F5` / `#A1A1AA` / `#A1A1AA` |
| hover / chip | `#F1F1F4` / `#ECECEF` | `#1F1F23` / `#232327` |
| primary | `#4F46E5` | `#818CF8` |
| accent-soft (selection) | `#EEF2FF` | `rgba(129,140,248,.16)` |
| pending (new) | `rgba(79,70,229,.10)` | `rgba(129,140,248,.18)` |
| mark (search) | `#FDE68A` | `rgba(250,204,21,.28)` |
| warning (future "low") | `#B45309` | `#FBBF24` |

- **Radii:** field 14, card 16, thumb 12, row/icon 10, fab 18, pill 999.
- **Shadows:**
  - at rest: none;
  - dock `0 6px 20px rgb(0 0 0/.08)`;
  - popover `0 10px 30px rgb(0 0 0/.12)`;
  - palette `0 24px 60px rgb(0 0 0/.22)`;
  - in dark, a 1 px top highlight `rgb(255 255 255/.06)` replaces shadows.
- **Type (px/weight):**

  | Size/weight | Use |
  | --- | --- |
  | 11/800 caps | group label |
  | 12/600 | meta |
  | 13/600 | secondary |
  | 15/700 | row title |
  | 16/800 | row quantity |
  | 18/700 | sheet title |
  | 24/700 | screen title |
  | 32/700 | stock number |

  All numbers use `tabular-nums`.
- **Icons:** Lucide at 1.75 stroke, 16/18/20.
- **Photos (Plan 4):**
  - Thumbs at 12 px radius with an inset 1 px hairline (`inset 0 0 0 1px rgb(0 0 0/.06)`).
  - In light theme, AliExpress-style white-background photos use `mix-blend-mode: multiply` on `--thumb`, so the white melts into the tile instead of punching a white square into a white row.
  - In dark theme, photos sit on a `#E9E9EC` mat with 4 px padding ("photo on paper"), because multiply doesn't work on dark.
- **Data viz:**
  - Foreground ink lines, indigo only for "now", no red or green.
  - A step chart for quantity over time.
  - Value later as a muted second line.

### Direction B: Warm paper

Kraft labels and a parts drawer. The same layout with warmer neutrals and slightly rounder corners. It feels like a personal notebook, not a tool.

| Role | Light | Dark |
| --- | --- | --- |
| background | `#F5F3EF` | `#12110F` |
| surface / raised | `#FFFEFB` / `#FFFEFB` | `#1B1A17` / `#22201C` |
| border / divider | `#E7E3DB` / `#EEEAE3` | `#2A2824` / `#24221E` |
| foreground / muted | `#1E1C18` / `#6F685D` | `#F2EEE6` / `#A59D90` |
| hover / chip / thumb | `#F0EDE6` / `#ECE8E0` / `#F1EEE7` | `#22201C` / `#26241F` / `#24221E` |
| primary (ink indigo) | `#4840C8` | `#A29CF7` |
| accent-soft | `#EEECFA` | `rgba(162,156,247,.15)` |
| warning | `#A2560C` | `#E9B25A` |

- **Radii:** 16 / 18 / 12 / 10 / 20.
- **Shadows:** warm `rgb(60 40 10/.08)`, overlays only.
- **Type:** Manrope, titles 24/700 at −0.02em, quantities 800.
- **Icons:** Lucide at 1.75. Item monograms on a kraft-tinted tile.
- **Risk:** warm greys can look dirty on cheap phone screens. Test on the owner's Android at low brightness. Muted text passes 4.5:1 on both surfaces (about 5.0–5.5:1).

### Direction C: Instrument panel

For a synth builder: Eurorack faceplates and bench equipment. Tighter edges, hairlines, numbers and part numbers in a monospace font, and status as "LEDs".

| Role | Light | Dark (hero) |
| --- | --- | --- |
| background | `#F3F4F5` | `#0A0B0D` |
| surface / raised | `#FFFFFF` / `#FFFFFF` | `#121417` / `#181B1F` |
| border / divider | `#E1E4E8` / `#ECEEF1` | `#23262B` / `#1B1E22` |
| foreground / muted | `#101214` / `#687079` | `#E6E8EB` / `#8A929C` |
| hover / chip | `#F0F2F4` / `#EAECEF` | `#1A1D21` / `#1C1F23` |
| primary | `#4F46E5` | `#8B93FF` |
| LED on / off | `#4F46E5` / `#C9CDD3` | `#8B93FF` with a `0 0 6px rgb(139 147 255/.6)` glow / `#3A3F46` |
| warning (low LED) | `#B45309` | `#F5B544` |

- **Radii:** 10 / 12 / 8 / 8 / 14.
- **Borders and shadows:** 1 px hairlines everywhere; no shadows except overlays.
- **Type:**
  - Manrope for UI.
  - **JetBrains Mono 500** for quantities, prices and item names that look like part numbers (`/^[A-Z0-9-]{3,}$/`).
  - Group labels 10.5/700 caps, +0.08em.
- **Icons:** Lucide at 1.5 stroke.
- **Status:** a 6 px LED before the quantity: filled = in stock, hollow = out, amber = low (later).
- **Risk:** the most distinctive option, and the closest to "feels like a database client" if overdone. Keep the mono font for *values only*.

**Recommendation:** ship A now with the G1 dark fixes. Prototype C's two signature details (mono part numbers and quantities, LED dots) as an opt-in "Instrument" theme after MVP. It is cheap with tokens and very much the owner's world. Skip B unless the owner reacts to it in the mockup.

---

## 5. Top 10, ranked

Ranked by value for the two core scenarios, divided by effort, with owner taste as a gate.

1. **B1** A stepper that collects taps, writes once and can be undone before the write. *M*
2. **B3** A new stock card layout: stepper pill, Receive / Use / **Count** on the surface. *S*
3. **E2** Actions from the palette: find TL072 and use 2 without leaving search. *M*
4. **A1** A snackbar lane above the dock, which the undo proposals need. *S*
5. **C1** Archive at once with Undo instead of a confirmation sheet. *M*
6. **B4** Variant rows with the number inside the stepper, and a variant sheet. *M*
7. **D2 + D3** Variant stock in list sublines and real attribute values instead of "Differs by variant". *S*
8. **A4** Quick add with folder chips, a sticky footer and "Add & next". *M*
9. **G1** Dark theme polish, the Manrope 800 fix and `theme-color` following the theme. *S*
10. **F1** View transitions from row to card, with the reduced-motion fallback. *M*

Next in line: E1 (keyboard layer), H1 (empty states with actions), D1 (monograms), A2 (haptics), G2 (history).
