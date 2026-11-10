# Task 14 report

Branch worktree-agent-a046cbd7ed796e2df, based on e2a59d3.

Step 1: Archive item in InventorySwitcher no longer overrides the focus background (dropped focus:bg-background; it gets the shared menu item focus:bg-accent, text stays destructive). FolderTreeNode: `level` prop, indent and guide line stop growing after 6 levels. MoveFolderSheet list got p-1 so the focus ring is not clipped.

Step 2: AppSheet `locked` prop (Esc, outside click/interact blocked). useCloseWatcher takes a locked() getter: oncancel preventDefault, and onclose while locked re-arms a fresh watcher (new test). Forms expose `busy` via defineModel and parents pass it as locked (FolderDialogs, InventorySwitcher, FolderScreen, ItemDialogs edit/move, QuickAddSheet); ConfirmSheet, MoveFolderSheet, StockSheet use their busy. autofocus removed, initial-focus selectors added. i18n: form.name/description/optional used by FolderForm, InventoryForm, ItemForm, QuickAddForm, StockSheet; old duplicate keys deleted from folderForm, inventoryForm, itemForm, quickAdd, stockForm (values unchanged). InventoryForm shows a link "Connect a source first" to /settings when no ready source. currencies test strengthened.

Step 3: SourceForm check() has catch (alert), save error only in the form (toast removed), foreign/failed results use role=alert. /settings/sources/[id] shows EmptyState with "Back to settings". Source kind label hidden when equal to the name.

Tests: pnpm test 404 passed; typecheck and lint clean.

Concerns: old keys .name/.description/.optional in itemForm/stockForm/quickAdd/inventoryForm were deleted; if Task 10 forms use them, switch to form.*. Settings remove sheet has no busy (closes immediately). No browser or screenshot check done.
