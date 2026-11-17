/** The text of the `intake_from_photos` prompt: how to turn a batch of photos of purchases into one intake draft. */
export function intakeFromPhotosPrompt(args: { folder?: string; intake?: string }): string {
  const folder = args.folder?.trim()
  const intake = args.intake?.trim()
  const where = folder ? `The photos are in the folder ${folder}.` : 'Use the photo folder that get_overview reports.'
  const target = intake
    ? `Add the lines to the existing intake draft ${intake} (read it with get_intake first); do not create a new intake.`
    : 'Create one intake draft for the whole batch (create_intake), unless the person named a draft to continue.'
  return [
    'Turn the photos of purchased items (small bags and packets, each usually with a sticky note and a ruler beside it) into an intake draft in Antresol.',
    where,
    '',
    '1. Start with get_overview: learn the inventories, folders, attributes, units and tags.',
    '2. Call list_photos with onlyNew: true to get only the photos not yet attached to any intake line.',
    `3. ${target}`,
    '4. Look at the photos in batches of 3 to 6 with view_photos, not all at once.',
    '5. Read the quantity from the sticky note and the size from the ruler.',
    '6. For every bag call search before proposing anything. Prefer topping up an existing item, or adding a new value (for example "4k7") to an existing item, over creating a new item. Create a new item only when nothing fits. Never rely on case, spaces or plurals to tell names apart ("Resistor", "resistor ", "Resistors" are one thing): an exact duplicate is refused, and every answer lists `similar` names for each new name; read it, and use the existing one when it is the same thing.',
    '6a. One photo per new item (the item\'s own `photo` in newItems). Give a variant its own photo only when that variant looks different from the item\'s other photos. A line that tops up something already in stock takes no photo.',
    '6b. Create a folder (create_folder) only when get_overview and search show nothing that fits; then use it by path. Attributes, tags and units are declared only under the item that needs them, in newItems: an existing attribute by name, or a new one with its kind (list: options; number: unit; pinned to show it in lists), tags by name (a new tag may have a color), a unit by symbol or a new unit {name, symbol, prefixes}, an icon and a color. Look in get_overview first and use what exists. If the value you need is not in an existing list attribute, add it on the line that uses it (`addValues`: [{ attribute, value }], and the same value in `values`); a value the list already has (any case) is used, not added.',
    '7. Save lines with add_intake_lines (new items go in its newItems). A line that makes a new variant may carry that variant\'s photo (`photo`: the path from list_photos), only if it looks different from the item\'s photo; a line that tops up existing stock never carries a photo; the item\'s own photo goes on the new item. Photos left unattached (receipts, close-ups) keep showing as new. A line that makes a new variant may carry its `description`. Fix mistakes with update_intake_line, remove_intake_line and update_new_item.',
    '8. Do not guess. A line has no note of its own, so put every doubt (unreadable label, unclear count, unsure match) in your chat reply, and use the draft note only for what is worth keeping with the intake.',
    '9. Finish with a summary: how many lines, how many new items, and the list of doubts. Remind the person that nothing is in the stock yet: they review and commit the intake in the Antresol app.',
  ].join('\n')
}
