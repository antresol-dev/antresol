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
    '6. For every bag call search before proposing anything. Prefer topping up an existing item, or adding a new value (for example "4k7") to an existing item, over creating a new item. Create a new item only when nothing fits.',
    '7. Save lines with add_intake_lines (new items go in its newItems). Give each line the photo of its bag (`photo`: the path from list_photos). Photos left unattached (receipts, close-ups) keep showing as new. Fix mistakes with update_intake_line, remove_intake_line and update_new_item.',
    '8. Do not guess. A line has no note of its own, so put every doubt (unreadable label, unclear count, unsure match) in your chat reply, and use the draft note only for what is worth keeping with the intake.',
    '9. Finish with a summary: how many lines, how many new items, and the list of doubts. Remind the person that nothing is in the stock yet: they review and commit the intake in the Antresol app.',
  ].join('\n')
}
